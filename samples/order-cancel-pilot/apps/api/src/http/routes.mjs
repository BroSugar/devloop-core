// HTTP 路由层：把请求映射到领域调用，把领域结果映射为状态码。

import { cancelOrder } from '../orders/cancel.mjs';

const CANCEL_PATH = /^\/orders\/([^/]+)\/cancel$/;

export function handleRequest(store, request = {}) {
  const { method, path, body } = request;
  const match = typeof path === 'string' ? CANCEL_PATH.exec(path) : null;

  if (method === 'POST' && match) {
    const result = cancelOrder(store, { orderId: match[1], ...(body || {}) });
    return { status: result.status, body: result.body };
  }

  return { status: 404, body: { code: 'NOT_FOUND' } };
}
