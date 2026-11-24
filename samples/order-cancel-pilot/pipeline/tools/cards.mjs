// 卡（需求卡 / 任务卡）的加载与 schema 校验。
// 这一层的职责很窄但很关键：卡是机器可读的契约，字段缺失必须在进入执行前就报错。

import fs from 'node:fs';
import path from 'node:path';
import { parseYaml } from './yamlish.mjs';

export const AUTONOMY_LEVELS = ['auto', 'assisted', 'human-only'];
export const REQUIREMENT_STATUS = ['draft', 'ready', 'accepted'];

export function readCard(file) {
  if (!fs.existsSync(file)) throw new Error(`卡文件不存在：${file}`);
  return parseYaml(fs.readFileSync(file, 'utf8'));
}

export function loadCards(dir, { root }) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.ya?ml$/i.test(f))
    .sort()
    .map((f) => {
      const abs = path.join(dir, f);
      const data = readCard(abs);
      return { ...data, _file: path.relative(root, abs).replace(/\\/g, '/') };
    });
}

const isStringArray = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && x.trim() !== '');

export function validateRequirement(req) {
  const errs = [];
  const need = (field, ok, msg) => { if (!ok) errs.push(`${req.id || req._file}: ${msg}`); };
  need('id', typeof req.id === 'string', '缺少 id');
  need('title', typeof req.title === 'string' && req.title.trim() !== '', '缺少 title');
  need('status', REQUIREMENT_STATUS.includes(req.status), `status 必须是 ${REQUIREMENT_STATUS.join(' / ')}`);
  need('summary', typeof req.summary === 'string' && req.summary.trim() !== '', '缺少 summary');
  need('autonomy', AUTONOMY_LEVELS.includes(req.autonomy), `autonomy 必须是 ${AUTONOMY_LEVELS.join(' / ')}`);
  if (!Array.isArray(req.acceptance) || req.acceptance.length === 0) {
    errs.push(`${req.id || req._file}: 至少需要一条 acceptance（验收标准）`);
  } else {
    const ids = new Set();
    for (const [i, ac] of req.acceptance.entries()) {
      const where = `${req.id} acceptance[${i}]`;
      if (!ac || typeof ac !== 'object') { errs.push(`${where}: 必须是 {id, text, verify_by} 结构`); continue; }
      if (!ac.id) errs.push(`${where}: 缺少 id`);
      else if (ids.has(ac.id)) errs.push(`${where}: id 重复 (${ac.id})`);
      else ids.add(ac.id);
      if (!ac.text || String(ac.text).trim() === '') errs.push(`${where}: 缺少 text`);
      if (!ac.verify_by) errs.push(`${where}: 缺少 verify_by —— 无法验证的验收标准不允许进入流水线`);
    }
  }
  return errs;
}

export function validateTask(card) {
  const errs = [];
  const at = card.id || card._file;
  if (typeof card.id !== 'string' || !/^T-\d+$/.test(card.id)) errs.push(`${at}: id 必须形如 T-0121`);
  if (!card.title || String(card.title).trim() === '') errs.push(`${at}: 缺少 title`);
  if (!card.requirement) errs.push(`${at}: 缺少 requirement（所属需求卡 id）`);
  if (!card.objective || String(card.objective).trim() === '') errs.push(`${at}: 缺少 objective`);
  if (!AUTONOMY_LEVELS.includes(card.autonomy)) errs.push(`${at}: autonomy 必须是 ${AUTONOMY_LEVELS.join(' / ')}`);
  if (!card.scope || typeof card.scope !== 'object') errs.push(`${at}: 缺少 scope`);
  else if (!isStringArray(card.scope.write)) errs.push(`${at}: scope.write 必须是非空字符串数组`);
  if (!isStringArray(card.acceptance)) errs.push(`${at}: acceptance 必须是非空字符串数组（引用需求卡验收标准 id）`);
  if (!isStringArray(card.verify)) errs.push(`${at}: verify 必须是非空命令数组`);
  if (card.depends_on !== undefined && !Array.isArray(card.depends_on)) errs.push(`${at}: depends_on 必须是数组`);
  return errs;
}

export function taskDeps(card) {
  return Array.isArray(card.depends_on) ? card.depends_on : [];
}
