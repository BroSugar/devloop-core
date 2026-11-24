// 前后端共用的取消订单契约：状态、可取消判定、原因枚举与请求校验。

export const ORDER_STATUS = Object.freeze({
  PENDING: 'PENDING',
  SHIPPED: 'SHIPPED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
});

export const CANCEL_REASONS = Object.freeze([
  'customer_changed_mind',
  'address_error',
  'duplicate_order',
  'payment_issue',
  'other',
]);

export const CANCELLABLE_STATUSES = Object.freeze([ORDER_STATUS.PENDING]);

export const CANCEL_ERROR = Object.freeze({
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
  ORDER_NOT_CANCELLABLE: 'ORDER_NOT_CANCELLABLE',
  REASON_REQUIRED: 'REASON_REQUIRED',
  REASON_INVALID: 'REASON_INVALID',
});

export function isCancelableStatus(status) {
  return CANCELLABLE_STATUSES.includes(status);
}

export function validateCancelRequest(payload) {
  const reason = payload?.reason;
  if (reason === undefined || reason === null || reason === '') {
    return { ok: false, code: CANCEL_ERROR.REASON_REQUIRED };
  }
  if (!CANCEL_REASONS.includes(reason)) {
    return { ok: false, code: CANCEL_ERROR.REASON_INVALID };
  }
  return { ok: true, reason };
}
