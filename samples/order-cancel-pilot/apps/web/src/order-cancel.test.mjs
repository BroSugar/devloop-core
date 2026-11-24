// 前端取消按钮的验收测试（AC-5 / AC-7）。
// 断言行为，不断言文案：文案会变，可取消性不该变。

import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveCancelUiState, buildCancelPayload } from './order-cancel.mjs';

test('AC-5 未发货订单展示可取消', () => {
  const state = deriveCancelUiState({ id: 'O-1', status: 'PENDING' });
  assert.equal(state.canCancel, true);
  assert.equal(state.disabledReason, null);
  assert.ok(state.label && state.label.length > 0, '按钮必须有文案');
});

test('AC-5 已发货 / 已完成 / 已取消均禁用并给出原因', () => {
  const cases = [
    ['SHIPPED', /发货/],
    ['COMPLETED', /完成/],
    ['CANCELLED', /取消/],
  ];
  for (const [status, pattern] of cases) {
    const state = deriveCancelUiState({ id: 'O-9', status });
    assert.equal(state.canCancel, false, `${status} 不允许取消`);
    assert.match(state.disabledReason, pattern);
  }
});

test('AC-5 未知状态一律禁用（失败即关闭）', () => {
  const state = deriveCancelUiState({ id: 'O-9', status: 'SOMETHING_NEW' });
  assert.equal(state.canCancel, false);
  assert.ok(state.disabledReason);
});

test('AC-7 取消请求体只携带服务端认可的原因', () => {
  assert.deepEqual(buildCancelPayload('other'), { reason: 'other' });
  assert.equal(buildCancelPayload('因为不喜欢'), null);
  assert.equal(buildCancelPayload(undefined), null);
});
