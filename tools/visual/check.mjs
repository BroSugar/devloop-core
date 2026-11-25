// 本地视觉验收：用系统 Chrome（channel: chrome）跑真实交互、断言关键 UI 与浮动标签行为、截图。
// 不进 CI：避免下载浏览器；CI 只负责构建与契约测试。
//
// 前置：服务端已起（默认 http://127.0.0.1:8792），前端已构建（client/apps/web/dist）。
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.VISUAL_URL ?? 'http://127.0.0.1:8792';
const OUT = path.resolve('out');

const results = [];
const errors = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  if (!ok) errors.push(`${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

await fs.mkdir(OUT, { recursive: true });
const shot = (name) => page.screenshot({ path: path.join(OUT, name) });

// ---------- 1. 流程视图 ----------
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid=task-node]', { timeout: 15000 });
const nodeCount = await page.locator('[data-testid=task-node], [data-testid=req-node]').count();
check('流程视图渲染出节点', nodeCount >= 2, `nodes=${nodeCount}`);
const nodeText = await page.locator('[data-testid=task-node]').first().innerText();
check('任务节点不重复显示 id', (nodeText.match(/T-\d+/g) || []).length === 1, nodeText.replace(/\n/g, ' | '));
check('顶部品牌可见', (await page.locator('header').innerText()).includes('devloop'));
const options = await page.locator('header select option').count();
check('项目下拉有 3 个项目', options === 3, `options=${options}`);
const chips = await page.locator('[data-testid=cap-chip]').count();
check('能力徽章可见', chips >= 3, `badges=${chips}`);
await shot('01-flow.png');

// ---------- 2. 切换项目 → ledger-cli（它有已归档的执行与证据）----------
await page.locator('header select').selectOption('ledger-cli');
await page.waitForSelector('[data-testid=task-node]:has-text("T-101")', { timeout: 15000 });
const nodes2 = await page.locator('[data-testid=task-node]').count();
check('切换项目后 DAG 重新渲染', nodes2 >= 3, `tasks=${nodes2}`);
const edgeCount = await page.locator('.react-flow__edge').count();
check('流程连线渲染', edgeCount >= 3, `edges=${edgeCount}`);

// ---------- 3. 卡详情 ----------
await page.locator('[data-testid=task-node]', { hasText: 'T-101' }).first().click();
await page.getByText('任务目标').first().waitFor({ timeout: 8000 });
check('卡详情：任务目标字段', true);
check('卡详情：写域字段', (await page.getByText('写域').count()) > 0);
check('卡详情：证据链区块', (await page.getByText('证据链').count()) > 0);
const evidenceItems = await page.locator('[data-testid=evidence-item]').count();
check('卡详情：有证据条目', evidenceItems >= 1, `items=${evidenceItems}`);
const leakedNames = await page.getByText(/^cmd\d+$/).count();
check('门禁名称不暴露内部命名（cmdN）', leakedNames === 0, `found=${leakedNames}`);
await shot('02-card.png');

// ---------- 4. 浮动标签行为 ----------
const input = page.getByLabel('标题', { exact: true });
const label = page.locator('label', { hasText: '标题' }).first();
await input.fill('');
await page.keyboard.press('Tab'); // 失焦，标签才能回到居中态
await page.waitForTimeout(150);
const ib = await input.boundingBox();
const before = await label.boundingBox();
await input.type('视觉验收');
await page.waitForTimeout(150);
const after = await label.boundingBox();

const centerGap = Math.abs((before.y + before.height / 2) - (ib.y + ib.height / 2));
const topGap = after.y - ib.y;
check('浮动标签：空值未聚焦时标签居中', centerGap < 8, `gap=${centerGap.toFixed(1)}px`);
check('浮动标签：聚焦/有值时上浮到顶部', topGap >= 2 && topGap <= 16, `topGap=${topGap.toFixed(1)}px`);
await shot('03-floating-label.png');

// ---------- 5. 证据视图 ----------
await page.locator('[data-testid=evidence-item][data-kind=diff]').first().click();
await page.getByText('sha256').first().waitFor({ timeout: 8000 });
const preLen = (await page.locator('pre').innerText()).length;
check('证据视图：显示 sha256', true);
check('证据视图：正文非空', preLen > 20, `${preLen} 字符`);
await shot('04-evidence.png');

// ---------- 6. 卡同步视图 ----------
await page.getByText('返回卡').click();
await page.getByText('返回流程').click();
await page.getByRole('button', { name: /卡同步/ }).click();
await page.getByText('卡同步 ·', { exact: false }).first().waitFor({ timeout: 8000 });
const rows = await page.locator('table tbody tr').count();
check('卡同步视图：表格有数据行', rows >= 1, `rows=${rows}`);
check('卡同步视图：状态徽章存在', (await page.locator('[data-testid=sync-state]').count()) >= 1);
await shot('05-sync.png');

// ---------- 7. PRD 视图 ----------
await page.getByRole('button', { name: 'PRD' }).click();
await page.getByTestId('prd-empty').waitFor({ timeout: 8000 });
check('PRD 视图：空态可见', true);

// ---------- 8. 观察项（不计失败）----------
const urlAfterNav = page.url();
const observations = [
  urlAfterNav === BASE || urlAfterNav === `${BASE}/`
    ? '路由是组件内 state，不是 URL：刷新会回到流程视图、无法深链分享（验收项，非缺陷）'
    : `URL 会变化：${urlAfterNav}`,
];

await browser.close();

const summary = {
  base: BASE,
  generatedAt: new Date().toISOString(),
  passed: results.filter((r) => r.ok).length,
  failed: errors.length,
  results,
  observations,
  errors,
};
await fs.writeFile(path.join(OUT, 'report.json'), `${JSON.stringify(summary, null, 2)}\n`);

for (const r of results) console.log(`${r.ok ? '✔' : '✖'} ${r.name}${r.detail ? ` (${r.detail})` : ''}`);
console.log(`\n合计 ${summary.passed}/${results.length} 通过，错误 ${errors.length} 条`);
for (const o of observations) console.log(`观察：${o}`);
if (errors.length) {
  console.log('\n失败：');
  for (const e of errors) console.log(`  - ${e}`);
  process.exit(1);
}
