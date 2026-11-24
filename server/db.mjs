// PostgreSQL 连接与迁移。存储模型的唯一事实来源是 contracts/db.v1.sql。
// 与 SQLite 时代的区别：全部 API 变成异步，调用方（store/api/seed）都必须 await。

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const EVIDENCE_DIR = path.join(DATA_DIR, 'evidence');

export const now = () => new Date().toISOString();

export const DEFAULT_DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://devloop:devloop@127.0.0.1:5432/devloop';

export function createPool(overrides = {}) {
  return new pg.Pool({
    connectionString: DEFAULT_DATABASE_URL,
    max: 10,
    // 启动时 PG 可能还在初始化，给一点重试余地
    connectionTimeoutMillis: 10_000,
    ...overrides,
  });
}

export async function migrate(pool) {
  const schema = fs.readFileSync(path.join(ROOT, 'contracts/db.v1.sql'), 'utf8');
  await pool.query(schema);
  await pool.query(
    `INSERT INTO schema_meta(key, value) VALUES ('schema', 'v1'), ('migratedAt', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [now()],
  );
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
}

/** 在一个连接上跑事务；回调收到 client，必须用它发查询。 */
export async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// PG 的 COUNT(*) 返回 bigint → 驱动给字符串，统一转数字，避免统计变成 "3"
export const num = (v) => (v === null || v === undefined ? 0 : Number(v));

export const apiVersion = 'v1';
