// 壳的能力边界：视图只通过这里拿本地能力，不直接碰 window / __TAURI__。
// 契约见 contracts/ipc.v1.md（fs / term / agent 三类）。
export { pickAdapter, CAPABILITIES } from '../../shell/adapter.mjs';
