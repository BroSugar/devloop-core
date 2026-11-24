// 取消订单领域逻辑的验收测试（AC-1 / AC-2 / AC-3 / AC-4 / AC-6）。
// 这份测试属于“判据”，实现任务的写域不包含它。

import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from './store.mjs';
import { cancelOrder } from './cancel.mjs';

function seedStore() {
  const store = createStore();
  store.addOrder({ id: 'O-1', status: 'PENDING', total: 19900 });
  store.addOrder({ id: 'O-2', status: 'SHIPPED', total: 9900 });
  store.addOrder({ id: 'O-3', status: 'COMPLETED', total: 100 });
  store.addOrder({ id: 'O-4', status: 'PENDING', total: 500 });
  store.addReservation('O-1', 2);
  store.addReservation('O-2', 1);
  store.addReservation('O-4', 3);
  return store;
}

test('AC-1 未发货订单取消返回 200 且状态变为 CANCELLED', () => {
  const store = seedStore();
  const result = cancelOrder(store, { orderId: 'O-1', reason: 'customer_changed_mind' });
  assert.equal(result.status, 200);
  assert.equal(result.body.orderId, 'O-1');
  assert.equal(result.body.status, 'CANCELLED');
  assert.equal(store.getOrder('O-1').status, 'CANCELLED');
});

test('AC-2 取消后释放库存占用（2 -> 0）', () => {
  const store = seedStore();
  assert.equal(store.available('O-1'), 2, '取消前占用 2 件');
  cancelOrder(store, { orderId: 'O-1', reason: 'other' });
  assert.equal(store.available('O-1'), 0, '取消后占用应清零');
});

test('AC-2 重复取消幂等，库存不会被重复释放', () => {
  const store = seedStore();
  cancelOrder(store, { orderId: 'O-1', reason: 'other' });
  const second = cancelOrder(store, { orderId: 'O-1', reason: 'other' });
  assert.equal(second.status, 200, '重复取消仍返回 200（幂等）');
  assert.equal(store.available('O-1'), 0, '库存不能被释放两次');
});

test('AC-3 已发货订单不可取消，返回 409 且库存不动', () => {
  const store = seedStore();
  const result = cancelOrder(store, { orderId: 'O-2', reason: 'other' });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'ORDER_NOT_CANCELLABLE');
  assert.equal(store.getOrder('O-2').status, 'SHIPPED');
  assert.equal(store.available('O-2'), 1);
});

test('AC-3 已完成订单不可取消', () => {
  const store = seedStore();
  assert.equal(cancelOrder(store, { orderId: 'O-3', reason: 'other' }).status, 409);
});

test('AC-6 订单不存在返回 404', () => {
  const store = seedStore();
  const result = cancelOrder(store, { orderId: 'O-404', reason: 'other' });
  assert.equal(result.status, 404);
  assert.equal(result.body.code, 'ORDER_NOT_FOUND');
});

test('AC-4 缺少取消原因返回 400', () => {
  const store = seedStore();
  const result = cancelOrder(store, { orderId: 'O-4' });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, 'REASON_REQUIRED');
  assert.equal(store.getOrder('O-4').status, 'PENDING', '校验失败不得改状态');
});

test('AC-4 非法取消原因返回 400', () => {
  const store = seedStore();
  const result = cancelOrder(store, { orderId: 'O-4', reason: '不想要了' });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, 'REASON_INVALID');
});
