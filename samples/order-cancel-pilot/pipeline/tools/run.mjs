#!/usr/bin/env node
// 单任务执行器：worktree 隔离 → 变更越界检查 → 三段验证 → 证据落盘 → 串行合并 + 全量复验。
//
// 用法：
//   node pipeline/tools/run.mjs T-0122            # 隔离执行 + 合并
//   node pipeline/tools/run.mjs T-0122 --no-merge # 只验证，不合并
//   node pipeline/tools/run.mjs T-0122 --fresh    # 丢弃旧 worktree 重建
//   node pipeline/tools/run.mjs --all             # 按 DAG 顺序跑完所有任务

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCards, validateTask, taskDeps } from './cards.mjs';
import { checkChanges } from './scope.mjs';
import { runVerify } from './verify.mjs';
import { run, git } from './sh.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TASK_DIR = path.join(ROOT, 'pipeline/tasks');
const RUNS = path.join(ROOT, 'pipeline/.runs');
const WT_ROOT = path.join(ROOT, '.worktrees');

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const positional = args.filter((a) => !a.startsWith('--'));

function die(msg) {
  console.error(`\n[run] ${msg}\n`);
  process.exit(1);
}

function ensureGit() {
  const r = git('rev-parse --is-inside-work-tree', { cwd: ROOT });
  if (r.exitCode !== 0) die('当前目录不是 git 仓库，无法创建 worktree');
  const b = git('rev-parse --abbrev-ref HEAD', { cwd: ROOT });
  if (b.out.trim() !== 'main') die(`工作区必须在 main 分支上（当前 ${b.out.trim()}）`);
}

function statusFiles(wt) {
  const r = git('status --porcelain=v1 -uall', { cwd: wt });
  if (r.exitCode !== 0) die(`git status 失败：${r.err}`);
  return r.out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3).trim().replace(/^"|"$/g, ''))
    .map((p) => p.replace(/\\/g, '/'));
}

function prepareWorktree(taskId, fresh) {
  const wt = path.join(WT_ROOT, taskId);
  const branch = `task/${taskId}`;
  if (fresh && fs.existsSync(wt)) {
    git(`worktree remove --force ${rel(wt)}`, { cwd: ROOT });
  }
  if (!fs.existsSync(wt)) {
    fs.mkdirSync(WT_ROOT, { recursive: true });
    const exists = git(`rev-parse --verify --quiet ${branch}`, { cwd: ROOT }).exitCode === 0;
    const cmd = exists ? `worktree add --force ${rel(wt)} ${branch}` : `worktree add -b ${branch} ${rel(wt)} main`;
    const r = git(cmd, { cwd: ROOT });
    if (r.exitCode !== 0) die(`创建 worktree 失败：${r.err || r.out}`);
  }
  // 让工作树与 main 对齐（保留未提交改动时由调用方决定是否 --fresh）
  return { wt, branch };
}

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, '/');
}

function nextAttempt(taskId) {
  const dir = path.join(RUNS, taskId);
  if (!fs.existsSync(dir)) return 1;
  return fs.readdirSync(dir).filter((d) => /^attempt-\d+$/.test(d)).length + 1;
}

function writeLedger(entry) {
  fs.mkdirSync(RUNS, { recursive: true });
  fs.appendFileSync(path.join(RUNS, 'ledger.jsonl'), `${JSON.stringify(entry)}\n`);
}

