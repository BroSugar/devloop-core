// 卡的规范化表示 + 哈希 + YAML 渲染。
// 规范化是冲突检测的基准：只有 DB 侧表示稳定，三方比较才有意义。

import crypto from 'node:crypto';

export function canonicalRequirement(req) {
  return {
    id: req.id,
    title: req.title,
    status: req.status,
    autonomy: req.autonomy,
    owner: req.owner ?? null,
    summary: req.summary ?? null,
    acceptance: (req.acceptance || []).map((a) => ({ id: a.id, text: a.text, verifyBy: a.verifyBy })),
  };
}

export function canonicalTask(task) {
  return {
    id: task.id,
    requirementId: task.requirementId,
    title: task.title,
    objective: task.objective ?? null,
    autonomy: task.autonomy,
    deps: [...(task.deps || [])].sort(),
    scope: {
      write: [...(task.scope?.write || [])],
      read: [...(task.scope?.read || [])],
      deny: [...(task.scope?.deny || [])],
    },
    verify: (task.verify || []).map((v) => (typeof v === 'string' ? v : v.ref)),
    acceptance: [...(task.acceptance || [])].sort(),
  };
}

export function hashOf(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

// ---------- YAML 渲染 ----------
// 目标：输出能被标准 YAML 与平台自带解析器同时读回；不保留原文件注释（导出即规范化）。

const NEEDS_QUOTE = /[:#\n"']|^[-?*&!|>%@`{}[\],]|^\s|\s$/;

function scalar(value) {
  if (value === null || value === undefined) return 'null';
  const s = String(value);
  if (s === '') return '""';
  if (/^(true|false|null|~|-?\d+(\.\d+)?)$/.test(s)) return `"${s}"`;
  if (NEEDS_QUOTE.test(s) || s.includes('*')) return JSON.stringify(s);
  return s;
}

function block(text, indent) {
  const pad = ' '.repeat(indent);
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  return lines.map((l) => (l === '' ? '' : pad + l)).join('\n');
}

function list(items, indent) {
  const pad = ' '.repeat(indent);
  return items.map((i) => `${pad}- ${scalar(i)}`).join('\n');
}

export function renderRequirement(req) {
  const c = canonicalRequirement(req);
  const out = [];
  out.push(`id: ${scalar(c.id)}`);
  out.push(`title: ${scalar(c.title)}`);
  out.push(`status: ${scalar(c.status)}`);
  out.push(`autonomy: ${scalar(c.autonomy)}`);
  if (c.owner) out.push(`owner: ${scalar(c.owner)}`);
  if (c.summary) {
    out.push('summary: |');
    out.push(block(c.summary, 2));
  }
  out.push('acceptance:');
  for (const ac of c.acceptance) {
    out.push(`  - id: ${scalar(ac.id)}`);
    out.push(`    text: ${scalar(ac.text)}`);
    out.push(`    verify_by: ${scalar(ac.verifyBy)}`);
  }
  return `${out.join('\n')}\n`;
}

export function renderTask(task) {
  const c = canonicalTask(task);
  const out = [];
  out.push(`id: ${scalar(c.id)}`);
  out.push(`title: ${scalar(c.title)}`);
  out.push(`requirement: ${scalar(c.requirementId)}`);
  out.push(`autonomy: ${scalar(c.autonomy)}`);
  out.push(`depends_on: [${c.deps.map((d) => scalar(d)).join(', ')}]`);
  if (c.objective) {
    out.push('objective: |');
    out.push(block(c.objective, 2));
  }
  out.push('scope:');
  for (const kind of ['write', 'read', 'deny']) {
    const items = c.scope[kind];
    if (!items.length) continue;
    out.push(`  ${kind}:`);
    out.push(list(items, 4));
  }
  out.push(`acceptance: [${c.acceptance.map((a) => scalar(a)).join(', ')}]`);
  out.push('verify:');
  out.push(list(c.verify, 2));
  return `${out.join('\n')}\n`;
}

export const renderers = { requirement: renderRequirement, task: renderTask };
export const canonicalizers = { requirement: canonicalRequirement, task: canonicalTask };
