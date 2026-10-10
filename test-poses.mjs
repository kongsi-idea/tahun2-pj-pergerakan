// node test-poses.mjs —— 无依赖。每个动作：正确 / 错误 / 左右翻转仍正确。
import { classify, checkPosition, silhouetteBox, createPosSmoother, arrowDir, POS, TH, HINTS, ALL_HINTS, MOVES, TEMPLATES, createSmoother, FAR_HINT } from './js/poses.js';
import { readFileSync } from 'node:fs';

const IDX = { nose: 0, sl: 11, sr: 12, el: 13, er: 14, wl: 15, wr: 16, hl: 23, hr: 24, kl: 25, kr: 26, al: 27, ar: 28, ghl: 29, ghr: 30, gtl: 31, gtr: 32 };
function make(j, vis = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));
  for (const [k, [x, y]] of Object.entries(j)) lm[IDX[k]] = { x, y, z: 0, visibility: vis[k] ?? 0.99 };
  return lm;
}
function mirror(lm) { // 真正的镜像：x 翻转并交换左右
  const out = lm.map((p) => ({ ...p, x: 1 - p.x }));
  const sw = out.slice();
  for (let i = 11; i < 33; i += 2) { sw[i] = out[i + 1]; sw[i + 1] = out[i]; }
  return sw;
}
// 站直的基础姿势（T = 0.25）
const stand = { nose: [.5, .2], sl: [.45, .3], sr: [.55, .3], el: [.42, .42], er: [.58, .42], wl: [.41, .52], wr: [.59, .52],
  hl: [.46, .55], hr: [.54, .55], kl: [.46, .72], kr: [.54, .72], al: [.46, .9], ar: [.54, .9] };

const wide = { al: [.3, .9], ar: [.7, .9] };
const squat = { nose: [.5, .3], sl: [.45, .4], sr: [.55, .4], el: [.44, .47], er: [.56, .47], wl: [.45, .5], wr: [.55, .5], hl: [.46, .65], hr: [.54, .65], kl: [.36, .76], kr: [.64, .76], al: [.45, .9], ar: [.55, .9] };
const tipUp = { ...stand, wl: [.45, .02], wr: [.55, .02], el: [.45, .16], er: [.55, .16] };
const plankBase = { nose: [.1, .5], sl: [.2, .55], sr: [.22, .55], el: [.2, .7], er: [.22, .7], wl: [.2, .85], wr: [.22, .85] };
const cases = {
  plane: {
    good: { ...stand, wl: [.2, .3], wr: [.8, .3], el: [.33, .3], er: [.67, .3], ar: [.6, .7], kr: [.58, .66] },
    bad: { ...stand, wl: [.2, .3], wr: [.8, .3], el: [.33, .3], er: [.67, .3] },                       // 双脚着地
  },
  tree: {
    good: { ...stand, wl: [.49, .05], wr: [.51, .05], el: [.46, .15], er: [.54, .15], ar: [.6, .7], kr: [.58, .66] },
    bad: { ...stand, wl: [.35, .05], wr: [.65, .05], el: [.4, .15], er: [.6, .15], ar: [.6, .7], kr: [.58, .66] }, // 双手没有合在一起
  },
  windmill: {
    good: { ...stand, ...wide, wl: [.68, .88], wr: [.45, .08], el: [.55, .6], er: [.47, .18] },
    bad: { ...stand, ...wide },                                                                         // 双脚张开但手没去摸脚
  },
  sway: {
    good: { ...stand, sl: [.6, .3], sr: [.7, .3], nose: [.68, .22], wl: [.68, .05], wr: [.7, .05], el: [.64, .15], er: [.68, .15] },
    bad: { ...stand, sl: [.54, .3], sr: [.64, .3], nose: [.62, .22], wl: [.62, .05], wr: [.64, .05], el: [.58, .15], er: [.62, .15] }, // 只弯了 20°
  },
  rocket: {
    good: squat,
    bad: stand,                                                                                        // 站直，膝盖没弯
  },
  tiptoe: {
    good: { ...tipUp, ghl: [.46, .86], ghr: [.54, .86], gtl: [.46, .93], gtr: [.54, .93] },
    bad: { ...tipUp, ghl: [.46, .93], ghr: [.54, .93], gtl: [.46, .93], gtr: [.54, .93] },             // 脚跟踩地
  },
  plank: {
    good: { ...plankBase, hl: [.5, .6], hr: [.52, .6], kl: [.65, .625], kr: [.67, .625], al: [.8, .8], ar: [.82, .8] },
    bad: { ...plankBase, hl: [.5, .75], hr: [.52, .75], kl: [.65, .7], kr: [.67, .7], al: [.8, .8], ar: [.82, .8] }, // 屁股掉下来
  },
};

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? pass++ : fail++; console.log((cond ? '  PASS ' : '  FAIL ') + name); };

