// 从平台目录（projects/ + repos/ + archive/）导入到 PostgreSQL。
// 配置的权威来源仍然是 Git 里的 project.yaml：服务端只做「快照 + 解析」，
// 这样配置可 review、可回滚，也不存在客户端与服务端双写同一份配置的问题。

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PLATFORM_ROOT, loadConfig, resolve, readYaml } from '../platform/lib/config.mjs';
import { importCards } from './cards/sync.mjs';
import { DATA_DIR } from './db.mjs';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const listDirs = (p) => (fs.existsSync(p) ? fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : []);

export async function seedAll(store, { log = console.log } = {}) {
  const projectsDir = path.join(PLATFORM_ROOT, 'projects');
  const ids = listDirs(projectsDir).filter((id) => fs.existsSync(path.join(projectsDir, id, 'project.yaml')));
  let stats = { projects: 0, runs: 0, evidence: 0 };

  for (const id of ids) {
    let cfg;
    try {
      cfg = resolve(loadConfig(id));
    } catch (e) {
      log(`[seed] 跳过 ${id}：${e.message}`);
      continue;
    }
    const p = cfg.project;
    if (!fs.existsSync(p.repo_path)) {
      log(`[seed] 跳过 ${id}：仓库不存在 ${p.repo_path}（先执行 node scripts/bootstrap.mjs）`);
      continue;
    }

    await store.upsertProject({
      id: p.id, name: p.name, stack: p.stack, repoPath: p.repo_path, defaultBranch: p.branch, cardsMode: p.cards.mode,
    });
    await store.saveConfig(p.id, cfg, cfg.sources);
    stats.projects++;

    // 卡：走同步导入，而不是盲目覆盖 DB。
    // 首次升级（项目还没有任何基线）视为迁移，强制以文件为准。
    const isMigration = (await store.listCardSync(p.id)).length === 0;
    const imported = await importCards(store, p, cfg, { prefer: isMigration ? 'force' : 'safe' });
    if (imported.items.length) {
      const conflicts = imported.items.filter((i) => i.result.startsWith('conflict'));
      log(`[seed] ${p.id}: 导入 ${imported.items.length} 张卡${conflicts.length ? `，冲突 ${conflicts.length} 张（保持 DB 不变，等人工处理）` : ''}`);
    }

    await seedAgents(store, p.id);

    const archived = await seedArchive(store, p.id);
    stats.runs += archived.runs;
    stats.evidence += archived.evidence;

    for (const req of await store.listRequirements(p.id)) {
      await store.recomputeStatuses(req.id);
    }
  }

  const counts = await store.counts();
  log(`[seed] 项目 ${counts.projects} / 需求 ${counts.requirements} / 任务 ${counts.tasks} / 执行 ${counts.runs} / 证据 ${counts.evidence}`);
  return { ...stats, ...counts };
}

async function seedAgents(store, projectId) {
  const agentsFile = path.join(PLATFORM_ROOT, 'config/agents.yaml');
  const providersFile = path.join(PLATFORM_ROOT, 'config/providers.yaml');
  if (!fs.existsSync(agentsFile) || !fs.existsSync(providersFile)) return;
  const doc = readYaml(agentsFile);
  const agents = doc.agents || {};
  const routing = doc.routing || {};
  const providers = readYaml(providersFile).providers || {};

  for (const role of ['decomposer', 'implementer', 'reviewer']) {
    const agentName = routing.by_role?.[role] || routing.default;
    const agent = agents[agentName];
    if (!agent) continue;
    const provider = providers[agent.provider];
    if (!provider) continue;
    const adapter = provider.kind === 'cli' ? 'cli' : provider.kind;
    await store.upsertAgentProfile({
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
  await store.upsertAgentProfile({
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

async function seedArchive(store, projectId) {
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
        await store.upsertRun({
          id: runId, taskId, attempt, status,
          reason: result.reason ?? (status === 'failed' ? '未通过' : null),
          actor: 'seed', agentProfile: null, workspace: null,
          changedFiles: (result.changed || []).length,
          startedAt: result.startedAt ?? null,
          finishedAt: result.finishedAt ?? null,
          createdAt: manifest.archivedAt ?? new Date().toISOString(),
        });

        for (const [i, stage] of (result.stages || []).entries()) {
          await store.addStage(runId, {
            seq: i,
            name: stage.name || ['build', 'lint', 'test'][i] || `stage${i}`,
            command: stage.command ?? '',
            exitCode: stage.exitCode ?? null,
            durationMs: stage.ms ?? null,
          });
        }
        for (const file of result.changed || []) {
          await store.addChange(runId, { path: file, inScope: true, reason: null });
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
          await store.addEvidence({
            id, runId, kind,
            relPath: path.relative(DATA_DIR, dest).replace(/\\/g, '/'),
            sha256: sha256(fs.readFileSync(dest)), bytes,
          });
          evidenceCount++;
        }

        if (!(await store.hasEventForRun(runId))) {
          await store.addEvent({ kind: 'run.finished', projectId, requirementId: reqId, taskId, runId, payload: { status, seeded: true } });
        }
        runs++;
      }
    }
  }
  return { runs, evidence: evidenceCount };
}
