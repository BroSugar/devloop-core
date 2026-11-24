#!/usr/bin/env node
// 服务端入口：建库 → 迁移 → 同步（配置快照 + 卡 + 归档）→ 监听。

import { openDb, migrate } from './db.mjs';
import { Store } from './store.mjs';
import { seedAll } from './seed.mjs';
import { createServer } from './http.mjs';

const port = Number(process.env.DEVLOOP_PORT ?? 8787);
const host = process.env.DEVLOOP_HOST ?? '127.0.0.1';
const token = process.env.DEVLOOP_TOKEN ?? 'dev-local-token';

const db = openDb(process.env.DEVLOOP_DB);
migrate(db);
const store = new Store(db);

// 每次启动都同步：配置快照、卡（冲突感知）、归档证据。
// 卡同步是幂等的，且不会覆盖 DB 侧未导出的改动。
console.log('[server] 同步 projects/ 与 archive/ …');
seedAll(store);

const server = createServer({ store, token });
server.listen(port, host, () => {
  console.log(`[server] devloop API v1 on http://${host}:${port}`);
  console.log(`[server] token: ${token}`);
  console.log(`[server] 面板：http://127.0.0.1:${port}/`);
});
