// 订单与库存占用的内存存储。
// 关键约束：releaseReservation 必须幂等 —— 重复取消不能把库存释放两次。

export function createStore() {
  const orders = new Map();
  const reservations = new Map();

  return {
    addOrder(order) {
      orders.set(order.id, { ...order });
      return this;
    },

    addReservation(orderId, qty) {
      reservations.set(orderId, { qty, releasedQty: 0 });
      return this;
    },

    getOrder(orderId) {
      return orders.get(orderId);
    },

    getReservation(orderId) {
      return reservations.get(orderId);
    },

    /** 当前仍被占用的库存量（qty - 已释放量），用于断言“没被多释放” */
    available(orderId) {
      const reservation = reservations.get(orderId);
      if (!reservation) return 0;
      return reservation.qty - reservation.releasedQty;
    },

    releaseReservation(orderId) {
      const reservation = reservations.get(orderId);
      if (!reservation) return false;
      if (reservation.releasedQty >= reservation.qty) return false;
      reservation.releasedQty = reservation.qty;
      return true;
    },
  };
}
