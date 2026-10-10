// 蓝天操场：动作数据 + 姿势判定。纯函数，无 DOM 依赖，可直接在 node 跑测试。
// MediaPipe 坐标：x、y 为 0–1，y 向下。判定全部左右对称（任一边成立即可）。
// 所有距离用「身体尺度 T = 肩中点到髋中点的距离」归一化（扭腰摸脚用腿长 L，因为弯腰时 T 会被压短）；x 先乘画面宽高比，避免竖屏下 x/y 比例失真。

// ───── 阈值（集中在这里，真人实测要调就改这里）─────
export const TH = {
  VIS: 0.4,                 // visibility 低于它视为看不到（沿用一年级 v3.1 的实测结论）
  MIN_T: 0.03,              // 身体尺度太小（人太远／没抓到）
  LIFT_ANKLE_T: 0.35,       // 单脚站：两踝高度差大于
  PLANE_ARM_DY_T: 0.45,     // 飞机：手腕与肩膀的高度差小于（手臂平举）
  PLANE_ARM_OPEN_T: 0.8,    // 飞机：手腕离肩的水平距离大于
  TREE_HANDS_SW: 1.0,       // 大树：两腕距离 / 肩宽小于（双手合掌）
  TREE_WRIST_ABOVE_NOSE_T: 0.3,
  WIND_LEG_SPREAD_SW: 1.3,  // 风车：两踝距离 / 肩宽大于（双脚张开）
  WIND_TOUCH_L: 0.4,        // 风车：手腕到另一边脚踝的距离 / 腿长小于
  WIND_OTHER_UP_L: 0.25,    // 风车：另一只手腕高过肩膀 / 腿长
  SWAY_TILT_MIN_DEG: 22,    // 小草：比一年级小猫（12°）弯得更深
  SWAY_TILT_MAX_DEG: 70,
  HALF_RATIO_MIN: 0.95,     // 半蹲：髋到踝的垂直距离 / T 的范围（全蹲 < 1.2，站直约 1.6）
  HALF_RATIO_MAX: 1.45,
  HALF_KNEE_MIN_DEG: 60,
  HALF_KNEE_MAX_DEG: 135,
  TIP_ELBOW_DEG: 140,
  TIP_UPRIGHT_DEG: 15,
  TIP_HEEL_T: 0.08,         // 踮脚：脚尖比脚跟低多少（/T）。侦测不到脚跟时不查这一项
  PLANK_BODY_DEG: 150,      // 膝盖撑地：肩-髋-膝
  PLANK_TORSO_MAX_DEG: 35,
  PLANK_ELBOW_DEG: 150,
  PLANK_WRIST_DX_T: 0.5,
};

export const FAR_HINT = '再退后一点，让全身进框';

// 7 个动作。code = DSKP 学习标准（Tahun 2）。holdMs = 需稳住多久（平衡 5 秒，其余 3 秒）。
const RAW_MOVES = [
  { id: 'plane', zh: '飞机单脚站', ms: 'Imbangan pesawat', code: '1.7.1', holdMs: 5000, steps: ['双脚站好，双手向两边打开', '一只脚抬起来，往后伸', '双手像翅膀，站稳不要动'] },
  { id: 'tree', zh: '大树站', ms: 'Imbangan pokok', code: '1.7.1', holdMs: 5000, steps: ['站直，双手合掌', '一只脚抬起来，贴在另一只脚的膝盖旁', '双手举高，像大树，站稳不要动'] },
  { id: 'windmill', zh: '风车扭腰', ms: 'Pusing kincir angin', code: '1.3.1', holdMs: 3000, steps: ['双脚张开，比肩膀宽', '身体转过去弯下，一只手去摸另一边的脚', '另一只手往上伸直，像风车'] },
  { id: 'sway', zh: '小草随风', ms: 'Rumput ditiup angin', code: '3.3.1', holdMs: 3000, steps: ['站直，双手举高合在一起', '身体慢慢往旁边弯，弯深一点', '停住，像被风吹弯的小草'] },
  { id: 'rocket', zh: '火箭半蹲', ms: 'Separa cangkung', code: '3.4.1', holdMs: 3000, steps: ['双脚打开，和肩膀一样宽', '膝盖弯一半，屁股往后坐', '双手往前伸，像火箭准备发射'] },
  { id: 'tiptoe', zh: '踮脚摘云', ms: 'Jengkit kaki', code: '3.4.1', holdMs: 3000, steps: ['站直，双脚并拢', '脚跟抬起来，用脚尖站', '双手伸直举高，摘下一朵云'] },
  { id: 'plank', zh: '膝盖撑地', ms: 'Tekan tubi ubah suai', code: '3.4.1', holdMs: 3000, steps: ['双手和双膝撑在地上', '身体从肩膀到膝盖拉成一条直线', '手臂伸直，撑住不要动'] },
];
// 动作说明只写一份（steps）：教学页逐步显示、拍照画面和朗读用 desc（步骤连成一句）。
export const MOVES = RAW_MOVES.map((a) => ({ ...a, desc: a.steps.join('，') + '。' }));

