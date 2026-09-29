# GSB153 · seqlock 顺序锁审查

一份顺序锁（seqlock）实现，待审查。运行环境 **Node.js v22，纯 ESM，仅使用 `node:` 内置模块**，
`package.json` 的 `dependencies` 为空。

## 怎么跑

```bash
node --test                 # 单线程 / 小容量用例（起点全绿）
node check/check.mjs        # 8 项审查判据（需先填好 REVIEW.md）
bash scripts/check.sh       # 同上，等价于上面一行
node check/check.mjs -list  # 列出 8 个场景的 id
node check/check.mjs --only parity   # 只跑某一组（parity/recheck/barrier/retry/starvation/overflow/correct/masking）
```

## 结构

```
src/seqlock.mjs    顺序锁实现（含待发现的缺陷，勿修改）
test/seqlock.test.mjs  单线程用例，起点全绿
check/check.mjs        固定验收件（8 场景，勿修改）
REVIEW.md          你唯一要改的文件（六小节模板）
PROMPT.md          原题面
```

## 顺序锁语义契约

顺序锁由一把序列号 `seq` 与受保护数据 `data` 组成：

- **读者**：读 `seq` → 临界区读取 `data` → 重读 `seq`，校验其为偶数且与第一次读到的一致；
  若不一致（或读到的 `seq` 为奇数，表示写者正在写入）则重试。
- **写者**：把 `seq` 变成奇数（标记「写入中」）→ 写入 `data` → 把 `seq` 变回偶数（标记「写入完成」）。

对外保证（即判卷所依据的契约）：

1. 读者在任何调度下都不得观察到「任何写者都从未写出过」的**撕裂数据**；
2. 写者在竞争下必须能**最终推进**，不能饿死；
3. `seq` 为**奇数**表示「写入中」，**偶数**表示「空闲」；
4. `seq` 采用 **32 位无符号回绕**。

## 并发是如何被确定性模拟的

`src/seqlock.mjs` 的 `readGen` / `writeGen` 是生成器，在「栅栏」处 `yield`。
`check/check.mjs` 持有一个**注入时钟 + 栅栏**调度器：它按一份**固定脚本**逐步推进各「线程」，
在栅栏处切换。整个过程**不依赖墙钟、机器速度、随机源或 Map 键序**，因此同一脚本在任何机器上
结果一致；判据也绝不使用「放行数」这类会摆动的量，而是断言确切的撕裂值 / 确切的奇偶位 / 确切的推进结果。

## 你的任务

见 `PROMPT.md`。只改 `REVIEW.md`，不要改任何源码，也不要改 `check/`。
