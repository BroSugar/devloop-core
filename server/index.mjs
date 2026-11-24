#!/usr/bin/env node
// 服务端入口：建库 → 迁移 → 首次导入 → 监听。

import { openDb, migrate } from './db.mjs';
import { Store } from './store.mjs';
import { seedAll } from './seed.mjs';
import { createServer } from './http.mjs';

const port = Number(process.env.DEVLOOP_PORT ?? 8787);
const token = process.env.DEVLOOP_TOKEN ?? 'dev-local-token';

const db = openDb(process.env.DEVLOOP_DB);
migrate(db);
const store = new Store(db);

if (store.listProjects().length === 0) {
  console.log('[server] 首次启动，从 projects/ + archive/ 导入…');
  seedAll(store);
}

const server = createServer({ store, token });
server.listen(port, '127.0.0.1', () => {
  console.log(`[server] devloop API v1 on http://127.0.0.1:${port}`);
  console.log(`[server] token: ${token}`);
  console.log(`[server] 打开面板：http://127.0.0.1:${port}/`);
});