// 动作轮廓模板（viewBox 360×480，3:4）：儿童安全标志式的人形，一笔连续的圆润外轮廓。
// head=[cx,cy,r]（头径约 0.9×肩宽，头是独立圆圈）；shapes=躯干多边形(poly，填满+圆角)与四肢粗线(line)，w=线宽。
// 渲染时用 SVG mask 把 shapes 的联集内部挖空，只留外缘一圈线（见 app.js renderTemplate）。
const L = (w, ...pts) => ({ t: 'line', w, pts });
const P = (w, ...pts) => ({ t: 'poly', w, pts });
export const TEMPLATES = {
  // 站位检查用的人像（大字形站姿，300×420）：不属于任何动作。
  pos: { head: [180, 70, 28], shapes: [
    P(26, [155, 115], [205, 115], [200, 245], [160, 245]),
    L(22, [155, 125], [90, 95], [30, 55]), L(22, [205, 125], [270, 95], [330, 55]),
    L(24, [165, 245], [120, 350], [75, 440]), L(24, [195, 245], [240, 350], [285, 440])] },
  plane: { head: [180, 95, 28], shapes: [
    P(26, [152, 140], [208, 140], [204, 265], [156, 265]),
    L(22, [152, 150], [95, 148], [30, 146]), L(22, [208, 150], [265, 148], [330, 146]),
    L(24, [162, 265], [160, 360], [160, 452]), L(24, [198, 265], [250, 300], [305, 325])] },
  tree: { head: [180, 100, 26], shapes: [
    P(26, [152, 150], [208, 150], [204, 272], [156, 272]),
    L(20, [150, 158], [118, 90], [178, 24]), L(20, [210, 158], [242, 90], [182, 24]),
    L(24, [162, 272], [160, 360], [160, 452]), L(24, [198, 272], [248, 325], [168, 352])] },
  windmill: { head: [268, 148, 26], shapes: [
    P(26, [165, 255], [200, 258], [250, 200], [218, 172]),
    L(22, [238, 205], [285, 320], [300, 415]), L(22, [205, 175], [180, 110], [150, 45]),
    L(24, [165, 262], [105, 355], [48, 450]), L(24, [195, 262], [255, 355], [318, 450])] },
  sway: { head: [262, 150, 26], shapes: [
    P(26, [222, 200], [272, 184], [200, 288], [162, 288]),
    L(20, [225, 195], [214, 120], [250, 62], [312, 42]), L(20, [278, 188], [312, 130], [320, 50]),
    L(24, [164, 288], [160, 370], [158, 452]), L(24, [196, 288], [200, 370], [202, 452])] },
  rocket: { head: [180, 175, 28], shapes: [
    P(26, [152, 222], [208, 222], [204, 318], [156, 318]),
    L(22, [152, 232], [100, 270], [110, 305]), L(22, [208, 232], [260, 270], [250, 305]),
    L(24, [160, 318], [110, 372], [130, 452]), L(24, [200, 318], [250, 372], [230, 452])] },
  tiptoe: { head: [180, 115, 26], shapes: [
    P(26, [152, 160], [208, 160], [204, 285], [156, 285]),
    L(22, [150, 170], [130, 100], [118, 30]), L(22, [210, 170], [230, 100], [242, 30]),
    L(24, [166, 285], [164, 370], [164, 440]), L(24, [194, 285], [196, 370], [196, 440])] },
  plank: { head: [48, 308, 26], shapes: [
    L(40, [88, 330], [270, 408]), L(20, [270, 408], [335, 432]), L(22, [88, 338], [88, 422])] },
};