for (const a of MOVES) {
  const c = cases[a.id];
  const good = make(c.good), bad = make(c.bad);
  const rg = classify(a.id, good), rb = classify(a.id, bad);
  t(`${a.id} 正确姿势 ok (${rg.hint})`, rg.ok === true);
  t(`${a.id} 错误姿势 not ok (${rb.hint})`, rb.ok === false);
  t(`${a.id} 左右翻转仍 ok`, classify(a.id, mirror(good)).ok === true);
  t(`${a.id} 错误姿势翻转仍 not ok`, classify(a.id, mirror(bad)).ok === false);
  const hidden = make(c.good, { al: 0.1, ar: 0.1, kl: 0.1, kr: 0.1 });
  const rh = classify(a.id, hidden);
  t(`${a.id} 看不到腿 → 提示退后`, rh.ok === false && rh.hint === FAR_HINT);
  t(`${a.id} 有虚线模板`, !!TEMPLATES[a.id] && TEMPLATES[a.id].shapes.length > 0 && TEMPLATES[a.id].head.length === 3);
  t(`${a.id} holdMs 合理`, a.holdMs >= 1500 && a.holdMs <= 5000);
}
// 竖屏 aspect 参数：x 被缩放后判定仍应成立（正确姿势在 aspect=0.5625 下以 x 拉伸还原）
t('aspect 参数可用（tiptoe）', classify('tiptoe', make(cases.tiptoe.good), { aspect: 0.5625 }).ok === true);
const sm = createSmoother(5);
[true, true, false, true, false].forEach((v) => sm.push(v));
t('平滑：5 帧中 3 帧 true → true', sm.push(true) === true);
const sm2 = createSmoother(5); [false, false, false, true].forEach((v) => sm2.push(v));
t('平滑：多数 false → false', sm2.push(true) === false);

