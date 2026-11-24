// 三段式验证执行器：build → lint → test，短路 + 日志落盘。
// 每段是一条完整的 shell 命令，命令本身与仓库无关，换仓库时只改卡或 verify.json。

import fs from 'node:fs';
import path from 'node:path';
import { runLogged } from './sh.mjs';

export const DEFAULT_STAGES = [
  { name: 'build', command: 'node pipeline/tools/gates/smoke.mjs' },
  { name: 'lint', command: 'node pipeline/tools/gates/lint.mjs' },
  { name: 'test', command: 'node pipeline/tools/gates/tests.mjs' },
];

/**
 * @param {string[]} commands 任务卡里的 verify 命令
 * @param {{cwd:string, runDir:string, timeoutMs?:number}} opts
 */
export function runVerify(commands, { cwd, runDir, timeoutMs = 600000 }) {
  fs.mkdirSync(runDir, { recursive: true });
  const stages = [];
  let verdict = 'pass';
  for (const [i, command] of commands.entries()) {
    const logFile = path.join(runDir, `${String(i).padStart(2, '0')}-${slug(command)}.log`);
    const r = runLogged(command, { cwd, logFile, timeoutMs });
    const tail = tailOf(logFile, 40);
    stages.push({ index: i, command, exitCode: r.exitCode, ms: r.ms, logFile: path.relative(path.dirname(runDir), logFile).replace(/\\/g, '/'), tail });
    if (r.exitCode !== 0) { verdict = 'fail'; break; }
  }
  return { verdict, stages };
}

function slug(command) {
  return command.split(/\s+/).slice(0, 4).join('-').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 40) || 'cmd';
}

export function tailOf(logFile, lines = 30) {
  if (!fs.existsSync(logFile)) return '';
  const all = fs.readFileSync(logFile, 'utf8').split(/\r?\n/);
  return all.slice(-lines).join('\n').trimEnd();
}
