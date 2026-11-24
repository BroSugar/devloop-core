// 证据归档：每次执行产物落盘 + manifest（sha256）+ 全局索引，可校验、可追溯。
// 存档路径：archive/<project>/<requirement>/<task>/attempt-<n>/

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLATFORM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function walk(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, base, out);
    else out.push({ abs, rel: path.relative(base, abs).replace(/\\/g, '/') });
  }
  return out;
}

/**
 * 把一次执行的运行目录归档为不可变证据包。
 * @returns {{dest:string, manifest:string, files:number}}
 */
export function archiveRun({ root = PLATFORM_ROOT, projectId, requirement, taskId, attempt, runDir, meta = {} }) {
  const dest = path.join(root, 'archive', projectId, requirement, taskId, `attempt-${attempt}`);
  fs.mkdirSync(dest, { recursive: true });

  const files = [];
  for (const { abs, rel } of walk(runDir)) {
    const target = path.join(dest, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(abs, target);
    files.push({ path: rel, sha256: sha256File(target), bytes: fs.statSync(target).size });
  }

  const manifest = {
    schema: 'evidence/v1',
    project: projectId,
    requirement,
    task: taskId,
    attempt,
    archivedAt: new Date().toISOString(),
    verdict: meta.verdict ?? 'unknown',
    ...meta,
    files,
  };
  const manifestPath = path.join(dest, 'manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const indexFile = path.join(root, 'archive', 'index.jsonl');
  fs.mkdirSync(path.dirname(indexFile), { recursive: true });
  fs.appendFileSync(indexFile, `${JSON.stringify({
    at: manifest.archivedAt,
    project: projectId,
    requirement,
    task: taskId,
    attempt,
    verdict: manifest.verdict,
    files: files.length,
    manifest: path.relative(root, manifestPath).replace(/\\/g, '/'),
  })}\n`);

  return { dest, manifest: manifestPath, files: files.length };
}

export function readIndex(root = PLATFORM_ROOT) {
  const file = path.join(root, 'archive/index.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** 全量校验所有 manifest 的哈希，发现篡改或丢失。 */
export function verifyArchive(root = PLATFORM_ROOT) {
  const archiveDir = path.join(root, 'archive');
  const manifests = walk(archiveDir).filter((f) => f.rel.endsWith('manifest.json'));
  const problems = [];
  for (const m of manifests) {
    const manifest = JSON.parse(fs.readFileSync(m.abs, 'utf8'));
    const base = path.dirname(m.abs);
    for (const entry of manifest.files || []) {
      const file = path.join(base, entry.path);
      if (!fs.existsSync(file)) { problems.push(`缺失文件 ${entry.path}（${m.rel}）`); continue; }
      if (sha256File(file) !== entry.sha256) problems.push(`哈希不匹配 ${entry.path}（${m.rel}）`);
    }
  }
  return { checked: manifests.length, problems };
}