// ───── 站位检查 v3.2：站进屏幕上的人像就 OK ─────
const PW = 720, PH = 1280; // 手机直立
const shiftX = (j, dx) => Object.fromEntries(Object.entries(j).map(([k, [x, y]]) => [k, [x + dx, y]]));
const box = silhouetteBox(PW, PH), boxL = silhouetteBox(1280, 720);
t('人像框：竖放高 45%（=宽×0.8）', Math.abs((box.y1 - box.y0) - 0.45) < 1e-9 && Math.abs((box.x0 + box.x1) / 2 - 0.5) < 1e-9);
t('人像框：横放高 80%（上限）', Math.abs((boxL.y1 - boxL.y0) - 0.8) < 1e-9);
t('人像框：高度(px) ≤ 画面宽(px)×0.8', (box.y1 - box.y0) * PH <= PW * POS.LEN_RATIO + 1e-6 && (boxL.y1 - boxL.y0) * 720 <= 1280 * POS.LEN_RATIO + 1e-6);
// 人站在人像里（竖放：框 y .275–.725，宽 .6×… 中心 .5）
const inBox = { nose: [.5, .31], sl: [.45, .38], sr: [.55, .38], el: [.43, .46], er: [.57, .46], wl: [.42, .52], wr: [.58, .52], hl: [.46, .53], hr: [.54, .53], kl: [.46, .62], kr: [.54, .62], al: [.46, .70], ar: [.54, .70] };
let r = checkPosition(make(inBox), PW, PH);
t('站进人像 → OK', r.ok === true && r.kind === 'ok');
t('站进人像（镜像后）→ OK', checkPosition(mirror(make(inBox)), PW, PH).ok === true);
t('手举高、站在人像里也 OK（外框含手）', checkPosition(make({ ...inBox, wl: [.46, .29], wr: [.54, .29] }), PW, PH).ok === true);
r = checkPosition(make(shiftX(inBox, -.25)), PW, PH);
t('原始 x 偏小（学生偏自己右边）→ 往你的左边移', !r.ok && r.hint === HINTS.left && r.kind === 'left');
r = checkPosition(make(shiftX(inBox, .25)), PW, PH);
t('原始 x 偏大（学生偏自己左边）→ 往你的右边移', !r.ok && r.hint === HINTS.right && r.kind === 'right');
r = checkPosition(make({ ...inBox, nose: [.5, .12], al: [.46, .90], ar: [.54, .90] }), PW, PH);
t('比人像高很多（太近）→ 再退后一点', !r.ok && r.hint === HINTS.back && r.kind === 'back');
const tiny = { nose: [.5, .45], sl: [.48, .48], sr: [.52, .48], el: [.48, .5], er: [.52, .5], wl: [.48, .52], wr: [.52, .52], hl: [.49, .53], hr: [.51, .53], kl: [.49, .57], kr: [.51, .57], al: [.49, .6], ar: [.51, .6] };
r = checkPosition(make(tiny), PW, PH);
t('比人像小很多（太远）→ 再往前一点', !r.ok && r.hint === HINTS.closer && r.kind === 'closer');
t('没有关键点 → 站到人像里面', checkPosition(null, PW, PH).hint === HINTS.none && checkPosition([], PW, PH).ok === false);
t('只看到上半身（没有膝/踝）→ 不通过', checkPosition(make(inBox, { kl: .1, kr: .1, al: .1, ar: .1 }), PW, PH).ok === false);
t('只看到一边的踝也算（宽松）', checkPosition(make(inBox, { ar: .1, kr: .1 }), PW, PH).ok === true);
t('横放手机：同样站在画面中间（更宽松）→ OK', checkPosition(make({ ...inBox, nose: [.5, .20], al: [.46, .80], ar: [.54, .80], kl: [.46, .60], kr: [.54, .60], hl: [.46, .45], hr: [.54, .45], sl: [.45, .30], sr: [.55, .30], wl: [.42, .5], wr: [.58, .5], el: [.43, .4], er: [.57, .4] }), 1280, 720).ok === true);

