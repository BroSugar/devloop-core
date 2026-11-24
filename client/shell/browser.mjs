// Web 形态的壳：没有本地文件、终端、agent 能力，只有服务端 API。
// 这是一个「什么都不做但接口齐全」的实现——视图据此隐藏本地能力入口。

import { unsupportedCapability } from './adapter.mjs';

export function createBrowserAdapter() {
  const available = [];
  return {
    kind: 'browser',
    capabilities: async () => ({ kind: 'browser', available, version: 'web' }),
    fs: unsupportedCapability('fs'),
    term: unsupportedCapability('term'),
    agent: unsupportedCapability('agent'),
  };
}
