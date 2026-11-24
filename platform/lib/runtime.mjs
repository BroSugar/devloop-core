// 执行运行时：子进程（禁管道，全部走文件重定向）+ git 仓库/worktree + 门禁解析。
//
// 说明：本沙箱禁止子进程管道 stdio（EPERM），所以命令输出一律重定向到文件再读回。
// 这反而符合平台要求——每一次门禁执行都必须留下可归档的日志。

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function mkTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-platform-'));
}

/** 执行命令并返回捕获的输出（stdout/stderr 分离）。 */
export function runCaptured(command, { cwd, env, timeoutMs = 600000 } = {}) {
  const dir = mkTempDir();
  const outFile = path.join(dir, 'out.log');
  const errFile = path.join(dir, 'err.log');
  const outFd = fs.openSync(outFile, 'w');
  const errFd = fs.openSync(errFile, 'w');
  const started = Date.now();
  let result;
  try {
    result = spawnSync(command, {
      cwd,
      shell: true,
      stdio: ['ignore', outFd, errFd],
      timeout: timeoutMs,
      windowsHide: true,
      env: { ...process.env, ...(env || {}) },
    });
  } finally {
    fs.closeSync(outFd);
    fs.closeSync(errFd);
  }
  const out = fs.readFileSync(outFile, 'utf8');
  const err = fs.readFileSync(errFile, 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  return {
    command,
    exitCode: result.error ? -1 : (result.status ?? -1),
    out,
    err,
    ms: Date.now() - started,
    error: result.error?.message,
  };
}

/** 执行命令并把合并输出写入日志文件（门禁证据）。 */
export function runLogged(command, { cwd, env, logFile, timeoutMs = 600000 }) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const fd = fs.openSync(logFile, 'w');
  const started = Date.now();
  let result;
  try {
    result = spawnSync(command, {
      cwd,
      shell: true,
      stdio: ['ignore', fd, fd],
      timeout: timeoutMs,
      windowsHide: true,
      env: { ...process.env, ...(env || {}) },
    });
  } finally {
    fs.closeSync(fd);
  }
  return {
    command,
    exitCode: result.error ? -1 : (result.status ?? -1),
    ms: Date.now() - started,
    logFile,
  };
}

export function tailFile(file, lines = 30) {
  if (!fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(-lines).join('\n').trimEnd();
}

// ---------- git ----------

export const git = (cwd, args, opts = {}) => runCaptured(`git ${args}`, { cwd, ...opts });

export function ensureRepo(cfg) {
  const repo = cfg.project.repo_path;
  if (!fs.existsSync(repo)) throw new Error(`仓库路径不存在：${repo}（检查 project.yaml 的 repo.path）`);
  const r = git(repo, 'rev-parse --is-inside-work-tree');
  if (r.exitCode !== 0) throw new Error(`不是 git 仓库：${repo}`);
  const b = git(repo, 'rev-parse --abbrev-ref HEAD');
  if (b.out.trim() !== cfg.project.branch) {
    throw new Error(`仓库应在 ${cfg.project.branch} 分支上，当前是 ${b.out.trim()}`);
  }
  return { repo, branch: cfg.project.branch, head: git(repo, 'rev-parse HEAD').out.trim() };
}

export function worktreePath(cfg, taskId) {
  return path.join(cfg.platform_root || path.join(cfg.vars['platform.root'], 'worktrees'), cfg.project.id, taskId);
}

export function prepareWorktree(cfg, taskId, { fresh = false } = {}) {
  const root = cfg.vars['platform.root'];
  const repo = cfg.project.repo_path;
  const wt = path.join(root, 'worktrees', cfg.project.id, taskId);
  const branch = `task/${cfg.project.id}/${taskId}`;
  fs.mkdirSync(path.dirname(wt), { recursive: true });

  if (fresh && fs.existsSync(wt)) git(repo, `worktree remove --force "${wt}"`);
  if (!fs.existsSync(wt)) {
    const exists = git(repo, `rev-parse --verify --quiet ${branch}`).exitCode === 0;
    const cmd = exists
      ? `worktree add --force "${wt}" ${branch}`
      : `worktree add -b ${branch} "${wt}" ${cfg.project.branch}`;
    const r = git(repo, cmd);
    if (r.exitCode !== 0) throw new Error(`创建 worktree 失败：${r.err || r.out}`);
  } else if (!fresh) {
    // 基线刷新：worktree 干净且没有本地提交时，对齐到最新基线。
    // 执行顺序规范是“依赖合并后再 prepare”，这条兜底防止拿着陈旧基线跑验证。
    const dirty = changedFiles(wt).length;
    const ahead = Number(git(wt, `rev-list --count ${cfg.project.branch}..HEAD`).out.trim() || '0');
    if (!dirty && ahead === 0) git(wt, `reset --hard ${cfg.project.branch}`);
  }
  return { wt, branch };
}

export function removeWorktree(cfg, taskId) {
  const wt = path.join(cfg.vars['platform.root'], 'worktrees', cfg.project.id, taskId);
  if (fs.existsSync(wt)) git(cfg.project.repo_path, `worktree remove --force "${wt}"`);
}

export function changedFiles(wt) {
  const r = git(wt, 'status --porcelain=v1 -uall');
  if (r.exitCode !== 0) throw new Error(`git status 失败：${r.err}`);
  return r.out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3).trim().replace(/^"|"$/g, ''))
    .map((p) => p.replace(/\\/g, '/'));
}

