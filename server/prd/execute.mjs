// PRD 完善/审核编排：状态机 + agent 调用 + 证据落库（钉住输入哈希，可重放审计）。
import crypto from 'node:crypto';
import fs from 'node:fs';
import { loadAi, resolveAgent, promptPath, buildRequest, invoke } from '../../platform/lib/ai.mjs';

const sha256 = (s) => crypto.createHash('sha256').update(String(s ?? '')).digest('hex');
const notFound = (m) => Object.assign(new Error(m), { code: 'not_found' });
const badRequest = (m) => Object.assign(new Error(m), { code: 'bad_request' });
const revId = (prdId, kind) => `rev_${prdId}_${kind}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

function extractText(raw) {
  if (typeof raw === 'string') return raw;
  const c = raw?.choices?.[0]?.message?.content;
  if (typeof c === 'string') return c;
  const a = (raw?.content || []).map((b) => (typeof b?.text === 'string' ? b.text : '')).join('');
  if (a) return a;
  return JSON.stringify(raw);
}

// 生产路径：读 agent 配置 → 构造请求 → invoke → 取文本。
async function defaultInvoke({ role, projectId, prdContent }) {
  const ai = loadAi();
  const { agent, provider } = resolveAgent(ai, role, projectId);
  const system = fs.readFileSync(promptPath(agent), 'utf8');
  const request = buildRequest({ agent, provider, system, user: prdContent });
  return extractText(await invoke(request));
}

const pickInvoke = (role, projectId, invokeFn) =>
  invokeFn ?? (async ({ prdContent }) => defaultInvoke({ role, projectId, prdContent }));

async function countReviews(store, prdId) {
  // 只统计「完成」的审核轮次（passed），失败的不占重试额度
  return (await store.listPrdReviews(prdId)).filter((r) => r.kind === 'review' && r.status === 'passed').length;
}

export async function refinePrd(store, prdId, { invokeFn } = {}) {
  const prd = await store.getPrd(prdId);
  if (!prd) throw notFound('PRD 不存在');
  if (prd.status !== 'draft' && prd.status !== 'needs_revision') throw badRequest('当前状态不可完善');
  if (await countReviews(store, prdId) >= 3) throw badRequest('已达最大完善轮数（3），需人工介入');

  const inputSha = sha256(prd.content);
  const inputVersion = prd.version;
  await store.upsertPrd({ id: prdId, status: 'refining' });

  let output;
  try {
    output = await pickInvoke('refiner', prd.projectId, invokeFn)({ prdContent: prd.content });
  } catch (e) {
    await store.createPrdReview({ id: revId(prdId, 'refine'), prdId, kind: 'refine', status: 'failed', agent: 'refiner', contentSha256: inputSha, contentVersion: inputVersion });
    await store.upsertPrd({ id: prdId, status: prd.status });
    throw e;
  }

  await store.upsertPrd({ id: prdId, content: output, status: 'reviewing' });
  await store.createPrdReview({
    id: revId(prdId, 'refine'), prdId, kind: 'refine', status: 'passed', output, agent: 'refiner',
    sha256: sha256(output), contentSha256: inputSha, contentVersion: inputVersion,
  });
  return store.getPrd(prdId);
}

export async function reviewPrd(store, prdId, { invokeFn } = {}) {
  const prd = await store.getPrd(prdId);
  if (!prd) throw notFound('PRD 不存在');
  if (prd.status !== 'reviewing') throw badRequest('当前状态不可审核');
  if (await countReviews(store, prdId) >= 3) throw badRequest('已达最大审核轮数（3），需人工介入');

  const inputSha = sha256(prd.content);
  const inputVersion = prd.version;

  let text;
  try {
    text = await pickInvoke('prd-reviewer', prd.projectId, invokeFn)({ prdContent: prd.content });
  } catch (e) {
    await store.createPrdReview({ id: revId(prdId, 'review'), prdId, kind: 'review', status: 'failed', agent: 'prd-reviewer', contentSha256: inputSha, contentVersion: inputVersion });
    throw e;
  }

  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    obj = null;
  }
  if (!obj || typeof obj !== 'object') obj = {};
  const rawVerdict = String(obj.verdict ?? '').toLowerCase().trim();
  const verdict = ['pass', 'needs_revision', 'reject'].includes(rawVerdict) ? rawVerdict : 'needs_revision';
  const findings = Array.isArray(obj.findings) ? obj.findings : [];
  const nextStatus = { pass: 'approved', needs_revision: 'needs_revision', reject: 'rejected' }[verdict];

  await store.upsertPrd({ id: prdId, status: nextStatus });
  await store.createPrdReview({
    id: revId(prdId, 'review'), prdId, kind: 'review', status: 'passed', verdict, findings, output: text, agent: 'prd-reviewer',
    sha256: sha256(text), contentSha256: inputSha, contentVersion: inputVersion,
  });
  return store.getPrd(prdId);
}
