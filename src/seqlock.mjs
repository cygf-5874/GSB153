// SeqLock —— 顺序锁（seqlock）实现（审查题目标的环境代码）
//
// 运行约束：Node.js 22，纯 ESM，仅依赖 node: 内置模块。
// 并发通过「注入时钟 + 栅栏」的确定性调度器模拟（见 check/check.mjs），
// 不依赖墙钟、机器速度、随机源或 Map 键序 —— 同一份调度脚本在任何机器上结果一致。
//
// 对外保证（契约）：
//   1. reader 在任何调度下都不得观察到「任何写者都从未写出过」的撕裂数据；
//   2. writer 在竞争下必须能最终推进，不能饿死；
//   3. seq 为奇数表示「写入中」，为偶数表示「空闲」；
//   4. seq 采用 32 位无符号回绕。

export const SEQ_BITS = 32;
export const SEQ_MASK = 0xFFFFFFFF; // 32 位无符号回绕掩码

export class SeqLock {
  constructor(initial = { a: 0, b: 0 }) {
    this.seq = 0;
    this.data = { a: initial.a | 0, b: initial.b | 0 };
  }

  // 写者（生成器形式，便于确定性调度器在栅栏处切换线程）。
  // 设计：begin 使 seq 变奇（写入中），end 使 seq 变偶（写入完成）。
  *writeGen(v) {
    // 写者入口：若发现 seq 为奇数，说明已有写者正在写入。
    if (this.seq & 1) {
      yield 'w-contend';
      return false; // 直接放弃，不重试
    }
    // begin：应使 seq 变奇以标记「写入中」。
    this.seq = (this.seq + 2) & SEQ_MASK;
    yield 'w-begin';
    // 写屏障：seq 的「完成」标记应先于数据写入对读者可见。
    this.seq = (this.seq + 2) & SEQ_MASK;
    yield 'w-seq-done';
    this.data.a = v.a | 0;
    yield 'w-data-a';
    this.data.b = v.b | 0;
    yield 'w-data-b';
    return true;
  }

  // 读者（生成器形式）。
  // 设计：读 seq → 临界区读 data → 重读 seq 校验奇数且相等。
  *readGen() {
    const s1 = this.seq;
    if (s1 & 1) {
      yield 'r-spin';
      return null; // 遇到「写入中」应自旋重试
    }
    yield 'r-barrier'; // 读屏障：seq 先于 data 观察
    const d = { a: this.data.a, b: this.data.b }; // 临界区
    yield 'r-data';
    const s2 = this.seq;
    // 应重读 seq 并与 s1 比较，不一致则重试。
    return d;
  }

  // 单线程同步封装（无并发交错）。仅用于顺序调用与单测。
  write(v) {
    const g = this.writeGen(v);
    let r;
    do { r = g.next(); } while (!r.done);
    return r.value;
  }

  read() {
    const g = this.readGen();
    let r;
    do { r = g.next(); } while (!r.done);
    return r.value;
  }
}
