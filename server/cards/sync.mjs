// 卡同步：DB ↔ 仓库 YAML 的三方比较（DB 内容 / 文件内容 / 上次同步基线）。
//
// 状态：
//   synced      两侧都没变
//   db_ahead    只有 DB 变了 → 可安全导出
//   file_ahead  只有文件变了 → 可安全导入
//   conflict    两侧都变了 → 禁止自动写，必须人处理
//   db_only     DB 有、文件无 → 导出时新建
//   file_only   文件有、DB 无 → 导入时新建
//   untracked   没有同步基线（首次遇到，且两侧都有）
//
// 原则：导出/导入都是显式动作，绝不自动写仓库；冲突一律不覆盖。

import fs from 'node:fs';
import path from 'node:path';
import { parseYaml, parseYamlFile } from './yaml.mjs';
import { canonicalizers, hashOf, renderers, sha256Bytes } from './render.mjs';

const KINDS = ['requirement', 'task'];

export function cardDirs(config) {
  const spec = config?.project?.spec_path;
  const tasks = config?.project?.tasks_path;
  if (!spec || !tasks) throw new Error('配置快照缺少卡目录，无法同步');
  const baseDir = config?.project?.cards?.mode === 'repo'
    ? config?.project?.repo_path
    : config?.project?.dir;
  return { requirement: spec, task: tasks, baseDir: baseDir || spec };
}

function rel(abs, baseDir) {
  const r = path.relative(baseDir || '', abs).replace(/\\/g, '/');
  return r.startsWith('..') ? path.basename(abs) : r;
}

function listYaml(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /\.ya?ml$/i.test(f)).sort().map((f) => path.join(dir, f));
}

function scanFiles(dirs) {
  const index = new Map();
  for (const kind of KINDS) {
    for (const abs of listYaml(dirs[kind])) {
      let parsed;
      try { parsed = parseYamlFile(abs); } catch { continue; }
      if (!parsed?.id) continue;
      index.set(`${kind}:${parsed.id}`, {
        kind, id: parsed.id, abs, parsed,
        raw: fs.readFileSync(abs, 'utf8'),
      });
    }
  }
  return index;
}

export function computeSyncState(store, project, config) {
  const dirs = cardDirs(config);
  const files = scanFiles(dirs);
  const items = [];

  const requirements = store.listRequirements(project.id);
  const tasks = requirements.flatMap((r) => store.listTasks(r.id));

  for (const kind of KINDS) {
    const dbCards = kind === 'requirement' ? requirements : tasks;
    for (const card of dbCards) {
      const key = `${kind}:${card.id}`;
      const dbCanonical = canonicalizers[kind](card);
      const dbSha = hashOf(dbCanonical);
      const rec = store.getCardSync(kind, card.id);
      const file = files.get(key) || null;
      const fileSha = file ? sha256Bytes(Buffer.from(file.raw, 'utf8')) : null;

      let state;
      if (!rec) state = file ? 'untracked' : 'db_only';
      else if (!file) state = 'db_only';
      else if (dbSha === rec.baseDbSha && fileSha === rec.baseFileSha) state = 'synced';
      else if (dbSha !== rec.baseDbSha && fileSha === rec.baseFileSha) state = 'db_ahead';
      else if (dbSha === rec.baseDbSha && fileSha !== rec.baseFileSha) state = 'file_ahead';
      else state = 'conflict';

      const absPath = file?.abs ?? (rec ? path.join(dirs[kind], path.basename(rec.filePath)) : path.join(dirs[kind], `${card.id}.yaml`));
      if (file) files.delete(key);

      items.push({
        kind, id: card.id, state,
        path: rel(absPath, dirs.baseDir),
        absPath,
        dbSha, fileSha,
        baseDbSha: rec?.baseDbSha ?? null,
        baseFileSha: rec?.baseFileSha ?? null,
        action: actionOf(state),
      });
    }
  }

  for (const file of files.values()) {
    items.push({
      kind: file.kind, id: file.id, state: 'file_only',
      path: rel(file.abs, dirs.baseDir),
      absPath: file.abs,
      dbSha: null,
      fileSha: sha256Bytes(Buffer.from(file.raw, 'utf8')),
      baseDbSha: null, baseFileSha: null,
      action: 'import',
    });
  }

  const summary = items.reduce((acc, i) => {
    acc[i.state] = (acc[i.state] || 0) + 1;
    return acc;
  }, {});
  return { items, summary, dirs };
}

function actionOf(state) {
  if (state === 'db_ahead' || state === 'db_only') return 'export';
  if (state === 'file_ahead' || state === 'file_only' || state === 'untracked') return 'import';
  if (state === 'conflict') return 'manual';
  return 'none';
}

