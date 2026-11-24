// 测试用数据库：每个测试文件建一个独立 database，跑完删掉。
// 这样测试之间不共享状态，也不依赖开发者本地现有的 devloop 库。
import pg from 'pg';
import { createPool, migrate } from '../db.mjs';

const BASE = process.env.DATABASE_URL ?? 'postgres://devloop:devloop@127.0.0.1:5432/devloop';
const ADMIN = BASE.replace(/\/[^/]+$/, '/postgres');

export async function createTestDb(label = 'test') {
  const name = `devloop_${label}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  const admin = new pg.Client({ connectionString: ADMIN });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const url = BASE.replace(/\/[^/]+$/, `/${name}`);
  const pool = createPool({ connectionString: url, max: 5 });
  await migrate(pool);

  return {
    name,
    url,
    pool,
    async drop() {
      await pool.end().catch(() => {});
      const a = new pg.Client({ connectionString: ADMIN });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await a.end();
    },
  };
}