function executeTask(card, { merge = true } = {}) {
  const taskId = card.id;
  ensureGit();
  const { wt, branch } = prepareWorktree(taskId, flags.has('--fresh'));
  const attempt = nextAttempt(taskId);
  const runDir = path.join(RUNS, taskId, `attempt-${attempt}`);

  const startedAt = new Date().toISOString();
  const changed = statusFiles(wt);
  console.log(`\n[run] ${taskId} ${card.title}`);
  console.log(`[run] worktree=${rel(wt)} attempt=${attempt} 变更文件=${changed.length}`);

  const policy = { deny_write: ['**/*.test.mjs', '**/*.spec.mjs', 'pipeline/tasks/**', 'pipeline/spec/**'] };
  const { allowed, violations } = checkChanges(changed, card, policy);

  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'changes.txt'), `${changed.join('\n')}\n`);
  const diff = run('git diff', { cwd: wt });
  fs.writeFileSync(path.join(runDir, 'diff.patch'), diff.out || '');

  if (changed.length === 0) {
    finish({ verdict: 'fail', reason: '没有任何文件变更，任务未产生实现' });
    return 1;
  }
  if (violations.length) {
    for (const v of violations) console.log(`[run]   x 越界 ${v.file}  (${v.reason}: ${v.detail})`);
    finish({ verdict: 'fail', reason: `写域越界 ${violations.length} 个文件` });
    return 1;
  }

  const commands = card.verify?.length ? card.verify : [];
  const { verdict, stages } = runVerify(commands, { cwd: wt, runDir });
  for (const s of stages) {
    console.log(`[run]   ${s.exitCode === 0 ? 'ok' : 'FAIL'} ${s.command} (${s.ms}ms)`);
    if (s.exitCode !== 0) console.log(indent(s.tail, '        '));
  }
  if (verdict !== 'pass') {
    finish({ verdict: 'fail', reason: '验证未通过', stages });
    return 1;
  }
  if (!merge) {
    finish({ verdict: 'pass', merged: false, stages });
    return 0;
  }

  // 串行合并：先提交，再合并到 main，再在 main 上跑全量验证
  const commit = git(`add -A`, { cwd: wt });
  if (commit.exitCode !== 0) die('git add 失败');
  const msg = `feat(${taskId}): ${card.title}`;
  const c = git(`commit -m "${msg.replace(/"/g, "'")}"`, { cwd: wt });
  if (c.exitCode !== 0) {
    finish({ verdict: 'fail', reason: `提交失败：${c.err || c.out}` });
    return 1;
  }
  const beforeMerge = git('rev-parse HEAD', { cwd: ROOT }).out.trim();
  const m = git(`merge --no-ff ${branch} -m "merge(${taskId}): ${card.title.replace(/"/g, "'")}"`, { cwd: ROOT });
  if (m.exitCode !== 0) {
    git('merge --abort', { cwd: ROOT });
    finish({ verdict: 'fail', reason: `合并冲突：${m.err || m.out}` });
    return 1;
  }
  console.log(`[run]   已合并 ${branch} → main，执行全量复验`);
  const full = runVerify(commands, { cwd: ROOT, runDir: path.join(runDir, 'merge-verify') });
  for (const s of full.stages) {
    console.log(`[run]   ${s.exitCode === 0 ? 'ok' : 'FAIL'} (main) ${s.command}`);
    if (s.exitCode !== 0) console.log(indent(s.tail, '        '));
  }
  if (full.verdict !== 'pass') {
    git(`reset --hard ${beforeMerge}`, { cwd: ROOT });
    finish({ verdict: 'fail', reason: '合并后 main 上验证失败，已回滚', stages: full.stages });
    return 1;
  }
  git(`worktree remove --force ${rel(wt)}`, { cwd: ROOT });
  finish({ verdict: 'pass', merged: true, stages });
  return 0;

  function finish(extra) {
    const { stages: stageList = [], ...rest } = extra || {};
    const result = {
      taskId,
      attempt,
      startedAt,
      finishedAt: new Date().toISOString(),
      changed,
      violations,
      stages: stageList,
      ...rest,
    };
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
    writeLedger({
      taskId, attempt, at: new Date().toISOString(),
      verdict: result.verdict, merged: !!result.merged, reason: result.reason, runDir: rel(runDir),
    });
    const label = result.verdict === 'pass'
      ? (result.merged ? 'PASS + 已合并' : 'PASS（未合并）')
      : `FAIL：${result.reason}`;
    console.log(`[run] 结论 ${label} · 证据 ${rel(runDir)}`);
  }
}

function indent(text, pad) {
  return String(text || '').split('\n').map((l) => pad + l).join('\n');
}

function loadTaskCards() {
  return loadCards(TASK_DIR, { root: ROOT }).filter((c) => c.id);
}

function topoOrder(cards) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const out = [];
  const done = new Set();
  const visit = (id) => {
    if (done.has(id)) return;
    const c = byId.get(id);
    if (!c) return;
    for (const d of taskDeps(c)) visit(d);
    done.add(id);
    out.push(c);
  };
  for (const c of cards) visit(c.id);
  return out;
}

const cards = loadTaskCards();
if (flags.has('--all')) {
  const targets = topoOrder(cards);
  let failed = 0;
  for (const card of targets) {
    const errs = validateTask(card);
    if (errs.length) { console.error(`[run] ${card.id} 卡不合法：${errs.join('; ')}`); failed++; continue; }
    if (executeTask(card, { merge: true }) !== 0) { failed++; break; }
  }
  process.exit(failed ? 1 : 0);
} else {
  const id = positional[0];
  if (!id) die('用法：node pipeline/tools/run.mjs <T-XXXX> [--no-merge] [--fresh] 或 --all');
  const card = cards.find((c) => c.id === id);
  if (!card) die(`找不到任务卡 ${id}`);
  const errs = validateTask(card);
  if (errs.length) die(`任务卡不合法：\n  ${errs.join('\n  ')}`);
  if (flags.has('--prepare')) {
    ensureGit();
    const { wt } = prepareWorktree(card.id, flags.has('--fresh'));
    console.log(`[run] worktree 就绪：${rel(wt)}（分支 task/${card.id}）`);
    process.exit(0);
  }
  process.exit(executeTask(card, { merge: !flags.has('--no-merge') }));
}
