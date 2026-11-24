// 前端：取消按钮状态机与请求体构造。
// 原则：可取消性只从契约来；未知状态一律禁用（失败即关闭）。

import { CANCEL_REASONS } from '#contracts/order-cancel';

const DISABLED_REASONS = {
  SHIPPED: '订单已发货，无法取消',
  COMPLETED: '订单已完成，无法取消',
  CANCELLED: '订单已取消',
};

export function deriveCancelUiState(order = {}) {
  const status = order.status;
  if (status === 'PENDING') {
    return { canCancel: true, label: '取消订单', disabledReason: null };
  }
  return {
    canCancel: false,
    label: '取消订单',
    disabledReason: DISABLED_REASONS[status] || `当前状态（${status ?? '未知'}）不支持取消`,
  };
}

export function buildCancelPayload(reason) {
  if (!CANCEL_REASONS.includes(reason)) return null;
  return { reason };
}
