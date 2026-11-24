// 文档截图：用系统 Chrome 跑真实交互，产出 docs/images/ 下的四张界面插图。
// 与 check.mjs 的区别：这里只关心「插图质量」，不跑断言、不计成败。
//
// 前置：服务端已起（默认 http://127.0.0.1:8787），前端已构建（client/apps/web/dist）。
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.VISUAL_URL ?? 'http://127.0.0.1:8787';
const TOKEN = process.env.DEVLOOP_TOKEN ?? 'dev-local-token';
const OUT = path.resolve('docs/images');
const PROJECT = 'ledger-cli'; // 需求+任务链最完整、有已归档执行与证据

async function api(method, p, body, ifMatch) {
  const headers = { authorization: `Bearer ${TOKEN}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (ifMatch) headers['if-match'] = ifMatch;
  const res = await fetch(`${BASE}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${JSON.stringify(payload)}`);
  return { data: payload.data, etag: res.headers.get('etag') };
}

// 与客户端 saveTask 一致：只改 title，其余字段原样透传，保证还原后 dbSha 不变。
function taskPayload(task, title) {
  return {
    title,
    autonomy: task.autonomy,
    objective: task.objective ?? null,
    deps: task.deps ?? [],
    scope: {
      write: task.scope?.write ?? [],
      read: task.scope?.read ?? [],
      deny: task.scope?.deny ?? [],
    },
    verify: (task.verify ?? []).map((v) => (typeof v === 'string'
      ? { ref: v }
      : { ref: v.ref, resolvedCommand: v.resolvedCommand ?? null })),
    acceptance: task.acceptance ?? [],
  };
}

await fs.mkdir(OUT, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });

// 应用把滚动放在 <main>（h-full + overflow-auto），document 本身不增高，
// 所以 fullPage 无效。这里把视口拉到 main 的实际内容高度再截，避免内容被裁掉。
async function shotTall(page, name) {
  const { scrollH, scrollW } = await page.evaluate(() => {
    const main = document.querySelector('main');
    return { scrollH: main ? main.scrollHeight : 900, scrollW: main ? main.scrollWidth : 1440 };
  });
  const width = Math.min(Math.max(scrollW + 32, 1440), 2000);
  const height = Math.min(Math.max(scrollH + 96, 900), 6000); // 96 = header + padding
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(150);
  await shot(page, name);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(100);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  // ---------- 1. 流程视图（ledger-cli：REQ-100 → T-101 → T-102 → T-103） ----------
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.locator('header select').selectOption(PROJECT);
  await page.waitForSelector('[data-testid=task-node]:has-text("T-101")', { timeout: 15000 });
  await page.waitForTimeout(400); // 等 DAG 过渡与字体稳定
  await shot(page, 'flow-view.png');

  // ---------- 2. 卡详情（T-103：3 次执行，历史最丰富） ----------
  await page.locator('[data-testid=task-node]', { hasText: 'T-103' }).first().click();
  await page.getByText('任务目标').first().waitFor({ timeout: 8000 });
  await page.waitForTimeout(200);
  await shotTall(page, 'card-view.png');

  // ---------- 3. 证据视图（diff） ----------
  const diffItem = page.locator('[data-testid=evidence-item][data-kind=diff]').first();
  await diffItem.click();
  await page.getByText('sha256').first().waitFor({ timeout: 8000 });
  await page.waitForTimeout(200);
  await shot(page, 'evidence-view.png');

  // ---------- 4. 卡同步视图（先制造一个 db_ahead，展示「DB 有改动 · 可导出」） ----------
  const task = (await api('GET', '/api/v1/tasks/T-101')).data;
  const originalTitle = task.title;
  const guard = `"v${task.version}"`;

  await api('PUT', '/api/v1/tasks/T-101', taskPayload(task, `${originalTitle}（UI 改动）`), guard);

  try {
    // 卡同步按钮只读缓存的 sync 状态，不会重新拉取；重新加载并切回 ledger-cli 才能拿到 db_ahead
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('header select').selectOption(PROJECT);
    await page.waitForSelector('[data-testid=task-node]:has-text("T-101")', { timeout: 15000 });
    await page.getByRole('button', { name: /卡同步/ }).click();
    await page.getByText('卡同步 ·', { exact: false }).first().waitFor({ timeout: 8000 });
    await page.waitForTimeout(200);
    await shotTall(page, 'sync-view.png');
  } finally {
    // 还原标题，让仓库回到 synced（幂等；失败也不影响产物，只是留下一张 db_ahead 演示数据）
    const after = (await api('GET', '/api/v1/tasks/T-101')).data;
    await api('PUT', '/api/v1/tasks/T-101', taskPayload(after, originalTitle), `"v${after.version}"`);
  }

  console.log(`已生成截图 → ${OUT}`);
  console.log('  flow-view.png / card-view.png / evidence-view.png / sync-view.png');
} finally {
  await browser.close();
}
