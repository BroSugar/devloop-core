// 卡模板：结构由模板保证，业务内容由需求填充。
// 新项目接入时只写卡内容，字段结构不用重新发明——这是“模板可配置”的落点。

import fs from 'node:fs';
import path from 'node:path';
import { PLATFORM_ROOT, renderVars } from './config.mjs';

export function listTemplates(root = PLATFORM_ROOT) {
  const dir = path.join(root, 'config/templates');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory()).sort();
}

export function templatePath(template, kind, root = PLATFORM_ROOT) {
  const file = path.join(root, 'config/templates', template, `${kind}.yaml.tpl`);
  if (!fs.existsSync(file)) {
    throw new Error(`模板不存在：${template}/${kind}（可选：${listTemplates(root).join(', ')}）`);
  }
  return file;
}

export function renderTemplate(text, vars) {
  // 整行占位符：按占位符的缩进把多行值整体缩进，用于 YAML 块标量（objective / summary）。
  const lines = text.split('\n').map((line) => {
    const m = line.match(/^(\s*)(\{\{[^}]+\}\})\s*$/);
    if (!m) return renderVars(line, vars);
    const value = renderVars(m[2], vars);
    return String(value).split('\n').map((l) => m[1] + l).join('\n');
  });
  const out = lines.join('\n');
  const left = out.match(/\{\{[^}]+\}\}/g);
  if (left) throw new Error(`模板存在未替换变量：${left.join(', ')}`);
  return out;
}

export function instantiate({ template, kind, vars, outFile, root = PLATFORM_ROOT, force = false }) {
  const file = templatePath(template, kind, root);
  const text = renderTemplate(fs.readFileSync(file, 'utf8'), vars);
  if (fs.existsSync(outFile) && !force) throw new Error(`目标文件已存在：${outFile}（用 --force 覆盖）`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, text);
  return { file: outFile, text };
}
