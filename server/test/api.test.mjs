// API 契约冒烟测试：真实起 HTTP，覆盖鉴权、信封、DAG、证据哈希、乐观锁、写域拦截。
// 运行：node server/test/api.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDb, migrate } from '../db.mjs';
import { Store } from '../store.mjs';
import { seedAll } from '../seed.mjs';
import { createServer } from '../http.mjs';

const TOKEN = 'test-token';
const tmpDb = path.join(os.tmpdir(), `devloop-test-${Date.now()}.db`);
const db = openDb(tmpDb);
migrate(db);
const store = new Store(db);
seedAll(store, { log: () => {} });

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

test.after(() => { server.close(); fs.rmSync(tmpDb, { force: true }); });

test('health 不需要鉴权，且带信封', async () => {
  const res = await fetch(`${base}/api/v1/health`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.data.status, 'ok');
  assert.equal(body.meta.apiVersion, 'v1');
  assert.ok(body.meta.requestId);
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

test('DAG 由服务端计算层级与状态', async () => {
  const { json } = await api('GET', '/api/v1/requirements/REQ-100/dag');
  assert.equal(json.data.validated, true);
  assert.deepEqual(json.data.layers, [['T-101'], ['T-102'], ['T-103']]);
  assert.equal(json.data.stats.passed, 3);
});

test('面板坐标与状态全部来自服务端', async () => {
  const { json } = await api('GET', '/api/v1/projects/ledger-cli/panel');
  const nodes = json.data.flow.nodes;
  assert.ok(nodes.every((n) => typeof n.x === 'number' && typeof n.y === 'number'));
  assert.ok(nodes.filter((n) => n.kind === 'task').every((n) => n.status === 'passed'));
});

test('证据内容与库中 sha256 一致', async () => {
  const list = await api('GET', '/api/v1/runs/run_T-101_2/evidence');
  const diff = list.json.data.find((e) => e.kind === 'diff');
  const res = await fetch(`${base}/api/v1/evidence/${diff.id}/content`, { headers: auth });
  const text = await res.text();
  assert.ok(text.startsWith('diff --git'));
  assert.equal(res.headers.get('x-evidence-sha256'), diff.sha256);
});

test('ETag 乐观锁：版本不匹配返回 409', async () => {
  const task = await api('GET', '/api/v1/tasks/T-001');
  assert.equal(task.headers.get('etag'), '"v1"');
  const conflict = await api('PUT', '/api/v1/tasks/T-001', {
    body: { title: 'x' },
    headers: { 'if-match': '"v99"' },
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json.error.code, 'conflict');
});

test('human-only 任务不允许通过 API 执行', async () => {
  const task = store.getTask('T-001');
  store.updateTask('T-001', { ...task, autonomy: 'human-only' }, task.version);
  const res = await api('POST', '/api/v1/tasks/T-001/runs', { body: { actor: 'test' } });
  assert.equal(res.status, 403);
  assert.equal(res.json.error.code, 'policy_denied');
  store.updateTask('T-001', { ...task, autonomy: 'auto' }, store.getTask('T-001').version);
});

test('未知接口返回 404 而不是 500', async () => {
  const res = await api('GET', '/api/v1/nope');
  assert.equal(res.status, 404);
  assert.equal(res.json.error.code, 'not_found');
});
