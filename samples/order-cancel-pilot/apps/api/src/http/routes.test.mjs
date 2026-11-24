// HTTP 层的验收测试（AC-1 / AC-3 / AC-6 的状态码映射）。

import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../orders/store.mjs';
import { handleRequest } from './routes.mjs';

function seedStore() {
  const store = createStore();
  store.addOrder({ id: 'O-1', status: 'PENDING', total: 19900 });
  store.addOrder({ id: 'O-2', status: 'SHIPPED', total: 9900 });
  store.addOrder({ id: 'O-4', status: 'PENDING', total: 500 });
  store.addReservation('O-1', 2);
  store.addReservation('O-2', 1);
  store.addReservation('O-4', 3);
  return store;
}

const post = (path, body) => ({ method: 'POST', path, body });

test('AC-1 POST /orders/:id/cancel 成功返回 200', () => {
  const store = seedStore();
  const res = handleRequest(store, post('/orders/O-1/cancel', { reason: 'other' }));
  assert.equal(res.status, 200);
  assert.equal(res.body.orderId, 'O-1');
});

test('AC-6 未知订单映射为 404', () => {
  const store = seedStore();
  const res = handleRequest(store, post('/orders/O-404/cancel', { reason: 'other' }));
  assert.equal(res.status, 404);
  assert.equal(res.body.code, 'ORDER_NOT_FOUND');
});

test('AC-3 不可取消订单映射为 409', () => {
  const store = seedStore();
  const res = handleRequest(store, post('/orders/O-2/cancel', { reason: 'other' }));
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'ORDER_NOT_CANCELLABLE');
});

test('AC-4 缺少原因映射为 400', () => {
  const store = seedStore();
  const res = handleRequest(store, post('/orders/O-4/cancel', {}));
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'REASON_REQUIRED');
});

test('未知路由返回 404', () => {
  const store = seedStore();
  const res = handleRequest(store, { method: 'GET', path: '/orders/O-1' });
  assert.equal(res.status, 404);
});
