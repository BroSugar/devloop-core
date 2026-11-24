// API 契约冒烟测试：真实起 HTTP，覆盖鉴权、信封、DAG、自足的执行闭环、证据哈希、乐观锁、策略拦截。
// 不依赖预先导入的 archive：执行闭环自己跑一遍，保证干净 clone 也能通过。
// PostgreSQL：每个测试文件用独立数据库。

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ROOT } from '../db.mjs';
import { Store } from '../store.mjs';
import { seedAll } from '../seed.mjs';
import { createServer } from '../http.mjs';
import { createTestDb } from './pg-util.mjs';

const TOKEN = 'test-token';
const db = await createTestDb('api');
const store = new Store(db.pool);
await seedAll(store, { log: () => {} });

const server = createServer({ store, token: TOKEN });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const auth = { authorization: `Bearer ${TOKEN}` };

async function api(method, p, { body, headers = {} } = {}) {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: { ...auth, ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  return { status: res.status, json, headers: res.headers };
}

test.after(async () => {
  try { server.close(); } catch { /* 已关闭 */ }
  await db.drop();
});

test('health 不需要鉴权，且带信封', async () => {
  const res = await fetch(`${base}/api/v1/health`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.data.status, 'ok');
  assert.equal(body.data.db, 'postgres');
  assert.equal(body.meta.apiVersion, 'v1');
  assert.ok(body.meta.requestId);
  assert.equal(typeof body.data.counts.tasks, 'number');
});

test('缺少 token 返回 401 + unauthorized', async () => {
  const res = await fetch(`${base}/api/v1/projects`);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error.code, 'unauthorized');
});

test('项目列表包含门禁来源（配置可解释性）', async () => {
  const { status, json } = await api('GET', '/api/v1/projects');
  assert.equal(status, 200);
  assert.ok(json.data.length >= 2);
  const ledger = json.data.find((p) => p.id === 'ledger-cli');
  assert.equal(ledger.gates.build.command, 'go build ./...');
  assert.match(ledger.gates.build.source, /preset:/);
});

test('DAG 由服务端计算层级（不依赖历史执行）', async () => {
  const { json } = await api('GET', '/api/v1/requirements/REQ-100/dag');
  assert.equal(json.data.validated, true);
  assert.deepEqual(json.data.layers, [['T-101'], ['T-102'], ['T-103']]);
  assert.equal(json.data.stats.total, 3);
  assert.ok(json.data.nodes.every((n) => ['pending', 'ready', 'running', 'passed', 'failed', 'blocked'].includes(n.status)));
});

test('面板坐标与状态全部来自服务端', async () => {
  const { json } = await api('GET', '/api/v1/projects/ledger-cli/panel');
  const nodes = json.data.flow.nodes;
  assert.ok(nodes.length >= 4);
  assert.ok(nodes.every((n) => typeof n.x === 'number' && typeof n.y === 'number'));
  assert.ok(nodes.every((n) => typeof n.status === 'string' && n.status.length > 0));
  assert.ok(json.data.flow.edges.length >= 3);
});

test('ETag 乐观锁：版本不匹配返回 409', async () => {
  const task = await api('GET', '/api/v1/tasks/T-001');
  assert.equal(task.headers.get('etag'), '"v1"');
  const conflictRes = await api('PUT', '/api/v1/tasks/T-001', {
    body: { title: 'x' },
    headers: { 'if-match': '"v99"' },
  });
  assert.equal(conflictRes.status, 409);
  assert.equal(conflictRes.json.error.code, 'conflict');
});

test('human-only 任务不允许通过 API 执行', async () => {
  const task = await store.getTask('T-001');
  await store.updateTask('T-001', { ...task, autonomy: 'human-only' }, task.version);
  const res = await api('POST', '/api/v1/tasks/T-001/runs', { body: { actor: 'test' } });
  assert.equal(res.status, 403);
  assert.equal(res.json.error.code, 'policy_denied');
  const after = await store.getTask('T-001');
  await store.updateTask('T-001', { ...task, autonomy: 'auto', scope: task.scope }, after.version);
});

test('未知接口返回 404 而不是 500', async () => {
  const res = await api('GET', '/api/v1/nope');
  assert.equal(res.status, 404);
  assert.equal(res.json.error.code, 'not_found');
});

// 自足的执行闭环：不依赖 archive/，自己写实现、跑门禁、验证据、验写域拦截。
test('执行闭环：无变更失败 → 写入实现通过 → 证据可校验 → 改测试被拒', async () => {
  const wt = path.join(ROOT, 'worktrees', 'demo-clamp', 'T-001');
  const resetWorktree = () => {
    if (!fs.existsSync(wt)) return;
    spawnSync('git', ['-C', wt, 'checkout', '--', '.'], { stdio: 'ignore' });
    spawnSync('git', ['-C', wt, 'clean', '-fdq'], { stdio: 'ignore' });
  };

  await api('POST', '/api/v1/tasks/T-001/runs', { body: { actor: 'test' } });
  resetWorktree();

  const first = await api('POST', '/api/v1/tasks/T-001/runs', { body: { actor: 'test' } });
  assert.equal(first.status, 202);
  assert.equal(first.json.data.status, 'failed');
  assert.match(first.json.data.reason, /没有任何文件变更/);

  assert.equal(fs.existsSync(wt), true, 'worktree 应已创建');
  const impl = [
    'export function clamp(value, min, max) {',
    '  if (min > max) throw new Error(`非法区间：[${min}, ${max}]`);',
    '  if (value < min) return min;',
    '  if (value > max) return max;',
    '  return value;',
    '}',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(wt, 'src/calc.mjs'), impl);

  const second = await api('POST', '/api/v1/tasks/T-001/runs', { body: { actor: 'test' } });
  assert.equal(second.json.data.status, 'passed', second.json.data.reason);
  assert.equal(second.json.data.changedFiles, 1);
  assert.equal(second.json.data.stages.length, 3);
  assert.ok(second.json.data.stages.every((s) => s.exitCode === 0));

  const list = await api('GET', `/api/v1/runs/${second.json.data.id}/evidence`);
  const kinds = list.json.data.map((e) => e.kind);
  assert.ok(kinds.includes('diff'));
  assert.ok(kinds.includes('log'));
  assert.ok(kinds.includes('result'));

  const diff = list.json.data.find((e) => e.kind === 'diff');
  const content = await fetch(`${base}/api/v1/evidence/${diff.id}/content`, { headers: auth });
  const text = await content.text();
  assert.ok(text.includes('calc.mjs'));
  assert.equal(content.headers.get('x-evidence-sha256'), diff.sha256);

  const testFile = path.join(wt, 'src/calc.test.mjs');
  const original = fs.readFileSync(testFile, 'utf8');
  fs.appendFileSync(testFile, '\n// tamper\n');
  const tampered = await api('POST', '/api/v1/tasks/T-001/runs', { body: { actor: 'test' } });
  assert.equal(tampered.json.data.status, 'failed');
  assert.match(tampered.json.data.reason, /deny/);
  fs.writeFileSync(testFile, original);
});
