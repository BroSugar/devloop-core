// 从平台目录（projects/ + repos/ + archive/）导入到数据库。
// 配置的权威来源仍然是 Git 里的 project.yaml：服务端只做「快照 + 解析」，
// 这样配置可 review、可回滚，也不存在客户端与服务端双写同一份配置的问题。

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PLATFORM_ROOT, loadConfig, resolve, readYaml } from '../platform/lib/config.mjs';
import { loadCards } from '../platform/lib/plan.mjs';
import { DATA_DIR } from './db.mjs';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const listDirs = (p) => (fs.existsSync(p) ? fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : []);

export function seedAll(store, { log = console.log } = {}) {
  const projectsDir = path.join(PLATFORM_ROOT, 'projects');
  const ids = listDirs(projectsDir).filter((id) => fs.existsSync(path.join(projectsDir, id, 'project.yaml')));
  let stats = { projects: 0, requirements: 0, tasks: 0, runs: 0, evidence: 0 };

  for (const id of ids) {
    let cfg;
    try {
      cfg = resolve(loadConfig(id));
    } catch (e) {
      log(`[seed] 跳过 ${id}：${e.message}`);
      continue;
    }
    const p = cfg.project;
    store.upsertProject({
      id: p.id, name: p.name, stack: p.stack, repoPath: p.repo_path, defaultBranch: p.branch, cardsMode: p.cards.mode,
    });
    store.saveConfig(p.id, cfg, cfg.sources);
    stats.projects++;

    // 卡
    for (const card of loadCards(p.spec_path)) {
      store.upsertRequirement({
        id: card.id, projectId: p.id, title: card.title, status: card.status,
        autonomy: card.autonomy, owner: card.owner, summary: card.summary,
        acceptance: (card.acceptance || []).map((ac) => ({ id: ac.id, text: ac.text, verifyBy: ac.verify_by })),
      });
      stats.requirements++;
    }
    for (const card of loadCards(p.tasks_path)) {
      store.upsertTask({
        id: card.id, requirementId: card.requirement, title: card.title, objective: card.objective,
        autonomy: card.autonomy, deps: card.depends_on || [],
        scope: card.scope || {}, verify: (card.verify || []).map((ref) => ({ ref })),
        acceptance: card.acceptance || [],
      });
      stats.tasks++;
    }

    // agent 配置快照（服务端下发、客户端只读）
    seedAgents(store, p.id);

    // 历史执行与证据（来自 archive/）
    stats = { ...stats, ...seedArchive(store, p.id) };

    for (const req of store.listRequirements(p.id)) {
      store.recomputeStatuses(req.id);
    }
  }
  log(`[seed] 项目 ${stats.projects} / 需求 ${stats.requirements} / 任务 ${stats.tasks} / 执行 ${stats.runs} / 证据 ${stats.evidence}`);
  return stats;
}

function seedAgents(store, projectId) {
  const agentsFile = path.join(PLATFORM_ROOT, 'config/agents.yaml');
  const providersFile = path.join(PLATFORM_ROOT, 'config/providers.yaml');
  if (!fs.existsSync(agentsFile) || !fs.existsSync(providersFile)) return;
  const agents = readYaml(agentsFile).agents || {};
  const providers = readYaml(providersFile).providers || {};

  for (const [role, agent] of Object.entries(agents)) {
    const provider = providers[agent.provider];
    if (!provider) continue;
    const adapter = provider.kind === 'cli' ? 'cli' : provider.kind;
    store.upsertAgentProfile({
      id: `agent_${projectId}_${role}`,
      projectId,
      role,
      adapter,
      model: provider.model || null,
      command: provider.command || null,
      env: provider.api_key_env ? { apiKeyEnv: provider.api_key_env } : null,
      policy: { allowNetwork: provider.kind !== 'cli', allowShell: true, maxTokensPerRun: agent.max_tokens ?? 8192 },
    });
  }

  // 演示：VSCode Claude Code 作为实现者的一个可选 adapter
  store.upsertAgentProfile({
    id: `agent_${projectId}_implementer_vscode`,
    projectId,
    role: 'implementer',
    adapter: 'vscode-claude-code',
    model: null,
    command: 'claude',
    env: { mode: 'headless-cli' },
    policy: { allowNetwork: false, allowShell: true, maxRepairs: 2 },
  });
}

function seedArchive(store, projectId) {
  const base = path.join(PLATFORM_ROOT, 'archive', projectId);
  if (!fs.existsSync(base)) return { runs: 0, evidence: 0 };
  let runs = 0;
  let evidenceCount = 0;

  for (const reqId of listDirs(base)) {
    for (const taskId of listDirs(path.join(base, reqId))) {
      for (const attemptDir of listDirs(path.join(base, reqId, taskId))) {
        const attempt = Number(attemptDir.replace('attempt-', ''));
        if (!Number.isFinite(attempt)) continue;
        const dir = path.join(base, reqId, taskId, attemptDir);
        const manifestFile = path.join(dir, 'manifest.json');
        if (!fs.existsSync(manifestFile)) continue;
        const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
        const resultFile = path.join(dir, 'result.json');
        const result = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, 'utf8')) : {};

        const runId = `run_${taskId}_${attempt}`;
        const status = manifest.verdict === 'pass' ? 'passed' : 'failed';
        store.db.prepare(`INSERT OR REPLACE INTO runs (id,task_id,attempt,status,reason,actor,agent_profile,workspace,changed_files,started_at,finished_at,created_at)
                          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(runId, taskId, attempt, status, result.reason ?? (status === 'failed' ? '未通过' : null),
            'seed', null, null, (result.changed || []).length, result.startedAt ?? null, result.finishedAt ?? null, manifest.archivedAt ?? new Date().toISOString());

        (result.stages || []).forEach((stage, i) => {
          store.db.prepare('INSERT OR REPLACE INTO run_stages (run_id,seq,name,command,exit_code,duration_ms) VALUES (?,?,?,?,?,?)')
            .run(runId, i, stage.name || ['build', 'lint', 'test'][i] || `stage${i}`, stage.command ?? '', stage.exitCode ?? null, stage.ms ?? null);
        });
        for (const file of result.changed || []) {
          store.db.prepare('INSERT OR REPLACE INTO run_changes (run_id,path,in_scope,reason) VALUES (?,?,?,?)')
            .run(runId, file, 1, null);
        }

        const destRoot = path.join(DATA_DIR, 'evidence', projectId, reqId, taskId, runId);
        for (const entry of manifest.files || []) {
          const src = path.join(dir, entry.path);
          if (!fs.existsSync(src)) continue;
          const dest = path.join(destRoot, entry.path);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(src, dest);
          const bytes = fs.statSync(dest).size;
          const id = `ev_${runId}_${(entry.path.split('/').pop() || 'file').replace(/[^a-zA-Z0-9]+/g, '-')}`;
          const kind = entry.path.endsWith('.patch') ? 'diff'
            : entry.path.endsWith('.json') ? 'result'
              : entry.path.endsWith('changes.txt') ? 'changes'
                : 'log';
          store.addEvidence({
            id, runId, kind,
            relPath: path.relative(DATA_DIR, dest).replace(/\\/g, '/'),
            sha256: sha256(fs.readFileSync(dest)), bytes,
          });
          evidenceCount++;
        }

        store.addEvent({ kind: 'run.finished', projectId, requirementId: reqId, taskId, runId, payload: { status, seeded: true } });
        runs++;
      }
    }
  }
  return { runs, evidence: evidenceCount };
}
