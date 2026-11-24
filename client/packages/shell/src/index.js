// 壳的能力边界（契约见 contracts/ipc.v1.md）。
// 两个实现：browser（Web，全降级）与 tauri（桌面，走 IPC）。视图只认这里导出的接口。
export {
  pickAdapter,
  CAPABILITIES,
  assertCapable,
  unsupportedAdapter,
  unsupportedCapability,
} from './adapter.mjs';
