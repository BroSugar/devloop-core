# IPC 契约 v1：壳 ↔ 视图

视图层**不得直接触碰** `window`、`fetch`、`process`、`require`、`navigator` 等宿主 API。
所有本地能力只能经由适配器（`client/shell/*`）调用，且只允许以下**三类能力**。

```ts
type Capability = "fs" | "term" | "agent";

interface ShellAdapter {
  /** 协商：告诉视图当前宿主到底支持哪些能力 */
  capabilities(): Promise<{ kind: "browser" | "tauri" | "electron"; available: Capability[]; version: string }>;
  fs: FsCapability | Unsupported;
  term: TermCapability | Unsupported;
  agent: AgentCapability | Unsupported;
}
```

`Unsupported` 是一个对象，每个方法调用都抛出 `E_UNSUPPORTED`，视图据此降级（隐藏入口而不是报错）。

## 1. fs —— 文件系统

```ts
interface FsCapability {
  readFile(path: string): Promise<string>;               // UTF-8；二进制返回 base64 前缀 "base64:"
  writeFile(path: string, content: string): Promise<void>;
  list(path: string): Promise<Array<{ name: string; isDir: boolean; size: number }>>;
  stat(path: string): Promise<{ isDir: boolean; size: number; mtime: string }>;
  exists(path: string): Promise<boolean>;
}
```

约束：
- 仅限用户**显式选择**的工作区根目录之下（壳负责记录根目录并做前缀校验）。
- 不提供递归删除、不提供 chmod、不提供路径穿越。

## 2. term —— 终端

```ts
interface TermCapability {
  open(opts: { cwd: string; shell?: string; cols?: number; rows?: number }): Promise<string>; // sessionId
  write(sessionId: string, data: string): Promise<void>;
  resize(sessionId: string, cols: number, rows: number): Promise<void>;
  close(sessionId: string): Promise<void>;
  onData(cb: (sessionId: string, chunk: string) => void): () => void;  // 返回取消订阅
  onExit(cb: (sessionId: string, code: number) => void): () => void;
}
```

约束：
- 终端只用于**人机交互**与 agent 的交互式兜底；自动化执行走服务端 run，不走终端。
- 壳必须限制最大并发会话数（建议 4），并在窗口关闭时统一回收。

## 3. agent —— 本地 agent

```ts
interface AgentCapability {
  listLocalProfiles(): Promise<LocalProfile[]>;         // 用户本机已配置的 agent
  upsertLocalProfile(p: LocalProfile): Promise<void>;   // 写本地存储，不写服务端
  run(req: {
    profileId: string;
    prompt: string;
    cwd: string;
    env?: Record<string, string>;
  }): Promise<{ localRunId: string }>;
  onEvent(cb: (e: AgentEvent) => void): () => void;
  cancel(localRunId: string): Promise<void>;
}

interface LocalProfile {
  id: string;
  name: string;
  adapter: "cli" | "vscode-claude-code";
  command: string;          // 例：claude
  args?: string[];
  model?: string;
  outputFormat?: "json" | "text";
}
```

约束：
- `run` 的 stdout 必须是 JSON（或按 profile 的 `outputFormat`），壳负责解析与超时。
- **本地 profile 只在客户端生效**；触发服务端执行时必须以 `localOverride` 上报，
  服务端按 `agent/v1` 的 `policy` 判定（是否允许 shell、是否允许网络、是否需人审）。

## 能力协商与降级

| 形态 | fs | term | agent | 降级表现 |
| --- | --- | --- | --- | --- |
| Web（浏览器） | ✗ | ✗ | ✗ | 只读服务端数据；本地 agent 入口隐藏；卡片编辑走服务端 API |
| Tauri 桌面 | ✓ | ✓ | ✓ | 全功能 |
| Electron 桌面 | ✓ | ✓ | ✓ | 全功能（适配器实现不同，接口不变） |

## 桌面壳选择

**Tauri v2**。理由：capability 白名单模型与"只暴露三类能力"天然同构；体积与内存远小于 Electron；
sidecar 可以承载本地 agent 二进制。代价：PTY 与文件监听需要 Rust 侧实现（`portable-pty`、`notify`）。

切换判据（写死在这里，避免反复摇摆）：若 3 周内无法交付稳定 PTY + 文件监听，切 Electron——
只需新增 `client/shell/electron.mjs`，视图层与契约不变。
