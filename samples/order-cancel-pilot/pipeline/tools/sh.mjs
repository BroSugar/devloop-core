// 子进程执行工具。
// 注意：本执行环境禁止子进程使用管道 stdio（会 EPERM），所以一律把 stdout/stderr
// 重定向到临时文件再读回来。这不是权宜之计 —— “命令输出落盘”本来就是证据链的要求。

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tmpSeq = 0;
function tmpFile(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pilot-'));
  return path.join(dir, `${tag}-${tmpSeq++}.log`);
}

/**
 * @returns {{exitCode:number, out:string, err:string, ms:number}}
 */
export function run(command, { cwd = process.cwd(), timeoutMs = 600000, env } = {}) {
  const outFile = tmpFile('out');
  const errFile = tmpFile('err');
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
  const ms = Date.now() - started;
  const out = fs.readFileSync(outFile, 'utf8');
  const err = fs.readFileSync(errFile, 'utf8');
  fs.rmSync(path.dirname(outFile), { recursive: true, force: true });
  const exitCode = result.error ? -1 : (result.status ?? -1);
  return { exitCode, out, err, ms, error: result.error?.message };
}

/** 同 run，但把合并输出直接写入指定日志文件（用于 verify 证据）。 */
export function runLogged(command, { cwd = process.cwd(), logFile, timeoutMs = 600000 }) {
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
    });
  } finally {
    fs.closeSync(fd);
  }
  const ms = Date.now() - started;
  return { command, exitCode: result.error ? -1 : (result.status ?? -1), ms, logFile };
}

export function git(args, { cwd, timeoutMs = 120000 } = {}) {
  const r = run(`git ${args}`, { cwd, timeoutMs });
  return r;
}
