import test from 'node:test';
import assert from 'node:assert/strict';
import { clamp } from './calc.mjs';

test('AC-1 区间内原样返回', () => {
  assert.equal(clamp(5, 1, 10), 5);
});

test('AC-2 越界时裁剪到边界', () => {
  assert.equal(clamp(-3, 1, 10), 1);
  assert.equal(clamp(99, 1, 10), 10);
});

test('AC-3 非法区间（min > max）必须报错', () => {
  assert.throws(() => clamp(5, 10, 1), /区间/);
});

test('AC-4 边界值原样返回', () => {
  assert.equal(clamp(1, 1, 10), 1);
  assert.equal(clamp(10, 1, 10), 10);
});
