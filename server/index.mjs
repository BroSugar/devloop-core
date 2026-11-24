#!/usr/bin/env node
// 服务端入口：建连接池 → 迁移 → 同步（配置快照 + 卡 + 归档）→ 监听。

import { createPool, migrate, DEFAULT_DATABASE_URL } from './db.mjs';
import { Store } from './store.mjs';
import { seedAll } from './seed.mjs';
import { createServer } from './http.mjs';

const port = Number(process.env.DEVLOOP_PORT ?? 8787);
const host = process.env.DEVLOOP_HOST ?? '127.0.0.1';
const token = process.env.DEVLOOP_TOKEN ?? 'dev-local-token';

const pool = createPool();
// 容器编排里 PG 可能还在启动：迁移失败先重试几次，再判定为真的连不上
for (let attempt = 1; ; attempt++) {
  try {
    await migrate(pool);
    break;
  } catch (e) {
    if (attempt >= 10) {
      console.error(`[server] 迁移失败（已重试 ${attempt} 次）：${e.message}`);
      throw e;
    }
    console.warn(`[server] 数据库未就绪（第 ${attempt} 次）：${e.message}，1.5s 后重试`);
    await new Promise((r) => setTimeout(r, 1500));
  }
}
const store = new Store(pool);

// 每次启动都同步：配置快照、卡（冲突感知）、归档证据。卡同步是幂等的，
// 且不会覆盖 DB 侧未导出的改动。
console.log(`[server] PostgreSQL: ${DEFAULT_DATABASE_URL.replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@')}`);
console.log('[server] 同步 projects/ 与 archive/ …');
await seedAll(store);

const server = createServer({ store, token });
server.listen(port, host, () => {
  console.log(`[server] devloop API v1 on http://${host}:${port}`);
  console.log(`[server] token: ${token}`);
  console.log(`[server] 面板：http://127.0.0.1:${port}/`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`[server] ${signal}，关闭中…`);
    server.close(async () => {
      await pool.end().catch(() => {});
      process.exit(0);
    });
  });
}
