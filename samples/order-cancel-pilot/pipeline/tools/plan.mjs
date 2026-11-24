// 分解产物校验器：把“需求卡 + 任务卡”当输入，验证 DAG 是否合法、写域是否落盘。
// 注意职责边界：自然语言 -> 任务的“分解”由 agent 完成；这里只做确定性校验，
// 失败的分解必须在这里被拦住，而不是等到实现阶段才发现。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCards, validateRequirement, validateTask, taskDeps } from './cards.mjs';
import { matchesAny, mayOverlap, staticPrefix } from './scope.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const specDir = path.join(root, 'pipeline/spec');
const taskDir = path.join(root, 'pipeline/tasks');

const errors = [];
const warns = [];
const err = (msg) => errors.push(msg);
const warn = (msg) => warns.push(msg);

const reqCards = loadCards(specDir, { root });
const taskCards = loadCards(taskDir, { root });

// 1. 需求卡自身合法 + 验收标准必须落到可执行文件
for (const req of reqCards) {
  for (const e of validateRequirement(req)) err(e);
  for (const ac of req.acceptance || []) {
    if (!ac?.verify_by) continue;
    const target = String(ac.verify_by).replace(/\\/g, '/');
    if (!fs.existsSync(path.join(root, target))) {
      err(`${req.id} ${ac.id}: verify_by 指向的文件不存在 → ${target}`);
    }
  }
  for (const t of (req.policy?.deny_write) || []) {
    if (typeof t !== 'string' || !t.trim()) err(`${req.id}: policy.deny_write 含非法项`);
  }
}

// 2. 任务卡 schema
for (const card of taskCards) for (const e of validateTask(card)) err(e);

const byId = new Map(taskCards.map((c) => [c.id, c]));
const reqById = new Map(reqCards.map((r) => [r.id, r]));

// 3. 引用完整性：需求存在、依赖存在、验收标准被引用
for (const card of taskCards) {
  if (!reqById.has(card.requirement)) {
    err(`${card.id}: 引用了不存在的需求卡 ${card.requirement}`);
    continue;
  }
  for (const dep of taskDeps(card)) {
    if (!byId.has(dep)) err(`${card.id}: 依赖不存在 ${dep}`);
  }
  const acIds = new Set((reqById.get(card.requirement).acceptance || []).map((a) => a.id));
  for (const ac of card.acceptance || []) {
    if (!acIds.has(ac)) err(`${card.id}: acceptance 引用了不存在的验收标准 ${ac}`);
  }
}

// 4. 无环（Kahn 分层）
const graph = new Map(taskCards.map((c) => [c.id, taskDeps(c)]));
const indeg = new Map(taskCards.map((c) => [c.id, taskDeps(c).filter((d) => graph.has(d)).length]));
const queue = [...indeg.entries()].filter(([, n]) => n === 0).map(([id]) => id);
const layers = [];
const seen = new Set();
while (queue.length) {
  const layer = [...queue].sort();
  layers.push(layer);
  queue.length = 0;
  for (const id of layer) {
    seen.add(id);
    for (const [node, deps] of graph) {
      if (!deps.includes(id)) continue;
      const n = indeg.get(node) - 1;
      indeg.set(node, n);
      if (n === 0 && !seen.has(node)) queue.push(node);
    }
  }
}
for (const id of byId.keys()) if (!seen.has(id)) err(`${id}: 依赖成环或不可达，无法构成 DAG`);

// 5. 写域必须落盘（能映射到真实目录/文件）
for (const card of taskCards) {
  const write = card.scope?.write || [];
  for (const glob of write) {
    const isGlob = /[*?]/.test(glob);
    const clean = glob.replace(/\\/g, '/').replace(/\/\*\*$/, '');
    if (!isGlob) {
      const abs = path.join(root, clean);
      if (fs.existsSync(abs)) continue;
      const dir = path.dirname(abs);
      if (fs.existsSync(dir)) { warn(`${card.id}: 写域 ${glob} 是新建文件（父目录存在）`); continue; }
      err(`${card.id}: 写域 ${glob} 落不到磁盘（父目录也不存在）`);
      continue;
    }
    const prefix = staticPrefix(glob);
    if (prefix && !fs.existsSync(path.join(root, prefix))) {
      err(`${card.id}: 写域 ${glob} 的静态前缀 ${prefix} 不存在`);
    }
  }
}