export function diffText(wt) {
  return git(wt, 'diff').out || '';
}

export function commitAll(wt, message) {
  const add = git(wt, 'add -A');
  if (add.exitCode !== 0) throw new Error(`git add 失败：${add.err}`);
  const commit = git(wt, `commit -m "${message.replace(/"/g, "'")}"`);
  if (commit.exitCode !== 0) throw new Error(`git commit 失败：${commit.err || commit.out}`);
  return git(wt, 'rev-parse HEAD').out.trim();
}

export function mergeInto(cfg, branch, message) {
  const repo = cfg.project.repo_path;
  const before = git(repo, 'rev-parse HEAD').out.trim();
  const r = git(repo, `merge --no-ff ${branch} -m "${message.replace(/"/g, "'")}"`);
  if (r.exitCode !== 0) {
    git(repo, 'merge --abort');
    throw new Error(`合并失败：${r.err || r.out}`);
  }
  return { before, after: git(repo, 'rev-parse HEAD').out.trim() };
}

export function resetTo(cfg, sha) {
  git(cfg.project.repo_path, `reset --hard ${sha}`);
}

// ---------- 门禁 ----------

/**
 * 把卡里的 verify 引用解析成可执行阶段。
 * 引用命中配置里的 gate 名（build/lint/test/...）就用统一门禁定义，否则当作裸命令。
 * baseDir 决定命令在哪个工作区执行：任务验证必须指向隔离 worktree，合并后复验指向主仓。
 */
export function resolveVerify(cfg, refs, baseDir = cfg.project.repo_path) {
  const baseEnv = { ...(cfg.platform?.env || {}), ...(cfg.gates?.env || {}) };
  return (refs || []).map((ref, i) => {
    const gate = cfg.gates?.[ref];
    if (gate && typeof gate === 'object' && gate.command) {
      return {
        name: ref,
        command: gate.command,
        cwd: gate.cwd ? path.resolve(baseDir, gate.cwd) : baseDir,
        env: { ...baseEnv, ...(gate.env || {}) },
        timeout_ms: gate.timeout_ms ?? cfg.policy?.timeout_ms ?? 600000,
      };
    }
    if (typeof gate === 'string') {
      return { name: ref, command: gate, cwd: baseDir, env: baseEnv, timeout_ms: cfg.policy?.timeout_ms ?? 600000 };
    }
    return { name: 'custom', command: String(ref), cwd: baseDir, env: baseEnv, timeout_ms: cfg.policy?.timeout_ms ?? 600000 };
  });
}

export function runVerify(stages, { runDir }) {
  fs.mkdirSync(runDir, { recursive: true });
  const results = [];
  let verdict = 'pass';
  for (const [i, stage] of stages.entries()) {
    const logFile = path.join(runDir, `${String(i).padStart(2, '0')}-${stage.name}.log`);
    const r = runLogged(stage.command, {
      cwd: stage.cwd,
      env: stage.env,
      logFile,
      timeoutMs: stage.timeout_ms,
    });
    results.push({
      name: stage.name,
      command: stage.command,
      exitCode: r.exitCode,
      ms: r.ms,
      log: path.relative(path.dirname(runDir), logFile).replace(/\\/g, '/'),
      tail: tailFile(logFile, 40),
    });
    if (r.exitCode !== 0) { verdict = 'fail'; break; }
  }
  return { verdict, stages: results };
}
