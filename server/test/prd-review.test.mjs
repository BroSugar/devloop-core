// PRD 完善/审核编排契约测试：mock invokeFn，验证状态机、证据钉住、循环上限、失败回退。
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { Store } from '../store.mjs';
import { seedAll } from '../seed.mjs';
import { refinePrd, reviewPrd } from '../prd/execute.mjs';
import { createTestDb } from './pg-util.mjs';

const sha256 = (s) => crypto.createHash('sha256').update(String(s ?? '')).digest('hex');

const db = await createTestDb('prdreview');
const store = new Store(db.pool);
await seedAll(store, { log: () => {} });

test.after(async () => { await db.drop(); });

let seq = 0;
async function createPrd(content = '原始正文') {
  seq += 1;
  return store.upsertPrd({ id: `PRD-T${seq}`, projectId: 'ledger-cli', title: `PRD ${seq}`, content });
}

const mockRefine = (append) => async ({ prdContent }) => `${prdContent}\n${append}`;
const mockReview = (verdict, findings = []) => async () => JSON.stringify({ verdict, findings });

test('refine 后状态=reviewing，且钉住输入哈希与版本', async () => {
  const prd = await createPrd('原始正文');
  const inputSha = sha256('原始正文');
  const after = await refinePrd(store, prd.id, { invokeFn: mockRefine('补齐的结构') });
  assert.equal(after.status, 'reviewing');
  assert.ok(after.content.includes('补齐的结构'));

  const reviews = await store.listPrdReviews(prd.id);
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].kind, 'refine');
  assert.equal(reviews[0].status, 'passed');
  assert.equal(reviews[0].contentSha256, inputSha);
  assert.equal(reviews[0].contentVersion, 1);
});

test('review pass → approved', async () => {
  const prd = await createPrd();
  await refinePrd(store, prd.id, { invokeFn: mockRefine('x') });
  const after = await reviewPrd(store, prd.id, { invokeFn: mockReview('pass') });
  assert.equal(after.status, 'approved');
});

test('review reject → rejected', async () => {
  const prd = await createPrd();
  await refinePrd(store, prd.id, { invokeFn: mockRefine('x') });
  const after = await reviewPrd(store, prd.id, { invokeFn: mockReview('reject', [{ item: 3, severity: 'blocker', problem: '目标不可行', requiredFix: '重写目标' }]) });
  assert.equal(after.status, 'rejected');
});

test('review needs_revision → needs_revision；3 轮后第 4 次 refine 被拒', async () => {
  const prd = await createPrd();
  for (let i = 0; i < 3; i++) {
    await refinePrd(store, prd.id, { invokeFn: mockRefine(`第${i + 1}轮`) });
    const after = await reviewPrd(store, prd.id, { invokeFn: mockReview('needs_revision', [{ item: 1, severity: 'medium', problem: '缺口径', requiredFix: '补口径' }]) });
    assert.equal(after.status, 'needs_revision');
  }
  await assert.rejects(() => refinePrd(store, prd.id, { invokeFn: mockRefine('第4轮') }), /轮数/);
});

test('invoke 失败 → prd_reviews.status=failed 且状态回退', async () => {
  const prd = await createPrd();
  await assert.rejects(
    () => refinePrd(store, prd.id, { invokeFn: async () => { throw new Error('模型调用失败'); } }),
    /模型调用失败/,
  );
  const after = await store.getPrd(prd.id);
  assert.equal(after.status, 'draft'); // 回退到触发前
  const reviews = await store.listPrdReviews(prd.id);
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].kind, 'refine');
  assert.equal(reviews[0].status, 'failed');
});
