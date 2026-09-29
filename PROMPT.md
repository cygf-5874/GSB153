GSB153-seqlock · 运行环境 Node.js v22（纯 ESM，仅用 `node:` 内置模块，`package.json` 的 `dependencies` 为空）。跑法：`node --test` 跑单线程用例；`node check/check.mjs`（或 `bash scripts/check.sh`）跑 8 项审查判据，支持 `--only <组名>` 与 `-list`。

任务：审查 `src/seqlock.mjs` 里的顺序锁（seqlock）实现。它用「注入时钟 + 栅栏」的确定性调度器模拟并发——`reader` 读 `seq` → 临界区读 `data` → 重读 `seq` 校验偶数且相等；`writer` 取奇数 `seq` 写 → 偶数 `seq` 释放。语义契约：① 读者在任何调度下都不得观察到「任何写者都从未写出过」的撕裂数据；② 写者在竞争下必须能最终推进、不能饿死；③ `seq` 为奇表示写入中、为偶表示空闲；④ `seq` 为 32 位回绕。

你**只改 `REVIEW.md`**（六小节占位模板已给出），不要改任何源码，也不要动 `check/`。请找出全部缺陷，每节写明：现象、根因、该缺陷违反哪条契约、以及修复方案。要求：六处缺陷全部识别、每节给出修复方向、并说明缺陷之间如何互相掩盖（例如只修一处为何仍不足）。你的审查结论须让八项判据全过（`node check/check.mjs` → `结果：通过 8/8` 且 `exit 0`）。可用 `node --test` 自行核对单线程路径，但它不覆盖并发缺陷。
