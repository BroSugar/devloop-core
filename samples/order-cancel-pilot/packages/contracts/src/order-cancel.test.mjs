// 取消订单契约的验收测试（AC-4 / AC-7）。
// 这份测试属于“判据”，实现任务的写域不包含它。

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANCEL_ERROR,
  CANCEL_REASONS,
  ORDER_STATUS,
  isCancelableStatus,
  validateCancelRequest,
} from './order-cancel.mjs';

test('AC-7 取消原因枚举收敛为业务要求的 5 种', () => {
  assert.deepEqual(
    [...CANCEL_REASONS].sort(),
    ['address_error', 'customer_changed_mind', 'duplicate_order', 'other', 'payment_issue'],
  );
});

test('AC-7 错误码收敛在契约包，前后端共用同一份', () => {
  assert.equal(CANCEL_ERROR.ORDER_NOT_FOUND, 'ORDER_NOT_FOUND');
  assert.equal(CANCEL_ERROR.ORDER_NOT_CANCELLABLE, 'ORDER_NOT_CANCELLABLE');
  assert.equal(CANCEL_ERROR.REASON_REQUIRED, 'REASON_REQUIRED');
  assert.equal(CANCEL_ERROR.REASON_INVALID, 'REASON_INVALID');
});

test('AC-1 只有未发货（PENDING）订单可取消', () => {
  assert.equal(isCancelableStatus(ORDER_STATUS.PENDING), true);
  for (const status of [ORDER_STATUS.SHIPPED, ORDER_STATUS.COMPLETED, ORDER_STATUS.CANCELLED]) {
    assert.equal(isCancelableStatus(status), false, `${status} 不允许取消`);
  }
});

test('AC-4 缺少原因时拒绝，并给出 REASON_REQUIRED', () => {
  const result = validateCancelRequest({});
  assert.equal(result.ok, false);
  assert.equal(result.code, CANCEL_ERROR.REASON_REQUIRED);
});

test('AC-4 未知原因时拒绝，并给出 REASON_INVALID', () => {
  const result = validateCancelRequest({ reason: '因为我不想要了' });
  assert.equal(result.ok, false);
  assert.equal(result.code, CANCEL_ERROR.REASON_INVALID);
});

test('AC-4 合法原因通过校验并原样返回', () => {
  assert.deepEqual(validateCancelRequest({ reason: 'other' }), { ok: true, reason: 'other' });
});