// ───── 几何工具 ─────
const prep = (lm, aspect) => lm.map((p) => (p ? { x: p.x * aspect, y: p.y, v: p.visibility ?? 1 } : null));
const seen = (P, i) => !!P[i] && P[i].v >= TH.VIS;
function mid(P, i, j) {
  const a = seen(P, i), b = seen(P, j);
  if (a && b) return { x: (P[i].x + P[j].x) / 2, y: (P[i].y + P[j].y) / 2 };
  if (a) return P[i];
  if (b) return P[j];
  return null;
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function angle(a, b, c) { // 在 b 点的夹角（度）
  const v1 = { x: a.x - b.x, y: a.y - b.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
  const m = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (m === 0) return 180;
  return (Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / m))) * 180) / Math.PI;
}
const fromVertical = (top, bottom) => (Math.atan2(Math.abs(top.x - bottom.x), Math.abs(top.y - bottom.y)) * 180) / Math.PI;
const fromHorizontal = (a, b) => (Math.atan2(Math.abs(a.y - b.y), Math.abs(a.x - b.x)) * 180) / Math.PI;

const SIDES = [
  { sh: 11, el: 13, wr: 15, hip: 23, kn: 25, an: 27 },
  { sh: 12, el: 14, wr: 16, hip: 24, kn: 26, an: 28 },
];

const FAIL = (hint) => ({ ok: false, hint });
const PASS = { ok: true, hint: '对了！稳住不要动' };

/**
 * classify(id, landmarks, opts?) → { ok, hint }
 * opts.aspect = 视频宽/高（默认 1）。
 */
