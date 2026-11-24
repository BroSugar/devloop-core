// HTTP 层：信封、鉴权、静态资源、请求体解析。业务判定全部在 api.mjs。

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createApi } from './api.mjs';
import { apiVersion, ROOT } from './db.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function sendText(res, status, text, headers = {}) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...headers });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 2 * 1024 * 1024) { req.destroy(); resolve(undefined); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(undefined);
      try { resolve(JSON.parse(raw)); } catch { resolve(undefined); }
    });
  });
}

function resolveStatic(pathname) {
  if (pathname === '/' || pathname === '') return path.join(ROOT, 'client/web/index.html');
  const safe = path.normalize(pathname).replace(/^([/\\])+/, '');
  if (safe.includes('..')) return null;
  if (safe.startsWith('contracts/')) return path.join(ROOT, safe);
  if (safe.startsWith('web/') || safe.startsWith('views/') || safe.startsWith('shell/')) {
    return path.join(ROOT, 'client', safe);
  }
  return null;
}

export function createServer({ store, token }) {
  const api = createApi({ store });

  return http.createServer(async (req, res) => {
    const requestId = crypto.randomUUID();
    const meta = { apiVersion, requestId, serverTime: new Date().toISOString() };
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith('/api/')) {
      if (pathname !== '/api/v1/health') {
        const auth = req.headers.authorization || '';
        if (auth !== `Bearer ${token}`) {
          return sendJson(res, 401, { error: { code: 'unauthorized', message: '需要 Bearer token（Authorization: Bearer <token>）' }, meta });
        }
      }
      const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
      const result = api.handle({
        method: req.method,
        pathname,
        query: Object.fromEntries(url.searchParams),
        body,
        headers: req.headers,
      });
      if (result.text !== undefined) return sendText(res, result.status, result.text, result.headers);
      if (result.error) return sendJson(res, result.status, { error: result.error, meta });
      return sendJson(res, result.status, { data: result.data, meta }, );
    }

    const file = resolveStatic(pathname);
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return sendText(res, 404, `not found: ${pathname}`);
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
}
