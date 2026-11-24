// Tauri v2 桌面壳适配器（骨架）。
// 只暴露三类能力，命令名与 contracts/ipc.v1.md 一一对应。
// Rust 侧需要实现：fs_read/fs_write/fs_list/fs_stat/fs_exists、term_*（portable-pty）、agent_*（sidecar）。

import { CAPABILITIES } from './adapter.mjs';

function invoke(cmd, args) {
  const core = globalThis.__TAURI__?.core;
  if (!core?.invoke) {
    const err = new Error('E_UNSUPPORTED: Tauri core.invoke 不可用');
    err.code = 'E_UNSUPPORTED';
    return Promise.reject(err);
  }
  return core.invoke(cmd, args);
}

export function createTauriAdapter() {
  return {
    kind: 'tauri',
    capabilities: async () => {
      try {
        const info = await invoke('capabilities', {});
        return { kind: 'tauri', available: info.available ?? CAPABILITIES, version: info.version ?? 'unknown' };
      } catch {
        return { kind: 'tauri', available: CAPABILITIES, version: 'unknown' };
      }
    },

    fs: {
      readFile: (path) => invoke('fs_read', { path }),
      writeFile: (path, content) => invoke('fs_write', { path, content }),
      list: (path) => invoke('fs_list', { path }),
      stat: (path) => invoke('fs_stat', { path }),
      exists: (path) => invoke('fs_exists', { path }),
    },

    term: {
      open: (opts) => invoke('term_open', opts),
      write: (sessionId, data) => invoke('term_write', { sessionId, data }),
      resize: (sessionId, cols, rows) => invoke('term_resize', { sessionId, cols, rows }),
      close: (sessionId) => invoke('term_close', { sessionId }),
      onData: (cb) => {
        const unlisten = globalThis.__TAURI__?.event?.listen('term://data', (e) => cb(e.payload.sessionId, e.payload.chunk));
        return () => { unlisten?.then?.((fn) => fn()); };
      },
      onExit: (cb) => {
        const unlisten = globalThis.__TAURI__?.event?.listen('term://exit', (e) => cb(e.payload.sessionId, e.payload.code));
        return () => { unlisten?.then?.((fn) => fn()); };
      },
    },

    agent: {
      listLocalProfiles: () => invoke('agent_list_profiles', {}),
      upsertLocalProfile: (profile) => invoke('agent_upsert_profile', { profile }),
      run: (req) => invoke('agent_run', req),
      cancel: (localRunId) => invoke('agent_cancel', { localRunId }),
      onEvent: (cb) => {
        const unlisten = globalThis.__TAURI__?.event?.listen('agent://event', (e) => cb(e.payload));
        return () => { unlisten?.then?.((fn) => fn()); };
      },
    },
  };
}