export function classify(id, landmarks, opts = {}) {
  if (!landmarks || landmarks.length < 29) return FAIL(FAR_HINT);
  const P = prep(landmarks, opts.aspect ?? 1);
  const sh = mid(P, 11, 12), hp = mid(P, 23, 24), kn = mid(P, 25, 26), an = mid(P, 27, 28);
  if (!seen(P, 0) || !sh || !hp || !kn || !an) return FAIL(FAR_HINT);
  const T = dist(sh, hp);
  if (T < TH.MIN_T) return FAIL(FAR_HINT);
  const nose = P[0];
  const sw = seen(P, 11) && seen(P, 12) ? dist(P[11], P[12]) : T * 0.8;
  const bothWrists = seen(P, 15) && seen(P, 16);
  const sides = SIDES.filter((s) => seen(P, s.sh) && seen(P, s.hip));

  switch (id) {
    case 'plane': {
      if (!seen(P, 27) || !seen(P, 28)) return FAIL(FAR_HINT);
      if (Math.abs(P[27].y - P[28].y) <= TH.LIFT_ANKLE_T * T) return FAIL('把一只脚抬高一点');
      if (!bothWrists || !seen(P, 11) || !seen(P, 12)) return FAIL('双手打开');
      if (!(Math.abs(P[15].y - P[11].y) < TH.PLANE_ARM_DY_T * T && Math.abs(P[16].y - P[12].y) < TH.PLANE_ARM_DY_T * T)) return FAIL('双手平举，像翅膀');
      if (!(Math.abs(P[15].x - P[11].x) > TH.PLANE_ARM_OPEN_T * T && Math.abs(P[16].x - P[12].x) > TH.PLANE_ARM_OPEN_T * T)) return FAIL('双手再打开一点');
      return PASS;
    }
    case 'tree': {
      if (!seen(P, 27) || !seen(P, 28)) return FAIL(FAR_HINT);
      if (Math.abs(P[27].y - P[28].y) <= TH.LIFT_ANKLE_T * T) return FAIL('把一只脚抬高一点');
      if (!bothWrists) return FAIL('双手要举到框里来');
      if (!(nose.y - P[15].y > TH.TREE_WRIST_ABOVE_NOSE_T * T && nose.y - P[16].y > TH.TREE_WRIST_ABOVE_NOSE_T * T)) return FAIL('双手举高过头');
      if (dist(P[15], P[16]) >= TH.TREE_HANDS_SW * sw) return FAIL('双手合在一起');
      return PASS;
    }
    case 'windmill': {
      if (!seen(P, 27) || !seen(P, 28)) return FAIL(FAR_HINT);
      const L = dist(hp, an);                                   // 腿长：弯腰时 T 会变短，所以用腿长当尺
      if (dist(P[27], P[28]) <= TH.WIND_LEG_SPREAD_SW * sw) return FAIL('双脚张开多一点');
      const pairs = [[15, 28, 16], [16, 27, 15]];                // [摸脚的手腕, 对边脚踝, 另一只手腕]
      const touch = pairs.find(([w, a]) => seen(P, w) && dist(P[w], P[a]) < TH.WIND_TOUCH_L * L);
      if (!touch) return FAIL('一只手去摸另一边的脚');
      const o = touch[2];
      if (!seen(P, o) || !(P[o].y < sh.y - TH.WIND_OTHER_UP_L * L)) return FAIL('另一只手往上伸直');
      return PASS;
    }
    case 'sway': {
      if (!bothWrists) return FAIL('双手要举到框里来');
      if (!(P[15].y < nose.y && P[16].y < nose.y)) return FAIL('双手举过头');
      const tilt = fromVertical(sh, hp);
      if (tilt <= TH.SWAY_TILT_MIN_DEG) return FAIL('身体再往旁边弯深一点');
      if (tilt >= TH.SWAY_TILT_MAX_DEG) return FAIL('弯一点点就好');
      return PASS;
    }
    case 'rocket': {
      const angs = SIDES.filter((s) => seen(P, s.hip) && seen(P, s.kn) && seen(P, s.an)).map((s) => angle(P[s.hip], P[s.kn], P[s.an]));
      if (!angs.length) return FAIL(FAR_HINT);
      const r = (an.y - hp.y) / T;
      if (r > TH.HALF_RATIO_MAX) return FAIL('膝盖再弯一点');
      if (r < TH.HALF_RATIO_MIN || Math.min(...angs) < TH.HALF_KNEE_MIN_DEG) return FAIL('不用蹲那么低，蹲一半就好');
      if (Math.min(...angs) > TH.HALF_KNEE_MAX_DEG) return FAIL('膝盖再弯一点');
      if (!bothWrists) return FAIL('双手要在框里');
      if (!(P[15].y > sh.y - 0.5 * T && P[16].y > sh.y - 0.5 * T)) return FAIL('双手往前伸，不要举太高');
      return PASS;
    }
    case 'tiptoe': {
      if (!bothWrists) return FAIL('双手要举到框里来');
      if (!(nose.y - P[15].y > TH.TREE_WRIST_ABOVE_NOSE_T * T && nose.y - P[16].y > TH.TREE_WRIST_ABOVE_NOSE_T * T)) return FAIL('双手再举高一点');
      const elbows = [[11, 13, 15], [12, 14, 16]].filter(([s, e]) => seen(P, s) && seen(P, e)).map(([s, e, w]) => angle(P[s], P[e], P[w]));
      if (elbows.length && Math.min(...elbows) <= TH.TIP_ELBOW_DEG) return FAIL('手臂伸直');
      if (fromVertical(sh, hp) >= TH.TIP_UPRIGHT_DEG) return FAIL('身体站直');
      // 脚跟离地：脚尖(31/32)的 y 比脚跟(29/30)大。看不到脚跟脚尖就不查这一项（待真机实测）。
      const feet = [[29, 31], [30, 32]].filter(([h, t]) => landmarks.length > t && seen(P, h) && seen(P, t));
      if (feet.length && !feet.some(([h, t]) => P[t].y - P[h].y > TH.TIP_HEEL_T * T)) return FAIL('脚跟抬高，用脚尖站');
      return PASS;
    }
    case 'plank': {
      if (fromHorizontal(sh, hp) >= TH.PLANK_TORSO_MAX_DEG) return FAIL('身体趴低，打直');
      const kns = SIDES.filter((s) => seen(P, s.kn));
      if (!kns.length || !kns.some((s) => angle(sh, hp, P[s.kn]) > TH.PLANK_BODY_DEG)) return FAIL('屁股不要翘起或掉下来');
      const armOk = sides.some((s) => seen(P, s.el) && seen(P, s.wr) && angle(P[s.sh], P[s.el], P[s.wr]) > TH.PLANK_ELBOW_DEG
        && Math.abs(P[s.wr].x - sh.x) < TH.PLANK_WRIST_DX_T * T && P[s.wr].y > sh.y);
      if (!armOk) return FAIL('双手撑在肩膀下面，手臂伸直');
      return PASS;
    }
    default:
      return FAIL('');
  }
}

