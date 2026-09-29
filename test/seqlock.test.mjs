// 单线程 / 小容量用例：只覆盖「不会触发缺陷」的路径，起点全绿。
// 并发缺陷（撕裂读、奇偶、屏障、重试、饥饿、回绕）藏在多线程场景里，
// 由 check/check.mjs 的确定性调度器负责复现。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SeqLock, SEQ_MASK } from '../src/seqlock.mjs';

test('初始状态可正确读回', () => {
  const l = new SeqLock({ a: 5, b: 6 });
  assert.deepEqual(l.read(), { a: 5, b: 6 });
});

test('单次写入后读取一致', () => {
  const l = new SeqLock();
  l.write({ a: 7, b: 9 });
  assert.deepEqual(l.read(), { a: 7, b: 9 });
});

test('连续写入保持最终一致', () => {
  const l = new SeqLock();
  l.write({ a: 1, b: 2 });
  l.write({ a: 3, b: 4 });
  assert.deepEqual(l.read(), { a: 3, b: 4 });
});

test('写入推进序列号且保持在 32 位内', () => {
  const l = new SeqLock();
  const before = l.seq;
  l.write({ a: 1, b: 1 });
  const delta = (l.seq - before) & SEQ_MASK;
  assert.ok(delta > 0, '序列号应被推进');
  assert.equal(l.seq & SEQ_MASK, l.seq, '序列号应受 32 位掩码约束');
});

test('写入返回成功标记', () => {
  const l = new SeqLock();
  assert.equal(l.write({ a: 1, b: 2 }), true);
});
