// 壳 ↔ 视图 的适配器契约（见 contracts/ipc.v1.md）。
// 视图只认这个对象，不认 window / fetch / __TAURI__。能力缺失时抛 E_UNSUPPORTED，视图降级。

export const unsupportedCapability = (kind) => {
  const thrower = () => {
    const err = new Error(`E_UNSUPPORTED: ${kind}`);
    err.code = 'E_UNSUPPORTED';
    return Promise.reject(err);
  };
  return new Proxy({}, {
    get(_target, prop) {
      if (prop === 'kind') return kind;
      if (prop === 'supported') return false;
      return thrower;
    },
  });
};

export const CAPABILITIES = ['fs', 'term', 'agent'];

export function unsupportedAdapter(kind) {
  return {
    kind,
    capabilities: async () => ({ kind, available: [], version: 'n/a' }),
    fs: unsupportedCapability('fs'),
    term: unsupportedCapability('term'),
    agent: unsupportedCapability('agent'),
  };
}

/** 选壳：有 Tauri 运行时走桌面适配器，否则降级为浏览器适配器。 */
export async function pickAdapter() {
  const tauri = globalThis.__TAURI__ || globalThis.__TAURI_INTERNALS__;
  if (tauri) {
    const mod = await import('./tauri.mjs');
    return mod.createTauriAdapter();
  }
  const mod = await import('./browser.mjs');
  return mod.createBrowserAdapter();
}

export function assertCapable(adapter, capability) {
  return adapter.capabilities().then((info) => {
    if (!info.available.includes(capability)) {
      const err = new Error(`E_UNSUPPORTED: ${capability}`);
      err.code = 'E_UNSUPPORTED';
      throw err;
    }
    return true;
  });
}