/** 最近 n 帧多数决，避免抖动。push(ok) → 平滑后的 ok。 */
export function createSmoother(n = 5) {
  const buf = [];
  return {
    push(ok) { buf.push(!!ok); if (buf.length > n) buf.shift(); return buf.filter(Boolean).length * 2 > buf.length; },
    reset() { buf.length = 0; },
  };
}

// ───── 站位检查 v3.2：屏幕上放一个人像，学生站进去就 OK（不再分多步、不再查一堆条件）─────
// 人像大小是照「所有动作都放得下」算好的：高度 ≤ 画面宽度×0.8（趴下时身体横过来的长度），竖放手机约占画面高 45%，横放约 80%。
// 坐标是 MediaPipe 原始画面（未镜像）。画面给学生看时是镜像的，所以：
//   原始 x 偏小（原始画面左侧）＝ 学生自己的「右手边」；原始 x 偏大＝学生自己的「左手边」。
//   人在人像的原始左侧（minX/中心偏小）→ 学生站得太靠自己的右边 → 要「往你的左边移」（kind 'left'）；偏大 → 「往你的右边移」。
// 箭头方向：镜像画面上，学生自己的左边 = 屏幕的左边，所以「往你的左边移」箭头指向屏幕左边「←」；「往你的右边移」＝「→」。
//   一致性：原始 x 偏小的人，在镜像屏幕上出现在偏右，箭头 ← 正好把他指回人像。
export const POS = {
  VIS: 0.3,                 // 站位检查对关键点用较低门槛（远处 visibility 常偏低）
  LEN_RATIO: 0.8,           // 人像高度（像素）≤ 画面宽度（像素）× 0.8
  MAX_H_FRAC: 0.8,          // 人像高度不超过画面高度的 80%
  ASPECT: 300 / 420,        // 人像（海星大字形）宽高比
  MARGIN: 0.06,             // 站位容许超出人像的宽容度（占画面比例）
  MIN_FILL: 0.5,            // 学生身体高度至少是人像高度的一半（太小＝离太远）
  CENTER_TOL: 0.12,
  SMOOTH_FRAMES: 8,
};
export const POS_HOLD_MS = 1000;
export const HINTS = {
  left: '往你的左边移一点', right: '往你的右边移一点', back: '再退后一点',
  closer: '再往前一点，站进人像里', none: '站到人像里面，让全身都在框里',
  ok: '位置刚刚好，稳住', slipper: '回到拖鞋记号的位置', shootOk: '对了！稳住不要动',
};
/** 学生看屏幕（镜像）时箭头指向哪边。只有 left / right 两种 hint 有箭头。 */
export function arrowDir(kind) { return kind === 'left' ? 'left' : kind === 'right' ? 'right' : null; }

/** 人像的位置（原始视频的 0–1 坐标）：画面正中，大小按上面的规则算。 */
export function silhouetteBox(videoW = 1, videoH = 1) {
  const hf = Math.min(POS.MAX_H_FRAC, (POS.LEN_RATIO * videoW) / videoH);
  const wf = (POS.ASPECT * hf * videoH) / videoW;
  return { x0: 0.5 - wf / 2, x1: 0.5 + wf / 2, y0: 0.5 - hf / 2, y1: 0.5 + hf / 2 };
}

const NONE = (box) => ({ ok: false, hint: HINTS.none, kind: 'closer', checks: { body: false, center: false, far: false }, diag: { box, bbox: null } });
const BODY_PTS = [0, 11, 12, 15, 16, 23, 24, 25, 26, 27, 28];

/** checkPosition(landmarks, videoW, videoH) → {ok, hint, kind, checks:{body,center,far}, diag}。
 *  通过条件（刻意宽松）：看得到鼻子和髋、至少一个膝或踝；所有看得到的点围成的外框，落在人像（加宽容度）里，且身高至少是人像的一半。 */
