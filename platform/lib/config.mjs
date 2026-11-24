// 分层配置解析：platform defaults → stack preset → project → CLI 覆盖。
// 每个叶子值都记录来源，doctor 可以逐项打印“这个值从哪来”——配置化平台最怕的就是
// “生效的到底是哪一份”，所以可解释性与加载同样重要。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from './yaml.mjs';

export const PLATFORM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function readYaml(file) {
  if (!fs.existsSync(file)) throw new Error(`文件不存在：${file}`);
  return parseYaml(fs.readFileSync(file, 'utf8'));
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function deepMerge(base, extra) {
  if (!isPlainObject(extra)) return extra;
  const out = isPlainObject(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(extra)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out;
}

const uniq = (arr) => [...new Set(arr)];

function collectSources(obj, layerName, prefix = '', into = {}) {
  if (!isPlainObject(obj)) return into;
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isPlainObject(v)) collectSources(v, layerName, key, into);
    else into[key] = layerName;
  }
  return into;
}

export function listProjects() {
  const dir = path.join(PLATFORM_ROOT, 'projects');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, 'project.yaml'))).sort();
}

export function loadProjectRaw(projectId) {
  const file = path.join(PLATFORM_ROOT, 'projects', projectId, 'project.yaml');
  if (!fs.existsSync(file)) {
    throw new Error(`项目未注册：${projectId}（应在 projects/${projectId}/project.yaml）`);
  }
  return { file, dir: path.dirname(file), raw: readYaml(file) };
}

export function loadConfig(projectId, overrides = {}) {
  const platform = readYaml(path.join(PLATFORM_ROOT, 'config/platform.yaml'));
  const { file: projectFile, dir: projectDir, raw: projectRaw } = loadProjectRaw(projectId);

  const presetName = projectRaw.stack || 'custom';
  const presetFile = path.join(PLATFORM_ROOT, 'config/presets', `${presetName}.yaml`);
  const preset = fs.existsSync(presetFile) ? readYaml(presetFile) : {};

  const merged = deepMerge(deepMerge(deepMerge({}, platform.defaults || {}), preset), projectRaw);
  merged.policy = merged.policy || {};
  merged.policy.deny_write = uniq([
    ...(platform.defaults?.policy?.deny_write || []),
    ...(preset?.policy?.deny_write || []),
    ...(projectRaw?.policy?.deny_write || []),
  ]);
  merged.gates = merged.gates || {};
  merged.agents = { ...(platform.defaults?.agents || {}), ...(merged.agents || {}) };

  const repoPath = path.resolve(projectDir, merged.repo?.path || '');
  const project = {
    id: projectRaw.id || projectId,
    name: projectRaw.name || projectId,
    dir: projectDir,
    file: projectFile,
    repo_path: repoPath,
    branch: merged.repo?.branch || 'main',
    stack: presetName,
    cards: {
      mode: merged.cards?.mode || 'platform',
      spec_dir: merged.cards?.spec_dir || 'spec',
      tasks_dir: merged.cards?.tasks_dir || 'tasks',
    },
  };
  const cardsBase = project.cards.mode === 'repo' ? repoPath : projectDir;
  project.spec_path = path.resolve(cardsBase, project.cards.spec_dir);
  project.tasks_path = path.resolve(cardsBase, project.cards.tasks_dir);

  const vars = {
    'platform.root': PLATFORM_ROOT,
    'project.id': project.id,
    'project.name': project.name,
    'project.dir': project.dir,
    'project.repo_path': project.repo_path,
    'project.branch': project.branch,
  };

  const cfg = {
    platform,
    project,
    preset: { name: presetName, ...preset },
    gates: merged.gates,
    policy: merged.policy,
    evidence: { ...(platform.defaults?.evidence || {}), ...(merged.evidence || {}) },
    ai: { ...(platform.ai || {}), ...(merged.ai || {}) },
    templates: { ...(platform.templates || {}), ...(merged.templates || {}) },
    agents: merged.agents,
    vars,
    sources: {
      ...collectSources(platform.defaults || {}, 'platform'),
      ...collectSources(preset, `preset:${presetName}`),
      ...collectSources(projectRaw, 'project'),
    },
  };

  return applyOverrides(cfg, overrides);
}

function applyOverrides(cfg, overrides) {
  if (!overrides || !Object.keys(overrides).length) return cfg;
  const out = structuredCloneSafe(cfg);
  for (const [dotpath, value] of Object.entries(overrides)) {
    const segs = dotpath.split('.');
    let cur = out;
    for (let i = 0; i < segs.length - 1; i++) {
      cur[segs[i]] = cur[segs[i]] || {};
      cur = cur[segs[i]];
    }
    cur[segs[segs.length - 1]] = value;
    out.sources[dotpath] = 'cli';
  }
  return out;
}

function structuredCloneSafe(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/** 字符串变量替换：{{a.b}} 与 {{env.NAME}}。未定义变量直接报错（宁可炸，不要静默用空串）。 */
export function renderVars(text, vars) {
  if (typeof text !== 'string') return text;
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expr) => {
    const key = expr.trim();
    if (key.startsWith('env.')) {
      const name = key.slice(4);
      const v = process.env[name];
      if (v === undefined) throw new Error(`环境变量未设置：${name}（模板里引用了 {{${key}}}）`);
      return v;
    }
    if (!(key in vars)) throw new Error(`未定义变量：{{${key}}}`);
    return String(vars[key]);
  });
}

export function interpolate(obj, vars) {
  if (typeof obj === 'string') return renderVars(obj, vars);
  if (Array.isArray(obj)) return obj.map((v) => interpolate(v, vars));
  if (isPlainObject(obj)) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = interpolate(v, vars);
    return out;
  }
  return obj;
}

export function resolve(cfg) {
  return interpolate({ ...cfg, vars: undefined }, cfg.vars);
}
