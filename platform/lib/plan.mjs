// 分解产物校验：需求卡 + 任务卡 → 合法 DAG。
// 与单仓 pilot 的 plan.mjs 同源，区别是这里所有路径/策略都来自项目配置。

import fs from 'node:fs';
import path from 'node:path';
import { readYaml } from './config.mjs';
import { matchesAny, mayOverlap, staticPrefix } from './policy.mjs';

export const AUTONOMY = ['auto', 'assisted', 'human-only'];
export const REQ_STATUS = ['draft', 'ready', 'accepted'];

const isStringArray = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && x.trim() !== '');

export function loadCards(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => /\.ya?ml$/i.test(f))
    .sort()
    .map((f) => ({ ...readYaml(path.join(dir, f)), _file: path.join(dir, f) }));
}

export const loadRequirementCards = (cfg) => loadCards(cfg.project.spec_path);
export const loadTaskCards = (cfg) => loadCards(cfg.project.tasks_path);

export function taskDeps(card) {
  return Array.isArray(card.depends_on) ? card.depends_on : [];
}

export function validateRequirement(req) {
  const errs = [];
  const at = req.id || req._file;
  if (!req.id) errs.push(`${at}: 缺少 id`);
  if (!req.title) errs.push(`${at}: 缺少 title`);
  if (!REQ_STATUS.includes(req.status)) errs.push(`${at}: status 必须是 ${REQ_STATUS.join(' / ')}`);
  if (!req.summary) errs.push(`${at}: 缺少 summary`);
  if (!AUTONOMY.includes(req.autonomy)) errs.push(`${at}: autonomy 必须是 ${AUTONOMY.join(' / ')}`);
  if (!Array.isArray(req.acceptance) || !req.acceptance.length) {
    errs.push(`${at}: 至少需要一条 acceptance`);
  } else {
    const ids = new Set();
    for (const [i, ac] of req.acceptance.entries()) {
      const where = `${at} acceptance[${i}]`;
      if (!ac?.id) errs.push(`${where}: 缺少 id`);
      else if (ids.has(ac.id)) errs.push(`${where}: id 重复 ${ac.id}`);
      else ids.add(ac.id);
      if (!ac?.text) errs.push(`${where}: 缺少 text`);
      if (!ac?.verify_by) errs.push(`${where}: 缺少 verify_by（无法验证的验收标准不许进流水线）`);
    }
  }
  return errs;
}

export function validateTask(card) {
  const errs = [];
  const at = card.id || card._file;
  if (!/^T-\d+$/.test(String(card.id || ''))) errs.push(`${at}: id 必须形如 T-100`);
  if (!card.title) errs.push(`${at}: 缺少 title`);
  if (!card.requirement) errs.push(`${at}: 缺少 requirement`);
  if (!card.objective) errs.push(`${at}: 缺少 objective`);
  if (!AUTONOMY.includes(card.autonomy)) errs.push(`${at}: autonomy 必须是 ${AUTONOMY.join(' / ')}`);
  if (!card.scope || !isStringArray(card.scope.write)) errs.push(`${at}: scope.write 必须是非空字符串数组`);
  if (!isStringArray(card.acceptance)) errs.push(`${at}: acceptance 必须是非空字符串数组`);
  if (!isStringArray(card.verify)) errs.push(`${at}: verify 必须是非空命令数组`);
  return errs;
}