export function checkPosition(lm, videoW = 1, videoH = 1) {
  const box = silhouetteBox(videoW, videoH);
  if (!lm || lm.length < 29) return NONE(box);
  const v = (i) => (lm[i] ? lm[i].visibility ?? 1 : 0), sv = (i) => v(i) >= POS.VIS;
  const pts = BODY_PTS.filter(sv).map((i) => lm[i]);
  const hasLow = sv(25) || sv(26) || sv(27) || sv(28);
  if (!sv(0) || !(sv(23) || sv(24)) || !hasLow || pts.length < 4) return NONE(box);
  const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
  const bbox = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  const bh = bbox.maxY - bbox.minY, boxH = box.y1 - box.y0, cx = (bbox.minX + bbox.maxX) / 2, bcx = (box.x0 + box.x1) / 2, m = POS.MARGIN;
  const tooTall = bbox.minY < box.y0 - m || bbox.maxY > box.y1 + m;
  const tooSmall = bh < POS.MIN_FILL * boxH;
  const outL = bbox.minX < box.x0 - m, outR = bbox.maxX > box.x1 + m;
  const offL = cx < bcx - POS.CENTER_TOL, offR = cx > bcx + POS.CENTER_TOL;
  const flags = { tooTall, tooSmall, outL, outR, offL, offR, fill: bh / boxH };
  const checks = { body: !tooTall, center: !(outL || outR || offL || offR), far: !tooTall && !tooSmall };
  const out = (ok, kind, hint) => ({ ok, kind, hint, checks, diag: { box, bbox, flags, vis: { nose: v(0), shL: v(11), shR: v(12), wrL: v(15), wrR: v(16), hipL: v(23), hipR: v(24), anL: v(27), anR: v(28) } } });
  if (tooTall) return out(false, 'back', HINTS.back);
  if (tooSmall) return out(false, 'closer', HINTS.closer);
  if (outL || offL) return out(false, 'left', HINTS.left);     // 原始左侧偏出 = 学生自己的右边偏出 → 往自己的左边移
  if (outR || offR) return out(false, 'right', HINTS.right);
  return out(true, 'ok', HINTS.ok);
}

/** 站位结果的最近 n 帧平滑：ok 取多数；没过时取出现最多的问题（平手以最新为准）；三个勾各自取多数。 */
export function createPosSmoother(n = POS.SMOOTH_FRAMES) {
  const buf = [];
  return {
    push(r) {
      buf.push(r); if (buf.length > n) buf.shift();
      const okCount = buf.filter((x) => x.ok).length;
      const last = buf[buf.length - 1];
      let base, ok;
      if (okCount * 2 > buf.length) { ok = true; base = [...buf].reverse().find((x) => x.ok); } else {
        ok = false;
        const cnt = {}; for (const x of buf) if (!x.ok) cnt[x.kind] = (cnt[x.kind] || 0) + 1;
        let best = null; for (const k of Object.keys(cnt)) if (best === null || cnt[k] > cnt[best] || (cnt[k] === cnt[best] && k === last.kind)) best = k;
        base = [...buf].reverse().find((x) => !x.ok && x.kind === best);
      }
      const maj = (key) => buf.filter((x) => x.checks[key]).length * 2 > buf.length;
      return { ...base, ok, checks: { body: maj('body'), center: maj('center'), far: maj('far') }, diag: last.diag };
    },
    reset() { buf.length = 0; },
  };
}

// 所有会被念出来的 hint（classify 的字面句子 + 站位句子）：gen-voice.py 全部预录；test-poses.mjs 会扫源码确认没有漏的。
export const ALL_HINTS = [
  FAR_HINT, '把一只脚抬高一点', '双手打开', '双手平举，像翅膀', '双手再打开一点', '双手要举到框里来', '双手举高过头', '双手合在一起',
  '双脚张开多一点', '一只手去摸另一边的脚', '另一只手往上伸直', '双手举过头', '身体再往旁边弯深一点', '弯一点点就好',
  '膝盖再弯一点', '不用蹲那么低，蹲一半就好', '双手要在框里', '双手往前伸，不要举太高', '双手再举高一点', '手臂伸直', '身体站直', '脚跟抬高，用脚尖站',
  '身体趴低，打直', '屁股不要翘起或掉下来', '双手撑在肩膀下面，手臂伸直',
  HINTS.left, HINTS.right, HINTS.back, HINTS.closer, HINTS.none, HINTS.ok, HINTS.slipper, HINTS.shootOk,
];
