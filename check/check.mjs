// check/check.mjs —— GSB153 固定验收件（代码理解题）
//
// 8 个场景：6 个 finding（每项缺陷）+ 2 个正确性锚点。
// 确定性：所有并发判据通过「注入时钟 + 栅栏」调度器复现，不依赖墙钟、
//   机器速度、Map 键序或随机源；不使用「放行数」这类会摆动的量。
// 输出：PASS <组>/<名> / FAIL <组>/<名>  期望=… 实际=…
//   结尾：结果：通过 x/8 ；全过 exit 0 ；任何场景失败也不提前退出。
// 用法：node check/check.mjs [ -list | --only <组名> ]
//
// 说明：本件是「审查题」判据。模型只交付 REVIEW.md（不改源码）。
//   每个 finding 同时做两件事：(a) 校验 REVIEW.md 对应小节是否识别出该缺陷；
//   (b) 在 buggy 源码上用确定性调度器复现该缺陷（行为佐证）。
//   两个正确性锚点要求：六处缺陷全部识别、且每节给出修复方向、并说明缺陷互相掩盖。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SeqLock } from '../src/seqlock.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

// ---------------------------------------------------------------------------
// 确定性调度器：按固定脚本逐步推进各「线程」（生成器）。
// schedule 是一组线程下标；每推进一个线程到它的下一个 yield。
// 不引入任何时间/随机因素，故可稳定复现。
// ---------------------------------------------------------------------------
function race(gens, schedule) {
  // gens 已是生成器对象（带 .next()）；按固定脚本逐步推进。
  const its = gens;
  const done = its.map(() => false);
  const out = its.map(() => undefined);
  let k = 0;
  while (k < schedule.length) {
    const i = schedule[k++];
    if (i < 0 || i >= its.length || done[i]) continue;
    const r = its[i].next();
    if (r.done) {
      done[i] = true;
      out[i] = r.value;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 缺陷定义：定位小节（标题关键词）、正文必含关键词、修复方向关键词。
// ---------------------------------------------------------------------------
const DEFECTS = [
  {
    key: 'recheck',
    heading: ['重校验', 'recheck', '一致性校验'],
    body: ['重校验', 'recheck', '不一致', 'seq1', 'seq2', 's1', 's2', '校验', '两次读'],
    fix: ['修复', '修正', '应改为', '应当', '改为', '需要', '必须', '补上', '加上', '需将'],
  },
  {
    key: 'parity',
    heading: ['奇偶', 'parity', '序列号'],
    body: ['奇偶', 'parity', '奇数', '偶数', '奇', '偶', 'seq'],
    fix: ['修复', '修正', '应改为', '应当', '改为', '需要', '必须'],
  },
  {
    key: 'barrier',
    heading: ['屏障', 'barrier', '内存屏障'],
    body: ['屏障', 'barrier', '可见性', '重排', '顺序', '内存', 'fence', '栅栏'],
    fix: ['修复', '修正', '应改为', '应当', '改为', '需要', '必须'],
  },
  {
    key: 'retry',
    heading: ['重试', 'retry', '自旋'],
    body: ['重试', 'retry', '自旋', 'spin', '重读'],
    fix: ['修复', '修正', '应改为', '应当', '改为', '需要', '必须'],
  },
  {
    key: 'starvation',
    heading: ['饥饿', 'starvation', '写者饿', '饿死'],
    body: ['饥饿', 'starvation', '饿', '放弃'],
    fix: ['修复', '修正', '应改为', '应当', '改为', '需要', '必须'],
  },
  {
    key: 'overflow',
    heading: ['溢出', '回绕', 'overflow', '32', '2^32', '位回绕'],
    body: ['溢出', '回绕', 'overflow', '32', '位', 'wrap'],
    fix: ['修复', '修正', '应改为', '应当', '改为', '需要', '必须'],
  },
];

const FIX = ['修复', '修正', '应改为', '应当', '改为', '需要', '必须', '补上', '加上', '需将'];
const MASK = ['掩盖', '互相', '交互', '牵制', '单修', '仅修复', '仅修', '子集', '独立修复', '单独修复', '不足以', '同时修复', '耦合', '相互'];

// ---------------------------------------------------------------------------
// REVIEW.md 解析：按 Markdown 标题切分正文。
// ---------------------------------------------------------------------------
function loadReview() {
  try {
    return readFileSync(resolve(ROOT, 'REVIEW.md'), 'utf8');
  } catch {
    return '';
  }
}

function parseSections(md) {
  const sections = new Map();
  let cur = null;
  let body = [];
  for (const line of md.split(/\r?\n/)) {
    if (/^#{1,6}\s+/.test(line)) {
      if (cur !== null) sections.set(cur, body.join('\n'));
      cur = line.replace(/^#{1,6}\s+/, '').trim();
      body = [];
    } else if (cur !== null) {
      body.push(line);
    }
  }
  if (cur !== null) sections.set(cur, body.join('\n'));
  return sections;
}

function sectionBody(defect, sections) {
  for (const [h, b] of sections) {
    if (defect.heading.some((k) => h.includes(k))) return b;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 行为佐证：在 buggy 源码上用确定性调度器复现各缺陷。
// 全部为固定脚本，结果可稳定复现，不使用任何摆动量。
// ---------------------------------------------------------------------------
function runProbe(key) {
  switch (key) {
    case 'recheck': {
      // 写者先发布“完成”(偶) 再写数据；读者在写者写完 seq 后、写数据前读 → 撕裂/陈旧。
      const l = new SeqLock();
      const v = { a: 11, b: 22 };
      const out = race([l.writeGen(v), l.readGen()], [0, 1, 0, 1, 0, 1]);
      const got = out[1];
      const confirmed = !(got && got.a === v.a && got.b === v.b);
      return {
        confirmed,
        expect: '读者应读到 v={11,22} 或与某次写入一致',
        actual: confirmed ? `读者读到陈旧值 ${JSON.stringify(got)}` : `读者读到一致值 ${JSON.stringify(got)}`,
      };
    }
    case 'parity': {
      // 写者 begin 应使 seq 变奇；缺陷使 seq 仍偶 → 读者无法感知“写入中”。
      const l = new SeqLock();
      const g = l.writeGen({ a: 1, b: 1 });
      g.next(); // begin
      const confirmed = (l.seq & 1) === 0;
      return {
        confirmed,
        expect: 'begin 后 seq 应为奇数',
        actual: confirmed ? `begin 后 seq=${l.seq}(偶数)` : `begin 后 seq=${l.seq}(奇数)`,
      };
    }
    case 'barrier': {
      // 写者先发布“完成”再写数据；读者在 seq 完成后读 → 读到陈旧数据。
      const l = new SeqLock();
      const v = { a: 33, b: 44 };
      const out = race([l.writeGen(v), l.readGen()], [0, 1, 0, 1, 0, 1]);
      const got = out[1];
      const confirmed = !(got && got.a === v.a && got.b === v.b);
      return {
        confirmed,
        expect: '读者在 seq 完成后应观察到新数据',
        actual: confirmed ? `读者读到陈旧值 ${JSON.stringify(got)}` : `读者读到一致值 ${JSON.stringify(got)}`,
      };
    }
    case 'retry': {
      // seq 为奇（写入中）时读者应自旋；缺陷直接返回无效值。
      const l = new SeqLock();
      l.seq = 1; // 模拟写入中
      const g = l.readGen();
      g.next(); // 命中奇数分支，yield
      const r = g.next(); // 执行 return null
      const confirmed = r.done && r.value === null;
      return {
        confirmed,
        expect: '写入中应自旋重试',
        actual: confirmed ? '读者直接返回 null' : `读者返回 ${JSON.stringify(r.value)}`,
      };
    }
    case 'starvation': {
      // seq 为奇（有写者竞争）时写者应重试；缺陷直接放弃。
      const l = new SeqLock();
      l.seq = 1;
      const g = l.writeGen({ a: 1, b: 1 });
      g.next(); // 命中竞争分支，yield
      const r = g.next(); // 执行 return false
      const confirmed = r.done && r.value === false;
      return {
        confirmed,
        expect: '竞争时应重试而非放弃',
        actual: confirmed ? '写者直接返回 false(放弃)' : `写者返回 ${JSON.stringify(r.value)}`,
      };
    }
    case 'overflow': {
      // 在 32 位回绕边界：begin 应使 seq 变奇；缺陷在边界处丢失奇偶翻转。
      const l = new SeqLock();
      l.seq = 0xFFFFFFFE;
      const g = l.writeGen({ a: 1, b: 1 });
      g.next(); // begin
      const confirmed = (l.seq & 1) === 0;
      return {
        confirmed,
        expect: '边界 begin 后 seq 应为奇数',
        actual: confirmed ? `边界 begin 后 seq=${l.seq}(偶数/回绕)` : `边界 begin 后 seq=${l.seq}(奇数)`,
      };
    }
    default:
      return { confirmed: false, expect: '已知缺陷', actual: '未知缺陷键' };
  }
}

// ---------------------------------------------------------------------------
// 评分：单个 finding（REVIEW 识别 + 行为佐证）。
// ---------------------------------------------------------------------------
function gradeFinding(defect, sections) {
  const body = sectionBody(defect, sections);
  if (body === null) {
    return { pass: false, expect: `找到「${defect.key}」小节`, actual: 'REVIEW.md 无对应小节标题' };
  }
  const text = body.trim();
  if (text.length < 4) {
    return { pass: false, expect: '小节有实质内容', actual: '小节为空' };
  }
  const hasKw = defect.body.some((k) => text.includes(k));
  if (!hasKw) {
    return { pass: false, expect: `含「${defect.body[0]}」等关键词`, actual: '未识别到该缺陷关键词' };
  }
  return { pass: true, expect: '已识别缺陷', actual: '已识别' };
}

function gradeFindingFull(defect, sections) {
  const t = gradeFinding(defect, sections);
  if (!t.pass) return t;
  let probe;
  try {
    probe = runProbe(defect.key);
  } catch (e) {
    return { pass: false, expect: '行为佐证通过', actual: `佐证异常: ${e.message}` };
  }
  if (!probe.confirmed) {
    return { pass: false, expect: probe.expect, actual: probe.actual };
  }
  return { pass: true, expect: '识别+佐证', actual: '已识别且行为可复现' };
}

function allFindingsPass(sections) {
  return DEFECTS.every((d) => gradeFindingFull(d, sections).pass);
}

// ---------------------------------------------------------------------------
// 正确性锚点
// ---------------------------------------------------------------------------
function gradeCorrect(sections) {
  if (!allFindingsPass(sections)) {
    return { pass: false, expect: '六处缺陷全部识别', actual: '仍有缺陷未识别' };
  }
  const allFix = DEFECTS.every((d) => {
    const b = sectionBody(d, sections);
    if (b === null) return false;
    return FIX.some((k) => b.includes(k));
  });
  if (!allFix) {
    return { pass: false, expect: '每节给出修复方向', actual: '存在未给修复的小节' };
  }
  return { pass: true, expect: '识别+修复', actual: '六处均识别并给出修复' };
}

function gradeMasking(sections, reviewText) {
  if (!allFindingsPass(sections)) {
    return { pass: false, expect: '六处缺陷全部识别', actual: '仍有缺陷未识别' };
  }
  const hasMask = MASK.some((k) => reviewText.includes(k));
  if (!hasMask) {
    return { pass: false, expect: '说明互相掩盖/单修不足', actual: '未提及缺陷间交互' };
  }
  return { pass: true, expect: '识别+交互', actual: '已说明掩盖关系' };
}

// ---------------------------------------------------------------------------
// 场景装配与执行
// ---------------------------------------------------------------------------
function buildScenarios(sections, reviewText) {
  const scenarios = [];
  for (const d of DEFECTS) {
    scenarios.push({
      id: `${d.key}/finding`,
      run: () => gradeFindingFull(d, sections),
    });
  }
  scenarios.push({ id: 'correct/anchor', run: () => gradeCorrect(sections) });
  scenarios.push({ id: 'masking/anchor', run: () => gradeMasking(sections, reviewText) });
  return scenarios;
}

function main() {
  const args = process.argv.slice(2);
  const reviewText = loadReview();
  const sections = parseSections(reviewText);
  const scenarios = buildScenarios(sections, reviewText);

  const listMode = args.includes('-list');
  const onlyIdx = args.indexOf('--only');
  const onlyArg = onlyIdx >= 0 ? args[onlyIdx + 1] : null;

  if (listMode) {
    for (const s of scenarios) process.stdout.write(s.id + '\n');
    process.exit(0);
  }

  const selected = onlyArg
    ? scenarios.filter((s) => s.id === onlyArg || s.id.split('/')[0] === onlyArg)
    : scenarios;

  let passed = 0;
  const lines = [];
  for (const s of selected) {
    let res;
    try {
      res = s.run();
    } catch (e) {
      res = { pass: false, expect: '场景可执行', actual: `异常: ${e.message}` };
    }
    if (res.pass) {
      passed++;
      lines.push(`PASS ${s.id}`);
    } else {
      lines.push(`FAIL ${s.id}  期望=${res.expect}  实际=${res.actual}`);
    }
  }

  for (const l of lines) process.stdout.write(l + '\n');
  process.stdout.write(`结果：通过 ${passed}/${scenarios.length}\n`);
  process.exit(passed === scenarios.length ? 0 : 1);
}

main();
