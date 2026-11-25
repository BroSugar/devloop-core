// PRD CRUD API 契约测试
import assert from 'node:assert/strict';
import test from 'node:test';
import { Store } from '../store.mjs';
import { seedAll } from '../seed.mjs';
import { createServer } from '../http.mjs';
import { createTestDb } from './pg-util.mjs';

const TOKEN = 'test-token';
const db = await createTestDb('prdapi');
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

test('创建 → 读取 → 更新（乐观锁）→ 列表过滤 → reviews 为空', async () => {
  const created = await api('POST', '/api/v1/prds', { body: { projectId: 'ledger-cli', title: '支付回调幂等', content: '初始正文' } });
  assert.equal(created.status, 200);
  const id = created.json.data.id;
  assert.ok(id.startsWith('PRD-'));
  assert.equal(created.json.data.status, 'draft');
  assert.equal(created.json.data.version, 1);
  assert.equal(created.headers.get('etag'), '"v1"');

  const got = await api('GET', `/api/v1/prds/${id}`);
  assert.equal(got.status, 200);
  assert.equal(got.json.data.title, '支付回调幂等');

  const updated = await api('PUT', `/api/v1/prds/${id}`, { body: { title: '支付回调幂等 v2' }, headers: { 'if-match': '"v1"' } });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.data.version, 2);
  assert.equal(updated.json.data.title, '支付回调幂等 v2');
  assert.equal(updated.json.data.status, 'draft'); // 状态由状态机驱动，PUT 不改 status

  const wrongGuard = await api('PUT', `/api/v1/prds/${id}`, { body: { title: 'x' }, headers: { 'if-match': '"v99"' } });
  assert.equal(wrongGuard.status, 409);
  assert.equal(wrongGuard.json.error.code, 'conflict');

  const list = await api('GET', '/api/v1/prds?projectId=ledger-cli');
  assert.equal(list.status, 200);
  assert.ok(list.json.data.some((p) => p.id === id));
  const other = await api('GET', '/api/v1/prds?projectId=order-cancel');
  assert.equal(other.json.data.some((p) => p.id === id), false);

  const reviews = await api('GET', `/api/v1/prds/${id}/reviews`);
  assert.equal(reviews.status, 200);
  assert.deepEqual(reviews.json.data, []);
});

test('缺少 projectId 或 title 返回 400', async () => {
  const r1 = await api('POST', '/api/v1/prds', { body: { title: 'x' } });
  assert.equal(r1.status, 400);
  const r2 = await api('POST', '/api/v1/prds', { body: { projectId: 'ledger-cli' } });
  assert.equal(r2.status, 400);
});
