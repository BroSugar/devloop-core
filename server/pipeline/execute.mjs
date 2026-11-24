// 执行编排（服务端）：worktree 隔离 → 写域检查 → 门禁三段 → 证据落库。
// v1 只做「验证 + 证据」，不做自动合并（合并策略属于平台治理，留到 v1.1）。
// PostgreSQL 时代：所有仓储调用都是异步的。

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, ROOT } from '../db.mjs';
import {
  prepareWorktree, changedFiles, diffText, resolveVerify, runLogged, tailFile,
} from '../../platform/lib/runtime.mjs';
import { checkChanges, checkBudget } from '../../platform/lib/policy.mjs';

const pad = (i) => String(i).padStart(2, '0');

function cfgFor(project, config) {
  return {
    project: { id: project.id, repo_path: project.repoPath, branch: project.defaultBranch },
    gates: config.gates || {},
    policy: config.policy || {},
    platform: { env: {} },
    vars: { 'platform.root': ROOT },
  };
}

async function registerEvidence(store, runId, kind, filePath) {
  const bytes = fs.readFileSync(filePath);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const relPath = path.relative(DATA_DIR, filePath).replace(/\\/g, '/');
  const slug = path.basename(filePath).replace(/[^a-zA-Z0-9]+/g, '-');
  const id = `ev_${runId}_${kind}_${slug}`;
  await store.addEvidence({ id, runId, kind, relPath, sha256, bytes: bytes.length });
  return id;
}

export async function executeRun(store, { projectId, taskId, actor = 'api' }) {
  const project = await store.getProject(projectId);
  const task = await store.getTask(taskId);
  if (!project || !task) throw Object.assign(new Error('not found'), { code: 'not_found' });

  const config = (await store.latestConfig(projectId))?.resolved;
  if (!config) throw Object.assign(new Error('项目缺少配置快照'), { code: 'conflict' });

  const cfg = cfgFor(project, config);
  const run = await store.createRun({ taskId, actor });
  const runId = run.id;
  const runDir = path.join(DATA_DIR, 'evidence', projectId, task.requirementId, taskId, runId);
  fs.mkdirSync(runDir, { recursive: true });

  await store.addEvent({ kind: 'run.created', projectId, requirementId: task.requirementId, taskId, runId, payload: { attempt: run.attempt } });
  await store.startRun(runId, { workspace: null });

  const fail = async (reason) => {
    await writeResult(store, runId, runDir, { runId, status: 'failed', reason });
    await store.finishRun(runId, { status: 'failed', reason, changedFiles: 0 });
    return store.getRun(runId);
  };

  let wt;
  try {
    ({ wt } = prepareWorktree(cfg, taskId));
  } catch (e) {
    return fail(`工作区准备失败：${e.message}`);
  }

  const changed = changedFiles(wt);
  fs.writeFileSync(path.join(runDir, 'changes.txt'), `${changed.join('\n')}\n`);
  fs.writeFileSync(path.join(runDir, 'diff.patch'), diffText(wt));
  await registerEvidence(store, runId, 'changes', path.join(runDir, 'changes.txt'));
  await registerEvidence(store, runId, 'diff', path.join(runDir, 'diff.patch'));

  if (!changed.length) return fail('没有任何文件变更，任务未产生实现');

  const { violations } = checkChanges(changed, { scope: task.scope }, config.policy || {});
  const budgets = checkBudget({ files: changed, diffLines: 0, policy: config.policy || {} });
  for (const file of changed) {
    const v = violations.find((x) => x.file === file);
    await store.addChange(runId, { path: file, inScope: !v, reason: v?.reason ?? null });
  }
  if (violations.length || budgets.length) {
    const reason = `写域/预算校验失败：${[...violations.map((v) => `${v.file}(${v.reason})`), ...budgets].join('; ')}`;
    await writeResult(store, runId, runDir, { runId, status: 'failed', reason, changes: await store.listChanges(runId) });
    await store.finishRun(runId, { status: 'failed', reason, changedFiles: changed.length });
    return store.getRun(runId);
  }

  const stages = resolveVerify(cfg, task.verify.map((v) => v.ref), wt);
  const results = [];
  let verdict = 'passed';

  for (const [i, stage] of stages.entries()) {
    const logFile = path.join(runDir, `${pad(i)}-${stage.name}.log`);
    const r = runLogged(stage.command, { cwd: stage.cwd, env: stage.env, logFile, timeoutMs: stage.timeout_ms });
    const evId = await registerEvidence(store, runId, 'log', logFile);
    await store.addStage(runId, { seq: i, name: stage.name, command: stage.command, exitCode: r.exitCode, durationMs: r.ms, logEvidenceId: evId });
    results.push({ name: stage.name, command: stage.command, exitCode: r.exitCode, durationMs: r.ms, tail: tailFile(logFile, 20) });
    if (r.exitCode !== 0) { verdict = 'failed'; break; }
  }

  await writeResult(store, runId, runDir, {
    runId, taskId, attempt: run.attempt, status: verdict,
    changed, stages: results, changes: await store.listChanges(runId),
  });
  await store.finishRun(runId, {
    status: verdict,
    reason: verdict === 'passed' ? null : `门禁失败于 ${results.at(-1)?.name}`,
    changedFiles: changed.length,
  });
  return store.getRun(runId);
}

async function writeResult(store, runId, runDir, payload) {
  const file = path.join(runDir, 'result.json');
  fs.writeFileSync(file, `${JSON.stringify({ ...payload, at: new Date().toISOString() }, null, 2)}\n`);
  await registerEvidence(store, runId, 'result', file);
}