// 6. 写域重叠：并发任务不许改同一批文件
for (let i = 0; i < taskCards.length; i++) {
  for (let j = i + 1; j < taskCards.length; j++) {
    const a = taskCards[i];
    const b = taskCards[j];
    if (a.allow_parallel_overlap || b.allow_parallel_overlap) continue;
    for (const wa of a.scope?.write || []) {
      for (const wb of b.scope?.write || []) {
        if (mayOverlap(wa, wb)) {
          const serialized = taskDeps(a).includes(b.id) || taskDeps(b).includes(a.id);
          if (serialized) warn(`${a.id} 与 ${b.id} 写域重叠但已串行依赖：${wa} ~ ${wb}`);
          else err(`${a.id} 与 ${b.id} 写域重叠且无依赖关系：${wa} ~ ${wb}`);
        }
      }
    }
  }
}

// 7. 写域可能命中禁止写入（提示收窄，真正拦截在执行期 diff 检查）
for (const card of taskCards) {
  const deny = [...(card.scope?.deny || []), ...((reqById.get(card.requirement)?.policy?.deny_write) || [])];
  for (const glob of card.scope?.write || []) {
    if (/[*?]/.test(glob) && deny.some((d) => d.includes('*.test') || d.endsWith('**'))) {
      warn(`${card.id}: 写域 ${glob} 是目录级通配，可能覆盖测试文件；执行期会按 diff 拦截`);
    }
  }
}

// 8. 验收标准覆盖度
for (const req of reqCards) {
  const covered = new Set(taskCards.filter((c) => c.requirement === req.id).flatMap((c) => c.acceptance || []));
  for (const ac of req.acceptance || []) {
    if (!covered.has(ac.id)) warn(`${req.id} ${ac.id}: 没有任何任务卡承接（${ac.text}）`);
  }
}

// ---- 输出 ----
console.log(`\n需求卡 ${reqCards.length} 张 / 任务卡 ${taskCards.length} 张 · 仓库根 ${path.relative(process.cwd(), root) || '.'}\n`);
for (const req of reqCards) {
  console.log(`REQ ${req.id}  ${req.title}  [${req.status}]`);
  for (const layer of layers) {
    const ids = layer.filter((id) => byId.get(id)?.requirement === req.id);
    if (!ids.length) continue;
    const lvl = layers.indexOf(layer) + 1;
    console.log(`  L${lvl}`);
    for (const id of ids) {
      const c = byId.get(id);
      console.log(`    ${id}  ${c.title}`);
      for (const w of c.scope.write) console.log(`        write: ${w}`);
      console.log(`        verify: ${c.verify.length} 条 · acceptance: ${(c.acceptance || []).join(',')} · autonomy=${c.autonomy}`);
    }
  }
}

const graphOut = {
  generatedAt: new Date().toISOString(),
  requirements: reqCards.map((r) => r.id),
  layers,
  tasks: Object.fromEntries(taskCards.map((c) => [c.id, {
    title: c.title, requirement: c.requirement, depends_on: taskDeps(c),
    write: c.scope?.write || [], verify: c.verify, acceptance: c.acceptance, autonomy: c.autonomy,
  }])),
};
if (!errors.length) {
  fs.writeFileSync(path.join(taskDir, '_graph.json'), `${JSON.stringify(graphOut, null, 2)}\n`);
}
if (warns.length) {
  console.log('\nWARN');
  for (const w of warns) console.log(`  ! ${w}`);
}
if (errors.length) {
  console.log('\nERROR');
  for (const e of errors) console.log(`  x ${e}`);
  console.log(`\n分解校验失败：${errors.length} 个错误，${warns.length} 个警告\n`);
  process.exit(1);
}
console.log(`\n分解校验通过：${taskCards.length} 个任务，${layers.length} 层 DAG，${warns.length} 个警告\n`);