export function planProject(cfg) {
  const errors = [];
  const warns = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warns.push(m);

  const reqCards = loadRequirementCards(cfg);
  const taskCards = loadTaskCards(cfg);
  const byId = new Map(taskCards.map((c) => [c.id, c]));
  const reqById = new Map(reqCards.map((r) => [r.id, r]));

  if (!reqCards.length) warn(`需求卡目录为空：${cfg.project.spec_path}`);
  if (!taskCards.length) warn(`任务卡目录为空：${cfg.project.tasks_path}`);

  // 1. 需求卡与判据文件
  for (const req of reqCards) {
    for (const e of validateRequirement(req)) err(e);
    for (const ac of req.acceptance || []) {
      const target = String(ac?.verify_by || '').replace(/\\/g, '/');
      if (!target) continue;
      if (!fs.existsSync(path.join(cfg.project.repo_path, target))) {
        err(`${req.id} ${ac.id}: verify_by 文件在仓库中不存在 → ${target}`);
      }
    }
  }

  // 2. 任务卡 schema
  for (const card of taskCards) for (const e of validateTask(card)) err(e);

  // 3. 引用完整性
  for (const card of taskCards) {
    const req = reqById.get(card.requirement);
    if (!req) { err(`${card.id}: 引用不存在的需求卡 ${card.requirement}`); continue; }
    for (const dep of taskDeps(card)) if (!byId.has(dep)) err(`${card.id}: 依赖不存在 ${dep}`);
    const acIds = new Set((req.acceptance || []).map((a) => a.id));
    for (const ac of card.acceptance || []) if (!acIds.has(ac)) err(`${card.id}: acceptance 引用不存在的验收标准 ${ac}`);
  }

  // 4. 无环 + 分层
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
  for (const id of byId.keys()) if (!seen.has(id)) err(`${id}: 依赖成环或不可达`);

  // 5. 写域落盘
  for (const card of taskCards) {
    for (const glob of card.scope?.write || []) {
      const repo = cfg.project.repo_path;
      if (!/[*?]/.test(glob)) {
        const abs = path.join(repo, glob);
        if (fs.existsSync(abs)) continue;
        if (fs.existsSync(path.dirname(abs))) { warn(`${card.id}: ${glob} 为新建文件（父目录存在）`); continue; }
        err(`${card.id}: 写域 ${glob} 落不到磁盘（父目录也不存在）`);
        continue;
      }
      const prefix = staticPrefix(glob);
      if (prefix && !fs.existsSync(path.join(repo, prefix))) err(`${card.id}: 写域 ${glob} 的静态前缀 ${prefix} 不存在`);
    }
  }

  // 6. 写域不重叠（并发安全）
  for (let i = 0; i < taskCards.length; i++) {
    for (let j = i + 1; j < taskCards.length; j++) {
      const a = taskCards[i];
      const b = taskCards[j];
      if (a.allow_parallel_overlap || b.allow_parallel_overlap) continue;
      for (const wa of a.scope?.write || []) {
        for (const wb of b.scope?.write || []) {
          if (!mayOverlap(wa, wb)) continue;
          const serialized = taskDeps(a).includes(b.id) || taskDeps(b).includes(a.id);
          if (serialized) warn(`${a.id} 与 ${b.id} 写域重叠但已串行：${wa} ~ ${wb}`);
          else err(`${a.id} 与 ${b.id} 写域重叠且无依赖：${wa} ~ ${wb}`);
        }
      }
    }
  }

  // 7. 写域是否覆盖了禁改文件（真实拦截在执行期 diff）
  const deny = cfg.policy?.deny_write || [];
  for (const card of taskCards) {
    for (const glob of card.scope?.write || []) {
      if (deny.some((d) => mayOverlap(glob, d))) {
        warn(`${card.id}: 写域 ${glob} 与禁改规则可能重叠，执行期按 diff 拦截`);
      }
    }
  }

  // 8. 验收标准覆盖度
  for (const req of reqCards) {
    const covered = new Set(taskCards.filter((c) => c.requirement === req.id).flatMap((c) => c.acceptance || []));
    for (const ac of req.acceptance || []) {
      if (!covered.has(ac.id)) warn(`${req.id} ${ac.id}: 没有任务卡承接（${ac.text}）`);
    }
  }

  const graphOut = {
    generatedAt: new Date().toISOString(),
    project: cfg.project.id,
    stack: cfg.project.stack,
    layers,
    tasks: Object.fromEntries(taskCards.map((c) => [c.id, {
      title: c.title, requirement: c.requirement, depends_on: taskDeps(c),
      write: c.scope?.write || [], verify: c.verify, acceptance: c.acceptance, autonomy: c.autonomy,
    }])),
  };

  return { errors, warns, layers, reqCards, taskCards, byId, graph: graphOut };
}

export function writeGraph(cfg, graph) {
  fs.mkdirSync(cfg.project.tasks_path, { recursive: true });
  const file = path.join(cfg.project.tasks_path, '_graph.json');
  fs.writeFileSync(file, `${JSON.stringify(graph, null, 2)}\n`);
  return file;
}

export function formatPlan(cfg, result) {
  const lines = [];
  lines.push(`PROJECT ${cfg.project.id}  ${cfg.project.name}  [stack=${cfg.project.stack}]`);
  lines.push(`  repo  ${cfg.project.repo_path}`);
  lines.push(`  cards ${cfg.project.cards.mode}  spec=${path.relative(cfg.vars['platform.root'], cfg.project.spec_path)}  tasks=${path.relative(cfg.vars['platform.root'], cfg.project.tasks_path)}`);
  for (const req of result.reqCards) {
    lines.push(`  REQ ${req.id}  ${req.title}  [${req.status}]  ${(req.acceptance || []).length} 条验收标准`);
    for (const [i, layer] of result.layers.entries()) {
      const ids = layer.filter((id) => result.byId.get(id)?.requirement === req.id);
      if (!ids.length) continue;
      lines.push(`    L${i + 1}`);
      for (const id of ids) {
        const c = result.byId.get(id);
        lines.push(`      ${id}  ${c.title}  (${(c.verify || []).length} 条 verify)`);
      }
    }
  }
  return lines.join('\n');
}
