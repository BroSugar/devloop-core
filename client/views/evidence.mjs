// 证据查看：原文 + 哈希。客户端不解析、不重算，只展示服务端返回的内容与校验值。
import { esc } from '../web/dom.mjs';

export function renderEvidence({ evidence, content }) {
  return `
    <div class="panel-head">
      <div>
        <h2>证据 ${esc(evidence.kind)}</h2>
        <div class="muted">${esc(evidence.id)} · ${evidence.bytes} B</div>
      </div>
      <div class="actions"><button class="link" data-action="back">← 返回卡</button></div>
    </div>
    <div class="sha-line">sha256 <code>${esc(evidence.sha256)}</code></div>
    <pre class="evidence-content">${esc(content)}</pre>`;
}
