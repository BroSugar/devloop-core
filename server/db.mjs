// SQLite 连接与迁移。存储模型的唯一事实来源是 contracts/db.v1.sql。

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const EVIDENCE_DIR = path.join(DATA_DIR, 'evidence');

export const now = () => new Date().toISOString();

export function openDb(file = path.join(DATA_DIR, 'devloop.db')) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

export function migrate(db) {
  const schema = fs.readFileSync(path.join(ROOT, 'contracts/db.v1.sql'), 'utf8');
  db.exec(schema);
  db.prepare('INSERT OR REPLACE INTO schema_meta(key, value) VALUES (?, ?)').run('schema', 'v1');
  db.prepare('INSERT OR REPLACE INTO schema_meta(key, value) VALUES (?, ?)').run('migratedAt', now());
}

export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const apiVersion = 'v1';