// ───── 箭头 / 平滑 / POS.VIS / 勾 / hint 全可朗读 ─────
const toScreenX = (rawX) => 1 - rawX; // 画面是镜像显示
{
  const L = checkPosition(make(shiftX(inBox, -.25)), PW, PH), R = checkPosition(make(shiftX(inBox, .25)), PW, PH);
  t('箭头：hint=往你的左边移 → 箭头指向屏幕左边', L.hint === HINTS.left && arrowDir(L.kind) === 'left');
  t('箭头：hint=往你的右边移 → 箭头指向屏幕右边', R.hint === HINTS.right && arrowDir(R.kind) === 'right');
  const hipRaw = (j) => (j.hl[0] + j.hr[0]) / 2;
  t('箭头与镜像一致：原始偏小的人在屏幕上偏右，箭头 ← 把他指回', toScreenX(hipRaw(shiftX(inBox, -.25))) > .6 && arrowDir(L.kind) === 'left');
  t('箭头与镜像一致：原始偏大的人在屏幕上偏左，箭头 → 把他指回', toScreenX(hipRaw(shiftX(inBox, .25))) < .4 && arrowDir(R.kind) === 'right');
  t('其他问题没有箭头', arrowDir('back') === null && arrowDir('ok') === null);
}
{ // POS.VIS：关键点 visibility 0.35 → 站位检查仍算看得到，拍照判定（TH.VIS=0.4）则看不到
  const low = { nose: .35, wl: .35, wr: .35, al: .35, ar: .35, kl: .35, kr: .35 };
  t('POS.VIS 生效：0.35 站位 OK', checkPosition(make(inBox, low), PW, PH).ok === true);
  t('POS.VIS：0.2 站位不过', checkPosition(make(inBox, { nose: .2, al: .2, ar: .2, kl: .2, kr: .2 }), PW, PH).ok === false);
  t('TH.VIS=0.4：拍照判定腕 0.35 看不到（踮脚不过）', classify('tiptoe', make(cases.tiptoe.good, { wl: .35, wr: .35 })).ok === false);
  t('TH.VIS=0.4：腕 0.45 看得到（踮脚过）', classify('tiptoe', make(cases.tiptoe.good, { wl: .45, wr: .45 })).ok === true);
  t('常数值', POS.VIS === 0.3 && TH.VIS === 0.4);
}
{ // 8 帧平滑
  const sm = createPosSmoother(8);
  const good = checkPosition(make(inBox), PW, PH), left = checkPosition(make(shiftX(inBox, -.25)), PW, PH), right = checkPosition(make(shiftX(inBox, .25)), PW, PH);
  let out; for (let i = 0; i < 6; i++) out = sm.push(good);
  out = sm.push(left); out = sm.push(left);
  t('8 帧平滑：6 好 2 偏 → 仍 OK（不在边界来回跳）', out.ok === true && out.hint === HINTS.ok);
  sm.reset(); for (let i = 0; i < 5; i++) out = sm.push(left); for (let i = 0; i < 3; i++) out = sm.push(good);
  t('8 帧平滑：5 偏左 3 好 → 提示往左（多数）', out.ok === false && out.kind === 'left');
  sm.reset(); for (let i = 0; i < 4; i++) sm.push(left); for (let i = 0; i < 4; i++) out = sm.push(right);
  t('8 帧平滑：平手 → 以最新为准', out.kind === 'right');
  sm.reset(); for (let i = 0; i < 8; i++) out = sm.push(left);
  t('8 帧平滑：窗口只保留最近 8 帧', (() => { for (let i = 0; i < 8; i++) out = sm.push(good); return out.ok === true; })());
}
{ // 所有 hint 都在 ALL_HINTS（会被预录）
  const src = readFileSync(new URL('./js/poses.js', import.meta.url), 'utf8');
  const lits = [...src.matchAll(/FAIL\('([^']+)'\)/g)].map((m) => m[1]);
  t(`classify 源码里 ${lits.length} 个 hint 字面句子全在 ALL_HINTS`, lits.every((h) => ALL_HINTS.includes(h)));
  const seenHints = new Set();
  for (const a of MOVES) for (const k of ['good', 'bad']) seenHints.add(classify(a.id, make(cases[a.id][k])).hint);
  t('classify 实际出现的 hint 全在 ALL_HINTS', [...seenHints].every((h) => ALL_HINTS.includes(h)));
  const pos = [make(inBox), make(shiftX(inBox, -.25)), make(shiftX(inBox, .25)), make(tiny), null, make({ ...inBox, nose: [.5, .12], al: [.46, .90], ar: [.54, .90] })].map((l) => checkPosition(l, PW, PH));
  t('checkPosition 实际出现的 hint 全在 ALL_HINTS', pos.every((x) => ALL_HINTS.includes(x.hint)));
  t('ALL_HINTS 没有重复', new Set(ALL_HINTS).size === ALL_HINTS.length);
}

console.log(`\n${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