/** DB → 仓库 YAML。只处理 export 类状态；冲突与 file_ahead 一律跳过。 */
export function exportCards(store, project, config, { dryRun = false, ids, prefer = 'safe' } = {}) {
  const state = computeSyncState(store, project, config);
  const results = [];

  for (const item of state.items) {
    if (ids && !ids.includes(`${item.kind}:${item.id}`)) continue;
    const forced = prefer === 'force' && (item.state === 'conflict' || item.state === 'file_ahead');
    if (item.action !== 'export' && !forced) {
      results.push({ kind: item.kind, id: item.id, path: item.path, state: item.state, result: item.state === 'synced' ? 'skipped:in-sync' : `blocked:${item.state}` });
      continue;
    }
    const card = item.kind === 'requirement' ? store.getRequirement(item.id) : store.getTask(item.id);
    if (!card) {
      results.push({ kind: item.kind, id: item.id, path: item.path, state: item.state, result: 'failed:card-missing' });
      continue;
    }
    const text = renderers[item.kind](card);

    // 自检：渲染结果必须能被解析回来，否则宁可失败也不写坏仓库
    const roundtrip = parseYaml(text);
    if (roundtrip?.id !== item.id) {
      results.push({ kind: item.kind, id: item.id, path: item.path, state: item.state, result: 'failed:render-roundtrip' });
      continue;
    }

    if (!dryRun) {
      fs.mkdirSync(path.dirname(item.absPath), { recursive: true });
      const tmp = `${item.absPath}.tmp`;
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, item.absPath);
      store.upsertCardSync({
        kind: item.kind, cardId: item.id, projectId: project.id,
        filePath: rel(item.absPath, state.dirs.baseDir),
        baseDbSha: hashOf(canonicalizers[item.kind](card)),
        baseFileSha: sha256Bytes(Buffer.from(text, 'utf8')),
      });
      store.addEvent({
        kind: 'card.exported',
        projectId: project.id,
        requirementId: item.kind === 'requirement' ? item.id : card.requirementId,
        taskId: item.kind === 'task' ? item.id : null,
        payload: { path: item.path, forced, previousState: item.state },
      });
    }
    results.push({ kind: item.kind, id: item.id, path: item.path, state: item.state, result: dryRun ? 'would-export' : 'exported' });
  }
  return summarize(results, dryRun);
}

/** 仓库 YAML → DB。冲突不覆盖，除非显式 prefer=force。 */
export function importCards(store, project, config, { dryRun = false, ids, prefer = 'safe' } = {}) {
  const dirs = cardDirs(config);
  const files = scanFiles(dirs);
  const results = [];

  for (const [key, file] of files) {
    if (ids && !ids.includes(key)) continue;
    const rec = store.getCardSync(file.kind, file.id);
    const existing = file.kind === 'requirement' ? store.getRequirement(file.id) : store.getTask(file.id);
    const fileSha = sha256Bytes(Buffer.from(file.raw, 'utf8'));

    let action = 'import';
    let note = null;
    if (rec && existing) {
      const dbSha = hashOf(canonicalizers[file.kind](existing));
      if (dbSha !== rec.baseDbSha && fileSha !== rec.baseFileSha) {
        action = prefer === 'force' ? 'import' : 'conflict';
        note = '两侧都改过';
      }
      else if (fileSha === rec.baseFileSha) { action = 'skip'; note = dbSha !== rec.baseDbSha ? 'db-ahead（等导出）' : 'synced'; }
    } else if (!rec && existing) {
      action = prefer === 'force' ? 'import' : 'conflict';
      note = '缺少同步基线（provenance 不明）';
    }

    if (action !== 'import') {
      results.push({ kind: file.kind, id: file.id, path: rel(file.abs, dirs.baseDir), state: action, result: `${action === 'skip' ? 'skipped' : 'conflict'}:${note}` });
      continue;
    }

    if (!dryRun) {
      applyCard(store, project, file);
      const fresh = file.kind === 'requirement' ? store.getRequirement(file.id) : store.getTask(file.id);
      store.upsertCardSync({
        kind: file.kind, cardId: file.id, projectId: project.id,
        filePath: rel(file.abs, dirs.baseDir),
        baseDbSha: hashOf(canonicalizers[file.kind](fresh)),
        baseFileSha: fileSha,
      });
      store.addEvent({
        kind: 'card.imported',
        projectId: project.id,
        requirementId: file.kind === 'requirement' ? file.id : file.parsed.requirement,
        taskId: file.kind === 'task' ? file.id : null,
        payload: { path: rel(file.abs, dirs.baseDir) },
      });
    }
    results.push({ kind: file.kind, id: file.id, path: rel(file.abs, dirs.baseDir), state: 'file_ahead', result: dryRun ? 'would-import' : 'imported' });
  }
  return summarize(results, dryRun);
}

function applyCard(store, project, file) {
  const p = file.parsed;
  let requirementId = null;
  if (file.kind === 'requirement') {
    store.upsertRequirement({
      id: p.id, projectId: project.id, title: p.title, status: p.status,
      autonomy: p.autonomy, owner: p.owner, summary: p.summary,
      acceptance: (p.acceptance || []).map((a) => ({ id: a.id, text: a.text, verifyBy: a.verify_by ?? a.verifyBy })),
    });
    requirementId = p.id;
  } else {
    store.upsertTask({
      id: p.id, requirementId: p.requirement, title: p.title, objective: p.objective,
      autonomy: p.autonomy, deps: p.depends_on || [], scope: p.scope || {},
      verify: (p.verify || []).map((ref) => ({ ref })), acceptance: p.acceptance || [],
    });
    requirementId = p.requirement;
  }
  if (requirementId) store.recomputeStatuses(requirementId);
}

function summarize(results, dryRun) {
  const counts = results.reduce((acc, r) => {
    const key = String(r.result).split(':')[0];
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return { dryRun: !!dryRun, counts, items: results };
}
