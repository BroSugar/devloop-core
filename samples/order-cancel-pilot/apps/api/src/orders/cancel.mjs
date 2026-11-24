// 取消订单领域逻辑：状态机 + 原因校验 + 幂等库存释放。

import { CANCEL_ERROR, isCancelableStatus, validateCancelRequest } from '#contracts/order-cancel';

const cancelledBody = (orderId, reason) => ({ orderId, status: 'CANCELLED', reason: reason ?? null });

export function cancelOrder(store, request = {}) {
  const { orderId } = request;
  const order = store.getOrder(orderId);
  if (!order) {
    return { status: 404, body: { code: CANCEL_ERROR.ORDER_NOT_FOUND } };
  }

  // 幂等分支：已取消的订单直接返回成功，绝不再释放库存
  if (order.status === 'CANCELLED') {
    return { status: 200, body: cancelledBody(orderId, order.cancelReason) };
  }

  // 状态优先于入参校验：不可取消的订单不该因为原因为空而变成 400
  if (!isCancelableStatus(order.status)) {
    return { status: 409, body: { code: CANCEL_ERROR.ORDER_NOT_CANCELLABLE, status: order.status } };
  }

  const check = validateCancelRequest(request);
  if (!check.ok) {
    return { status: 400, body: { code: check.code } };
  }

  store.releaseReservation(orderId);
  order.status = 'CANCELLED';
  order.cancelReason = check.reason;
  return { status: 200, body: cancelledBody(orderId, check.reason) };
}
