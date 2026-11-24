// AI 接入层：provider / agent 全部配置化，内核不出现任何模型名。
//
// 三种 provider 形态：
//   openai-compatible  统一 /chat/completions，覆盖 OpenAI 及绝大多数国产兼容端点
//   anthropic          /v1/messages
//   cli                本地或容器内的 agent 命令（配置 command，prompt 走文件）
//
// 沙箱内无外网，所以 http 形态用 --dry-run 打印真实请求体（含 header 名，脱敏 key）；
// 真正发请求的代码在 invoke()，设置 DSH_PLATFORM_ALLOW_NETWORK=1 才会执行。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PLATFORM_ROOT, readYaml } from './config.mjs';

export function loadAi(root = PLATFORM_ROOT) {
  const providersFile = path.join(root, 'config/providers.yaml');
  const agentsFile = path.join(root, 'config/agents.yaml');
  const providers = fs.existsSync(providersFile) ? (readYaml(providersFile).providers || {}) : {};
  const agentsDoc = fs.existsSync(agentsFile) ? readYaml(agentsFile) : {};
  return { providers, agents: agentsDoc.agents || {}, routing: agentsDoc.routing || {} };
}

export function resolveAgent(ai, role, projectId) {
  const agentName = ai.routing?.by_project?.[projectId]?.[role]
    || ai.routing?.by_role?.[role]
    || ai.routing?.default;
  if (!agentName) throw new Error(`没有为角色 ${role} 配置路由（config/agents.yaml routing）`);
  const agent = ai.agents[agentName];
  if (!agent) throw new Error(`agents.yaml 里没有定义 ${agentName}`);
  const providerName = agent.provider;
  const provider = ai.providers[providerName];
  if (!provider) throw new Error(`providers.yaml 里没有定义 ${providerName}（被 agent ${agentName} 引用）`);
  return { role, agentName, agent, providerName, provider };
}

export function promptPath(agent, root = PLATFORM_ROOT) {
  if (!agent.prompt) return null;
  const file = path.join(root, 'config', agent.prompt);
  if (!fs.existsSync(file)) throw new Error(`prompt 文件不存在：${agent.prompt}`);
  return file;
}

function maskKey(v) {
  if (!v) return '(未设置)';
  return `${v.slice(0, 4)}…${v.slice(-2)}`;
}

/** 构造一次模型调用请求；dry-run 与真实调用共用同一份构造逻辑。 */
export function buildRequest({ agent, provider, system, user }) {
  const temperature = agent.temperature ?? 0.2;
  const maxTokens = agent.max_tokens ?? 4096;
  const model = provider.model || agent.model;
  const keyVar = provider.api_key_env;
  const apiKey = keyVar ? process.env[keyVar] : undefined;

  switch (provider.kind) {
    case 'openai-compatible':
      if (!model) throw new Error('provider 未配置 model，且 agent 未覆盖');
      return {
        kind: 'http',
        method: 'POST',
        url: `${String(provider.base_url).replace(/\/+$/, '')}/chat/completions`,
        headers: {
          'content-type': 'application/json',
          ...(keyVar ? { authorization: `Bearer ${apiKey ?? `\${${keyVar}}`}` } : {}),
        },
        body: {
          model,
          temperature,
          max_tokens: maxTokens,
          messages: [
            ...(system ? [{ role: 'system', content: system }] : []),
            { role: 'user', content: user },
          ],
        },
      };

    case 'anthropic':
      return {
        kind: 'http',
        method: 'POST',
        url: `${String(provider.base_url).replace(/\/+$/, '')}/v1/messages`,
        headers: {
          'content-type': 'application/json',
          'anthropic-version': provider.anthropic_version || '2023-06-01',
          ...(keyVar ? { 'x-api-key': apiKey ?? `\${${keyVar}}` } : {}),
        },
        body: {
          model,
          max_tokens: maxTokens,
          temperature,
          ...(system ? { system } : {}),
          messages: [{ role: 'user', content: user }],
        },
      };

    case 'cli':
      return {
        kind: 'cli',
        command: provider.command,
        env: { ...(provider.env || {}), DSH_AGENT_ROLE: agent.role || '', DSH_AGENT_NAME: agent.name || '' },
        prompt: { system, user },
      };

    default:
      throw new Error(`不支持的 provider kind：${provider.kind}（支持 openai-compatible / anthropic / cli）`);
  }
}

export async function invoke(request) {
  if (request.kind === 'http') {
    if (process.env.DSH_PLATFORM_ALLOW_NETWORK !== '1') {
      throw new Error('网络调用被禁用：设置 DSH_PLATFORM_ALLOW_NETWORK=1 或使用 --dry-run 查看请求体');
    }
    const res = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: JSON.stringify(request.body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`模型调用失败 ${res.status}: ${text.slice(0, 400)}`);
    return JSON.parse(text);
  }
  if (request.kind === 'cli') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-agent-'));
    const promptFile = path.join(dir, 'prompt.json');
    const outFile = path.join(dir, 'out.json');
    fs.writeFileSync(promptFile, JSON.stringify(request.prompt, null, 2));
    const fd = fs.openSync(outFile, 'w');
    let result;
    try {
      result = spawnSync(request.command, [], {
        shell: true,
        stdio: ['ignore', fd, fd],
        env: { ...process.env, ...request.env, DSH_PROMPT_FILE: promptFile },
        windowsHide: true,
      });
    } finally {
      fs.closeSync(fd);
    }
    const out = fs.readFileSync(outFile, 'utf8');
    fs.rmSync(dir, { recursive: true, force: true });
    if (result.status !== 0) throw new Error(`agent 命令失败(${result.status})：${out.slice(0, 400)}`);
    return JSON.parse(out);
  }
  throw new Error(`未知请求类型：${request.kind}`);
}

/** dry-run 展示：请求体、header 名、key 来源（脱敏）。 */
export function describe(request, provider) {
  if (request.kind === 'http') {
    const keyVar = provider.api_key_env;
    return {
      kind: 'http',
      method: request.method,
      url: request.url,
      model: request.body.model,
      apiKeyEnv: keyVar || '(无)',
      apiKeyPresent: !!(keyVar && process.env[keyVar]),
      apiKeyPreview: maskKey(keyVar ? process.env[keyVar] : undefined),
      headers: Object.keys(request.headers),
      bodyPreview: JSON.stringify(request.body, null, 2),
    };
  }
  return {
    kind: 'cli',
    command: request.command,
    envKeys: Object.keys(request.env),
    promptBytes: Buffer.byteLength(JSON.stringify(request.prompt)),
  };
}
