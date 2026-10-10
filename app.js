// 蓝天操场 v1 · 水彩晴空 · Pendidikan Jasmani Tahun 2
// 隐私：摄像头画面只在本机处理——video 只挂在本地 <video>，姿态推理在浏览器内跑，
// 拍好的照片只存在这个分页的内存里；整个程序没有任何 fetch/上传影像的动作。
import { MOVES, TEMPLATES, classify, checkPosition, silhouetteBox, createPosSmoother, arrowDir, HINTS, POS, POS_HOLD_MS, createSmoother, FAR_HINT } from './js/poses.js';
import { Voice, SAY, allVoiceLines } from './js/voice.js';

const $ = (s) => document.querySelector(s);
const byId = (id) => MOVES.find((a) => a.id === id);
const PHOTO_W = 810, PHOTO_H = 1080;
const STAMP_H = 200;                         // 照片底部名牌条高度
const FLOOR_POSES = new Set(['plank']); // 人在画面下方的动作
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
// 侦测到的骨架 → 人的范围中心（0–1，原始镜头座标）；没有或太旧就回 null
function personBox(lm, fresh) {
  if (!lm || !fresh) return null;
  const pts = lm.filter((p) => p && (p.visibility ?? 1) > 0.3);
  if (pts.length < 6) return null;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2 };
}       // 3:4
const COUNTDOWN_S = 10;
const SLOW_FPS = 5, SLOW_WINDOW_MS = 4000;  // 连续 4 秒 fps < 5 → 改倒数拍
const F_KAI = "'LXGW WenKai Screen','Kaiti SC','STKaiti',serif";
const F_SANS = "'Noto Sans SC','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";
const F_MS = "'Fraunces',Georgia,serif";
const C = { navy: '#123E73', blue: '#1F5FAE', grass: '#4FA84A', sun: '#FFC83D', sunDeep: '#B98200', track: '#E4572E', cloud: '#F7FBFF', ink: '#14304D' };
const DEBUG = new URLSearchParams(location.search).get('debug') === '1'; // ?debug=1：诊断面板（正式模式不显示）
const IMGMAP = window.IMG || {};          // 由 build-img.py 生成的 img/manifest.js：只列出真的存在的图

/* ───── 状态 ───── */
const S = { name: '', cls: '', photos: {} /* id → {url, mode} */, cur: null, animated: false, posOk: false, posFrom: 'welcome', tutFrom: 'welcome', tutI: 0, tutSeen: new Set() };
const store = {
  get(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 无痕模式等，忽略 */ } },
};

/* ───── 云朵（图缺失时的后备，永远不退回 emoji）───── */
const CLOUD_D = 'M22 54 C6 54 2 36 18 32 C16 14 38 6 48 20 C58 6 84 14 80 34 C98 34 98 54 80 54 Z'; // 100×60，底边平
const CLOUD_ICON = '<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M22 74 C6 74 2 56 18 52 C16 34 38 26 48 40 C58 26 84 34 80 54 C98 54 98 74 80 74 Z" fill="#FFFFFF" stroke="#9CC8EE" stroke-width="3"/></svg>';
window.__fb = (img) => { const d = document.createElement('span'); d.className = 'lf'; d.innerHTML = CLOUD_ICON; d.style.display = 'contents'; img.replaceWith(d); };
function art(name, alt = '') {
  const src = IMGMAP[name];
  return src ? `<img src="${src}" alt="${alt}" onerror="window.__fb(this)">` : CLOUD_ICON;
}
const ICON_CHECK = '<svg viewBox="0 0 60 60" aria-hidden="true"><circle cx="30" cy="30" r="27" fill="#E4572E" stroke="#F7FBFF" stroke-width="3"/><path d="M17 31l9 9 17-20" fill="none" stroke="#F7FBFF" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/* ───── 小工具 ───── */
function fmtDate(d = new Date()) { const p = (n) => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`; }
function ymd(d = new Date()) { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`; }
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2600); }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function show(name) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== `s-${name}`;
  if (name !== 'done') clearFalling();
}

/* ───── 背景：晴空 + 飘动的云 + 底部草坡（CSS 在 #bg 上做渐层与阳光）───── */
function buildBg() {
  const land = innerWidth > innerHeight;
  const W = land ? 200 : 100, H = land ? 100 : 200;
  const clouds = land
    ? [[14, 10, .8, .5], [118, 6, 1, .45], [66, 38, .55, .35], [166, 34, .65, .4]]
    : [[4, 16, .8, .5], [58, 8, .7, .45], [20, 74, .55, .35], [62, 108, .7, .4]];
  const cl = clouds.map(([x, y, sc, o], i) => `<g class="drift" style="animation-duration:${34 + i * 7}s;animation-delay:${-i * 5}s"><path d="${CLOUD_D}" transform="translate(${x} ${y}) scale(${sc})" fill="#fff" opacity="${o}"/></g>`).join('');
  const hill = (y, amp, c) => `<path d="M0 ${H - y} C ${W * .22} ${H - y - amp}, ${W * .45} ${H - y + amp * .4}, ${W * .7} ${H - y - amp * .6} S ${W * .95} ${H - y}, ${W} ${H - y - amp * .3} V${H} H0Z" fill="${c}"/>`;
  $('#bg').innerHTML = `<svg class="sky" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">${cl}${hill(land ? 14 : 22, land ? 5 : 8, '#5DB04F')}${hill(land ? 8 : 12, land ? 4 : 6, '#3E9A44')}</svg>`;
  buildBg.land = land;
}
window.addEventListener('resize', () => { if ((innerWidth > innerHeight) !== buildBg.land) buildBg(); });
// 小朋友从草坡后面探出来（首页后备图 & 完成画面共用）
function peekHTML(withBob) {
  const pals = MOVES.map((a, i) => `<div class="pal${withBob ? ' bob' : ''}" style="--i:${i}">${art(a.id)}</div>`).join('');
  const fore = `<svg class="fore" viewBox="0 0 400 100" preserveAspectRatio="none" aria-hidden="true"><path d="M-10 100V52C40 22 90 30 130 56C170 28 230 24 270 52C310 26 360 30 410 50V100Z" fill="#3E9A44"/><path d="M-10 100V74C50 54 100 60 150 80C200 58 260 58 310 78C350 62 380 62 410 72V100Z" fill="#5DB04F"/></svg>`;
  return { pals: `<div class="pals">${pals}</div>`, fore };
}
let fallTimer = [];
function clearFalling() { document.querySelectorAll('.fall').forEach((e) => e.remove()); }
function spawnFalling() {
  clearFalling();
  const cols = ['#FFC83D', '#E4572E', '#4FA84A', '#FFFFFF', '#5AA6EA'];
  const STAR = 'M10 1l2.6 5.6 6.1.7-4.5 4.2 1.2 6L10 14.4 4.6 17.5l1.2-6L1.3 7.3l6.1-.7z';
  for (let i = 0; i < 16; i++) {
    const e = document.createElement('i'); e.className = 'fall';
    const c = cols[i % cols.length];
    e.style.cssText = `left:${(i * 6.4 + (i % 3) * 2).toFixed(1)}%;animation-delay:${(-(i * 0.9) % 7).toFixed(1)}s;animation-duration:${(6 + (i % 5)).toFixed(1)}s;width:${22 + (i % 4) * 7}px;height:${22 + (i % 4) * 7}px`;
    e.innerHTML = i % 4 === 3 ? `<svg viewBox="0 0 100 60"><path d="${CLOUD_D}" fill="#fff" opacity=".9"/></svg>` : i % 2 ? `<svg viewBox="0 0 20 20"><path d="${STAR}" fill="${c}"/></svg>` : `<svg viewBox="0 0 20 20"><rect x="7" y="1" width="6" height="18" rx="3" fill="${c}"/></svg>`;
    $('#s-done').appendChild(e);
  }
}

/* ───── 音效（WebAudio 合成）───── */
const Sound = {
  ctx: null,
  c() { try { this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)(); if (this.ctx.state === 'suspended') this.ctx.resume(); } catch { /* 无声也能玩 */ } return this.ctx; },
  tone(f, d, { type = 'triangle', vol = 0.15, delay = 0 } = {}) {
    const c = this.c(); if (!c) return;
    const t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = f; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + d + 0.02);
  },
  click() { // 咔嚓
    const c = this.c(); if (!c) return;
    for (const [delay, dur] of [[0, 0.05], [0.09, 0.08]]) {
      const n = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
      const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      f.type = 'bandpass'; f.frequency.value = 2800; g.gain.value = 0.5;
      s.buffer = buf; s.connect(f); f.connect(g); g.connect(c.destination); s.start(c.currentTime + delay);
    }
  },
  good() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, { vol: 0.12, delay: 0.2 + i * 0.085 })); },
  tick() { this.tone(880, 0.08, { type: 'sine', vol: 0.1 }); },
};

/* ───── 图与字体预载（画布要用）───── */
const ART = {};
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
async function preloadArt() { await Promise.allSettled(Object.entries(IMGMAP).map(async ([k, v]) => { ART[k] = await loadImg(v); })); }
async function ensureFonts() {
  const zh = MOVES.map((a) => a.zh).join('') + '蓝天操场完成未倒数拍做得好' + S.name + S.cls;
  const jobs = [document.fonts.load("400 40px 'LXGW WenKai Screen'", zh), document.fonts.load("italic 500 24px Fraunces", MOVES.map((a) => a.ms).join('')), document.fonts.load("800 30px 'Noto Sans SC'", zh)];
  try { await Promise.race([Promise.allSettled(jobs), wait(4000)]); } catch { /* 用系统字 */ }
}

/* ═════════ 1 欢迎页 ═════════ */
const TIPS = [['tip-clear', '清空身边的东西'], ['tip-clothes', '穿运动服或轻便衣服'], ['tip-adult', '请大人在旁边'], ['tip-window', '烟霾天关好窗，在屋里做']];
function buildWelcome() {
  $('#safety').innerHTML = TIPS.map(([k, t]) => `<li><span class="tip-art">${art(k)}</span>${t}</li>`).join('');
  if (IMGMAP.hero) $('#hero-art').innerHTML = `<img src="${IMGMAP.hero}" alt="蓝天下做动作的小朋友" onerror="this.remove()">`;
  else { // 后备：云朵 + 7 位小朋友从草坡后探出头
    const { pals, fore } = peekHTML(false);
    $('#hero-art').innerHTML = `<svg class="bgl" viewBox="0 0 100 150" preserveAspectRatio="xMidYMid slice"><path d="${CLOUD_D}" transform="translate(6 40) scale(.5)" fill="#fff" opacity=".9"/><path d="${CLOUD_D}" transform="translate(58 62) scale(.4)" fill="#fff" opacity=".8"/></svg>${pals}${fore}`;
  }
  $('#in-name').value = store.get('pj-name');
  $('#in-class').value = store.get('pj-class');
}
$('#btn-start').addEventListener('click', () => {
  const name = $('#in-name').value.trim();
  if (!name) {
    $('#name-err').hidden = false;
    const el = $('#in-name'); el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); el.focus({ preventScroll: true });
    return;
  }
  S.name = name; S.cls = $('#in-class').value.trim();
  store.set('pj-name', S.name); store.set('pj-class', S.cls);
  $('#name-err').hidden = true;
  Voice.stop(); openTutorial('welcome');
});
$('#in-name').addEventListener('input', () => { $('#name-err').hidden = true; });

/* ═════════ 1b 动作教学 ═════════ */
const SPEAKER = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M3 9v6h4l5 4V5L7 9H3z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
function openTutorial(from, last = false) {
  S.tutFrom = from; S.tutI = last ? MOVES.length - 1 : 0; S.tutSeen = new Set();
  show('tutorial'); renderTutorial(0);
}
function renderTutorial(dir) {
  const a = MOVES[S.tutI]; S.tutSeen.add(S.tutI);
  const el = $('#tcard');
  el.className = `tcard tag-card${dir < 0 ? ' back' : ''}`; void el.offsetWidth;
  el.innerHTML = `<button class="btn round tspeak" id="tut-speak" aria-label="再听一次">${SPEAKER}</button>`
    + `<div class="timg">${art(a.id)}</div><div class="tname">${a.zh}</div><div class="tms">${a.ms}</div>`
    + `<ol class="tsteps">${a.steps.map((t) => `<li>${t}</li>`).join('')}</ol><div class="thold">要撑 ${a.holdMs / 1000} 秒</div>`;
  $('#tut-speak').addEventListener('click', () => Voice.say(SAY.teach(a)));
  $('#tut-dots').innerHTML = MOVES.map((_, i) => `<i class="${i === S.tutI ? 'on' : S.tutSeen.has(i) ? 'seen' : ''}"></i>`).join('');
  const last = S.tutI === MOVES.length - 1;
  $('#tut-prev').style.visibility = S.tutI === 0 ? 'hidden' : '';
  $('#tut-next').textContent = last ? (S.tutFrom === 'list' ? '我都看懂了' : '我都看懂了，检查位置') : '下一个 ›';
  Voice.say(SAY.teach(a));
}
function tutorialGo(d) {
  const n = S.tutI + d;
  if (n < 0) return;
  if (n >= MOVES.length) return tutorialDone();
  S.tutI = n; renderTutorial(d);
}
function tutorialDone() {
  Voice.stop();
  if (S.tutFrom === 'list') { renderList(); show('list'); } else enterPosition('welcome');
}
$('#tut-next').addEventListener('click', () => tutorialGo(1));
$('#tut-prev').addEventListener('click', () => tutorialGo(-1));
$('#tut-skip').addEventListener('click', tutorialDone);
{ // 左右滑动换页
  let x0 = null;
  const card = $('#s-tutorial');
  card.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  card.addEventListener('pointerup', (e) => { if (x0 === null) return; const dx = e.clientX - x0; x0 = null; if (Math.abs(dx) > 60) tutorialGo(dx < 0 ? 1 : -1); });
  card.addEventListener('pointercancel', () => { x0 = null; });
}

/* ═════════ 2 动作列表（错落的小卡片）═════════ */
const TILT = [-1.6, 1.2, 1.8, -1.2, -0.8, 1.6, -1.8];
function renderList(popId, redoHint = false) {
  const wrap = $('#cards'); wrap.innerHTML = '';
  MOVES.forEach((a, i) => {
    const done = S.photos[a.id];
    const b = document.createElement('button');
    b.className = 'acard'; b.type = 'button'; b.dataset.id = a.id;
    b.style.setProperty('--i', i); b.style.setProperty('--r', `${TILT[i]}deg`);
    if (S.animated) b.style.animation = 'none';
    b.setAttribute('aria-label', `${a.zh} ${a.ms}${done ? '，已完成，点一下可以重拍' : ''}`);
    b.innerHTML = `<span class="aimg">${art(a.id)}</span><span class="azh">${a.zh}</span><span class="ams">${a.ms}</span>`
      + (done ? `<img class="athumb" src="${done.url}" alt=""><span class="stamp${popId === a.id ? ' pop' : ''}">${ICON_CHECK}</span><span class="again">点一下重拍</span>` : '');
    b.addEventListener('click', () => enterCam(a.id));
    wrap.appendChild(b);
  });
  S.animated = true;
  const n = Object.keys(S.photos).length;
  $('#list-progress').textContent = `已完成 ${n} / ${MOVES.length}`;
  $('#list-hint').hidden = !redoHint;
  $('#btn-make').disabled = n < 1;
}
$('#btn-tut').addEventListener('click', () => openTutorial('list'));
$('#btn-pos').addEventListener('click', () => enterPosition('list'));
$('#btn-make').addEventListener('click', () => { buildCard(); show('card'); });

/* ═════════ 3 拍照画面 ═════════ */
const cam = {
  view: 'shoot', posStep: 1, posSm: createPosSmoother(),
  stream: null, lastStream: null, raf: 0, token: 0, mode: 'pose', /* pose | timer */
  landmarker: null, smoother: createSmoother(5), progress: 0, lastT: 0,
  capturing: false, countTimer: 0, frames: [], slowSince: 0, lastVideoTime: -1, started: 0, firstEntry: true,
};
let landmarkerPromise = null;

function isInAppBrowser() { return /FBAN|FBAV|FB_IAB|FBIOS|Instagram|Telegram|WhatsApp|Line\/|MicroMessenger|Messenger/i.test(navigator.userAgent); }

async function loadLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const { FilesetResolver, PoseLandmarker } = await import('./vendor/vision_bundle.mjs');
      const fileset = await FilesetResolver.forVisionTasks('./mediapipe');
      const mk = (delegate) => PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: './models/pose_landmarker_lite.task', delegate },
        runningMode: 'VIDEO', numPoses: 1,
        minPoseDetectionConfidence: 0.4, minPosePresenceConfidence: 0.4, minTrackingConfidence: 0.4,
      });
      if (window.__forceCPU) return mk('CPU'); // 测试用：无头浏览器的 GPU（SwiftShader）会偶发卡死
      try { return await mk('GPU'); } catch { return await mk('CPU'); }
    })();
    landmarkerPromise.catch(() => { landmarkerPromise = null; }); // 下次进来可再试
  }
  return landmarkerPromise;
}

// 儿童安全标志式人形轮廓：把躯干／四肢（粗圆笔画）联集的内部用 mask 挖空，只留外缘一圈线；头是独立圆圈。
function renderTemplate(id, place = null) {
  // place：站位检查用，把人像放进「视频坐标」里的人像框（svg 的 viewBox 换成视频像素，和 object-fit:cover 的视频完全对齐）
  const t = TEMPLATES[id], svg = $('#tpl'), B = place ? 11 : 7; // B = 白色轮廓线宽
  const shape = (s, color, grow, fillOn) => {
    const pts = s.pts.map((q) => q.join(',')).join(' ');
    const common = `stroke="${color}" stroke-width="${s.w + 2 * grow}" stroke-linecap="round" stroke-linejoin="round"`;
    return s.t === 'poly' ? `<polygon points="${pts}" fill="${fillOn ? color : 'none'}" ${common}/>` : `<polyline points="${pts}" fill="none" ${common}/>`;
  };
  const [hx, hy, hr] = t.head;
  const hole = t.shapes.map((s) => shape(s, '#000', 0, true)).join('') + `<circle cx="${hx}" cy="${hy}" r="${hr + 10}" fill="#000"/>`;
  const ring = (cls, grow) => `<g class="${cls}" mask="url(#tm)">${t.shapes.map((s) => shape(s, 'currentColor', grow, true)).join('')}</g>`;
  let inner = `<defs><mask id="tm" maskUnits="userSpaceOnUse" x="-100" y="-100" width="560" height="680"><rect x="-100" y="-100" width="560" height="680" fill="#fff"/>${hole}</mask></defs>`
    + ring('sh', B + 7) + ring('ln', B)
    + `<circle class="hd-sh" cx="${hx}" cy="${hy}" r="${hr}"/><circle class="hd" cx="${hx}" cy="${hy}" r="${hr}"/>`;
  if (place) {
    const { vw, vh, box } = place, bh = (box.y1 - box.y0) * vh, k = bh / 420; // 模板里人像占 x30–330、y30–450（300×420）
    svg.setAttribute('viewBox', `0 0 ${vw} ${vh}`); svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    place.ground = true;
    // 地平线：人像的脚踩在这条线上。学生要转动手机角度，让这条线对齐真实的地板（脚会站的地方）
    const gy = box.y1 * vh, lf = Math.round(vh * 0.03), fs = place.fs || lf;
    const ground = `<g class="ground"><rect x="0" y="${gy}" width="${vw}" height="${vh - gy}" fill="rgba(244,182,63,.2)"/><line x1="0" y1="${gy}" x2="${vw}" y2="${gy}" stroke="rgba(8,22,14,.6)" stroke-width="${lf * 0.5}"/><line x1="0" y1="${gy}" x2="${vw}" y2="${gy}" stroke="#F4B63F" stroke-width="${lf * 0.28}" stroke-dasharray="${lf} ${lf * 0.6}"/><text x="${vw / 2}" y="${gy + fs * 1.5}" text-anchor="middle" font-size="${fs}" font-weight="800" fill="#fff" stroke="rgba(8,22,14,.8)" stroke-width="${fs * 0.22}" paint-order="stroke" font-family="'Noto Sans SC',sans-serif">地板（地平线）</text></g>`;
    inner = `<g transform="translate(${(box.x0 * vw - 30 * k).toFixed(1)} ${(box.y0 * vh - 30 * k).toFixed(1)}) scale(${k.toFixed(4)})">${inner}</g>` + ground;
  } else { svg.setAttribute('viewBox', '0 0 360 480'); svg.setAttribute('preserveAspectRatio', 'xMidYMid meet'); }
  svg.innerHTML = inner;
  svg.classList.remove('ok');
}

function setRing(p) { $('#ring-fg').style.strokeDashoffset = String(100 - Math.max(0, Math.min(1, p)) * 100); }
// 画面上的提示药丸只放短句（单行小字）；完整句子由语音念。
const SHORT_HINT = { [HINTS.none]: '站进人像里', [HINTS.closer]: '再往前一点', [FAR_HINT]: '再退后一点', [HINTS.shootOk]: '对了！稳住' };
function setHint(text, good = false, sub = '') {
  const h = $('#cam-hint');
  if (!text) { h.hidden = true; return; }
  h.hidden = false; h.textContent = SHORT_HINT[text] || text; h.classList.toggle('good', good);
  if (sub && matchMedia('(min-width: 701px)').matches) { const s = document.createElement('small'); s.textContent = sub; h.appendChild(s); }
}

async function enterCam(id) {
  S.cur = id;
  const a = byId(id);
  $('#cam-ico').innerHTML = art(a.id); $('#ring-ico').innerHTML = art(a.id);
  ensureFonts(); preloadArt();
  $('#cam-zh').textContent = a.zh; $('#cam-ms').textContent = a.ms; $('#cam-desc').textContent = a.desc;
  cam.view = 'shoot'; resetCamUi();
  renderTemplate(id); setRing(0); setHint('');
  cam.mode = 'pose'; $('#timer-label').textContent = '用倒数拍';
  show('cam');
  Voice.say(S.posOk ? SAY.intro2(a) : SAY.intro(a));
  await startCamera();
}

/* ───── v3.1：远处也看得懂的大视觉 + 语音播报 ───── */
const ico = (items) => `<svg viewBox="0 0 100 100" aria-hidden="true">${items.map(([d]) => `<path class="u" d="${d}"/>`).join('')}${items.map(([d, c]) => `<path class="f ${c || ''}" d="${d}"/>`).join('')}</svg>`;
const person = (y, up = false) => [[`M42 ${y} a8 8 0 1 0 16 0 a8 8 0 1 0 -16 0`, 'w'], [`M50 ${y + 8} V${y + 26}${up ? '' : ` M50 ${y + 14} L38 ${y + 22} M50 ${y + 14} L62 ${y + 22}`} M50 ${y + 26} L42 ${y + 38} M50 ${y + 26} L58 ${y + 38}`, 'w']];
const ARROW_L = 'M6 50 L42 14 V34 H94 V66 H42 V86 Z';
const BIG = {
  // 箭头方向＝学生看屏幕（镜像）时的方向：「往你的左边移」→ 箭头指屏幕左边（推导见 js/poses.js 站位检查注释）
  left: `<svg viewBox="0 0 100 100" aria-hidden="true"><path class="fill-y" d="${ARROW_L}"/></svg>`,
  right: `<svg viewBox="0 0 100 100" aria-hidden="true"><path class="fill-y" transform="translate(100 0) scale(-1 1)" d="${ARROW_L}"/></svg>`,
  back: ico([['M24 36 L50 12 L76 36'], ['M24 54 L50 30 L76 54'], ...person(60)]),
  closer: ico([...person(4), ['M24 56 L50 80 L76 56'], ['M24 74 L50 98 L76 74']]),
  raise: ico([['M50 4 V24 M38 14 L50 2 L62 14'], ['M42 44 a8 8 0 1 0 16 0 a8 8 0 1 0 -16 0', 'w'], ['M50 52 V74 M50 60 L30 34 M50 60 L70 34 M50 74 L40 94 M50 74 L60 94', 'w']]),
  ok: '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" fill="#2F9E3A" stroke="#fff" stroke-width="6"/><path d="M26 52 L43 68 L75 32" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
const BIG_OF = { left: 'left', right: 'right', back: 'back', tall: 'back', feet: 'back', closer: 'closer', raise: 'raise', ok: 'ok' };
const CHIP_OK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHIP_NO = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/></svg>';
function paintFrame(state, p) { $('#frame').dataset.state = state; $('#frame-fill').style.setProperty('--p', String(Math.round(Math.max(0, Math.min(1, p)) * 100))); }
function paintPos(r, progress) {
  paintFrame(r.ok ? 'ok' : (r.kind === 'closer' && !r.diag?.bbox) || r.kind === 'back' ? 'bad' : 'near', progress);
  const kind = BIG_OF[r.kind] || 'back', big = $('#big');
  if (big.dataset.kind !== kind) { big.dataset.kind = kind; big.innerHTML = BIG[kind]; }
  big.hidden = false;
}
// 语音播报：hint 改变且稳定 1 秒后念一次；同一 hint 持续时每 5 秒重念；正在念别的（开场白等）就不打断
const Ann = {
  text: '', since: 0, last: 0, spoken: false,
  reset() { this.text = ''; this.since = 0; this.last = 0; this.spoken = false; },
  feed(text, now) {
    if (!text) return;
    if (text !== this.text) { this.text = text; this.since = now; this.spoken = false; return; }
    if (Voice.busy()) return;
    if (!this.spoken) { if (now - this.since >= 1000) { Voice.say(text); this.spoken = true; this.last = now; } }
    else if (now - this.last >= 5000) { Voice.say(text); this.last = now; }
  },
};

/* ───── ?debug=1 诊断面板 ───── */
const f2 = (n) => (n === null || n === undefined ? ' —  ' : n.toFixed(2));
const tf = (b) => (b === undefined ? '—' : b ? 'T' : 'F');
function dbgUpdate(lm, video, now, res, extraFps) {
  if (!DEBUG) return;
  let pre = $('#dbg'); if (!pre) { pre = document.createElement('pre'); pre.id = 'dbg'; document.body.appendChild(pre); }
  const v = (i) => (lm && lm[i] ? (lm[i].visibility ?? 1) : 0);
  const L = [`${cam.view === 'pos' ? `站位 step ${cam.posStep}` : `拍照 ${S.cur}`}  视频 ${video.videoWidth}x${video.videoHeight}（${cam.camTry || ''}）  检测fps ${extraFps.toFixed(1)}`,
    `vis(阈值 拍照${'0.4'}/站位${POS.VIS})  鼻 ${f2(v(0))}  肩 ${f2(v(11))}/${f2(v(12))}`,
    `  腕 ${f2(v(15))}/${f2(v(16))}  髋 ${f2(v(23))}/${f2(v(24))}  踝 ${f2(v(27))}/${f2(v(28))}`];
  const d = res && res.diag;
  if (d && cam.view === 'pos') {
    const bb = d.bbox, fl = d.flags || {};
    L.push(`人像框 x ${f2(d.box.x0)}–${f2(d.box.x1)}  y ${f2(d.box.y0)}–${f2(d.box.y1)}`,
      bb ? `身体外框 x ${f2(bb.minX)}–${f2(bb.maxX)}  y ${f2(bb.minY)}–${f2(bb.maxY)}  占人像高 ${f2(fl.fill)}（≥${POS.MIN_FILL}）` : '身体外框 —（鼻/髋/膝踝没看齐，没侦测到）',
      `太高 ${tf(fl.tooTall)}  太小 ${tf(fl.tooSmall)}  偏出左 ${tf(fl.outL)}  偏出右 ${tf(fl.outR)}  偏心左 ${tf(fl.offL)}  偏心右 ${tf(fl.offR)}  → ${res.kind}`);
  } else if (res && res.ok !== undefined) L.push(`判定 ${tf(res.ok)}`);
  if (res) L.push(`hint: ${res.hint}`);
  pre.textContent = L.join('\n');
  // 在画面上画出侦测到的点（镜像，与学生看到的一致）
  const cv = $('#dbgc'), st = $('#stage'); cv.hidden = false;
  const W = (cv.width = st.clientWidth), H = (cv.height = st.clientHeight), g = cv.getContext('2d');
  g.clearRect(0, 0, W, H); if (!lm) return;
  const sc = Math.max(W / video.videoWidth, H / video.videoHeight), ox = (W - video.videoWidth * sc) / 2, oy = (H - video.videoHeight * sc) / 2;
  lm.forEach((p, i) => {
    const x = W - (p.x * video.videoWidth * sc + ox), y = p.y * video.videoHeight * sc + oy, vis = p.visibility ?? 1, key = [0, 11, 12, 15, 16, 23, 24, 27, 28].includes(i);
    g.fillStyle = vis >= 0.5 ? '#3CFF5A' : vis >= POS.VIS ? '#FFD23C' : '#FF4A3C';
    g.beginPath(); g.arc(x, y, key ? 7 : 3, 0, 7); g.fill();
    if (key) { g.fillStyle = '#fff'; g.font = '12px monospace'; g.fillText(`${i}`, x + 8, y - 6); }
  });
}

function resetCamUi() {
  $('#chips').hidden = true; $('#pos-tip').hidden = true; $('#big').hidden = true; $('#big').dataset.kind = ''; paintFrame('none', 0); clearTimeout(cam.posBtnTimer); cam.posBtnTimer = 0; clearTimeout(cam.autoGo);
  Ann.reset();
  $('#cam-error').hidden = true; $('#pos-ok').hidden = true; $('#pos-guide').hidden = true;
  $('#btn-timer').classList.remove('pulse'); $('#btn-timer').style.visibility = cam.view === 'pos' ? 'hidden' : '';
}

/* ═════════ 3b 站位检查：屏幕上一个人像，学生站进去就 OK ═════════ */
function renderPosSilhouette() {
  const v = $('#video'), vw = v.videoWidth || 720, vh = v.videoHeight || 1280;
  // 地平线标签在手机上约 13px：换算成视频像素
  const stW = $('#stage').clientWidth, fs = stW && matchMedia('(max-width: 700px)').matches ? Math.round(13 / Math.max(stW / vw, 0.01)) : 0;
  renderTemplate('pos', { vw, vh, box: silhouetteBox(vw, vh), fs });
}
async function enterPosition(from) {
  S.posFrom = from; cam.view = 'pos'; cam.mode = 'pose'; resetCamUi();
  cam.progress = 0; cam.lastT = 0; setRing(0); setHint('');
  $('#cam-ico').innerHTML = art('tiptoe'); $('#ring-ico').innerHTML = art('tiptoe');
  $('#cam-zh').textContent = '站位检查'; $('#cam-ms').textContent = '站进人像里'; $('#cam-desc').textContent = '先转动手机角度，让人像的脚踩在地板上；再站进人像里面。'; $('#pos-tip').hidden = false; $('#pos-tip').classList.remove('fade');
  renderPosSilhouette();
  // 一直站不进去也不会卡住：8 秒后出现「我站好了」
  $('#timer-label').textContent = '我站好了';
  cam.posBtnTimer = setTimeout(() => { $('#btn-timer').style.visibility = ''; $('#btn-timer').classList.add('pulse'); }, 8000);
  show('cam');
  Voice.say(SAY.posStart());
  await startCamera();
}
function posDone() { // 站进人像了
  cam.capturing = true; if (cam.raf) cancelAnimationFrame(cam.raf); cam.raf = 0; clearTimeout(cam.posBtnTimer);
  $('#pos-tip').classList.add('fade'); setHint(''); $('#tpl').classList.remove('ok'); $('#pos-guide').hidden = true; $('#pos-ok').hidden = false; $('#big').hidden = true; Ann.reset();
  Sound.good(); Voice.say(SAY.posOk());
  cam.autoGo = setTimeout(posGo, 6500); // 不用再点：说完就进列表（也可以按「开始挑战」）
}
function posGo() { clearTimeout(cam.autoGo); if ($('#pos-ok').hidden) return; S.posOk = true; stopCamera(); cam.view = 'shoot'; Voice.stop(); renderList(); show('list'); }
function applyPos(r0, now) {
  const r = cam.posSm.push(r0);
  const dt = cam.lastT ? Math.min(100, now - cam.lastT) : 0; cam.lastT = now;
  cam.progress = r.ok ? cam.progress + dt / POS_HOLD_MS : Math.max(0, cam.progress - (dt / POS_HOLD_MS) * 2);
  setRing(cam.progress); $('#tpl').classList.toggle('ok', r.ok);
  paintPos(r, cam.progress);
  setHint(r.hint, r.ok);
  Ann.feed(r.hint, now);
  if (cam.progress >= 1) posDone();
}
$('#btn-pos-go').addEventListener('click', posGo);
$('#btn-pos-ready').addEventListener('click', posDone);

async function startCamera() {
  requestAnimationFrame(fitInsets);
  stopCamera();
  const tok = ++cam.token;
  cam.capturing = false; cam.progress = 0; cam.smoother.reset(); cam.posSm.reset(); Ann.reset(); cam.frames = []; cam.slowSince = 0; cam.lastLm = null;
  const loading = $('#loading'); loading.hidden = false; loading.textContent = '正在打开摄像头…';
  let stream;
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('no-getUserMedia');
    // facingMode:'user' 前置镜头；画面 CSS 镜像显示（像照镜子）
    stream = await openFrontCamera(freshVideo(), tok);
  } catch (err) {
    if (tok === cam.token) { loading.hidden = true; showCamError(err); }
    return;
  }
  if (tok !== cam.token) { stream.getTracks().forEach((t) => t.stop()); return; }
  cam.stream = cam.lastStream = stream;
  const video = $('#video');
  if (tok !== cam.token) return;
  fitStage();
  if (cam.view === 'pos') renderPosSilhouette(); // 视频真实尺寸出来了，人像对齐
  loading.textContent = '正在准备动作侦测…（第一次要等一下）';
  try {
    cam.landmarker = await loadLandmarker();
  } catch (err) {
    console.warn('model load failed', err);
    if (tok !== cam.token) return;
    loading.hidden = true; switchToTimer('动作侦测打不开，改用倒数拍');
    return;
  }
  if (tok !== cam.token) return;
  loading.hidden = true;
  if (cam.mode === 'pose' && !cam.countTimer) { // 倒数中就不再侦测
    cam.started = performance.now(); cam.lastT = 0;
    cam.raf = requestAnimationFrame(loop);
  }
}

function stopCamera() {
  cam.token++;
  if (cam.raf) cancelAnimationFrame(cam.raf);
  cam.raf = 0;
  clearInterval(cam.countTimer); cam.countTimer = 0;
  if (cam.stream) cam.stream.getTracks().forEach((t) => t.stop());
  cam.stream = null;
  const v = $('#video'); if (v) v.srcObject = null;
  $('#count').hidden = true;
}

function showCamError(err) {
  const inApp = isInAppBrowser();
  $('#cam-error-msg').textContent = inApp
    ? '这里打不开摄像头。请复制网址，用 Chrome 或 Safari 打开。'
    : (err && err.name === 'NotAllowedError' ? '摄像头没有打开。请允许使用摄像头，或复制网址，用 Chrome 或 Safari 打开。' : '请复制网址，用 Chrome 或 Safari 打开。');
  $('#cam-error').hidden = false;
  Voice.say(SAY.copyUrl());
}
$('#btn-copy').addEventListener('click', async () => {
  const url = location.href.split('#')[0];
  try { await navigator.clipboard.writeText(url); toast('网址已复制'); }
  catch {
    const ta = document.createElement('textarea'); ta.value = url; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('网址已复制'); } catch { toast(url); }
    ta.remove();
  }
});
$('#btn-err-back').addEventListener('click', leaveCam);

function switchToTimer(msg) {
  if (cam.view === 'pos') { // 侦测不能用：改成文字＋示意图，按「我站好了」继续
    cam.mode = 'timer'; if (cam.raf) cancelAnimationFrame(cam.raf); cam.raf = 0; setHint(''); setRing(0);
    $('#pos-guide').hidden = false; Voice.say(SAY.posGuide()); return;
  }
  cam.mode = 'timer';
  if (cam.raf) cancelAnimationFrame(cam.raf); cam.raf = 0;
  setRing(0); $('#tpl').classList.remove('ok');
  setHint(msg + '。按「开始倒数」');
  const b = $('#btn-timer'); $('#timer-label').textContent = '开始倒数'; b.classList.add('pulse');
  if (msg.includes('慢')) Voice.say(SAY.slow());
}

function loop(now) {
  if (cam.capturing || cam.mode !== 'pose' || cam.countTimer) return;
  cam.raf = requestAnimationFrame(loop);
  const video = $('#video');
  if (video.readyState < 2 || !video.videoWidth || video.currentTime === cam.lastVideoTime) return;
  cam.lastVideoTime = video.currentTime;
  let res;
  try { cam.ts = Math.max((cam.ts || 0) + 1, performance.now()); // 时间戳必须单调递增
    res = cam.landmarker.detectForVideo(video, cam.ts); } catch (e) { console.warn(e); return; }
  // 速度监测：最近 4 秒的侦测帧率 < 5 → 太慢
  cam.frames.push(now); while (cam.frames.length && now - cam.frames[0] > SLOW_WINDOW_MS) cam.frames.shift();
  if (!window.__noSlowFallback && now - cam.started > SLOW_WINDOW_MS + 1500) { // __noSlowFallback：测试用（无头浏览器用 CPU 跑，fps 天生 <5）
    const fps = cam.frames.length / (SLOW_WINDOW_MS / 1000);
    if (fps < SLOW_FPS) { cam.slowSince = cam.slowSince || now; } else cam.slowSince = 0;
    if (cam.slowSince && now - cam.slowSince >= SLOW_WINDOW_MS) { switchToTimer('手机有点慢，改用倒数拍'); return; }
  }
  const lm = res && res.landmarks && res.landmarks[0];
  if (lm) { cam.lastLm = lm; cam.lastLmT = now; } // 拍照时用来把人放在照片中间
  const fps = cam.frames.length / Math.max(1, Math.min(SLOW_WINDOW_MS, now - cam.started) / 1000);
  if (cam.view === 'pos') { const r0 = checkPosition(lm, video.videoWidth, video.videoHeight); dbgUpdate(lm, video, now, r0, fps); applyPos(r0, now); return; }
  const r = lm ? classify(S.cur, lm, { aspect: video.videoWidth / video.videoHeight }) : { ok: false, hint: FAR_HINT };
  dbgUpdate(lm, video, now, r, fps);
  applyResult(r, now);
}

function applyResult(r, now) {
  const a = byId(S.cur);
  const ok = cam.smoother.push(r.ok);
  const dt = cam.lastT ? Math.min(100, now - cam.lastT) : 0; cam.lastT = now;
  cam.progress = ok ? cam.progress + dt / a.holdMs : Math.max(0, cam.progress - (dt / a.holdMs) * 2);
  setRing(cam.progress);
  $('#tpl').classList.toggle('ok', ok);
  // 已做过站位检查：看不到全身时，提示回到拖鞋记号的位置
  const text = ok ? HINTS.shootOk : (S.posOk && r.hint === FAR_HINT ? HINTS.slipper : r.hint);
  setHint(text, ok); paintFrame('none', cam.progress); Ann.feed(text, now);
  if (cam.progress >= 1) capture('pose');
}

/* 倒数拍备案 */
$('#btn-timer').addEventListener('click', () => {
  if (cam.view === 'pos') { if (!cam.capturing) posDone(); return; }
  if (cam.capturing || !cam.stream) return;
  if (cam.countTimer) return;
  if (cam.raf) cancelAnimationFrame(cam.raf); cam.raf = 0; // 倒数时不再检查动作
  $('#tpl').classList.remove('ok'); setRing(0); setHint('');
  $('#btn-timer').classList.remove('pulse');
  Voice.say(SAY.timerGo());
  let n = COUNTDOWN_S;
  const c = $('#count');
  const showN = () => { c.hidden = false; c.textContent = String(n); c.classList.remove('tick'); void c.offsetWidth; c.classList.add('tick'); Sound.tick(); };
  showN();
  cam.countTimer = setInterval(() => {
    n -= 1;
    if (n <= 0) { clearInterval(cam.countTimer); cam.countTimer = 0; c.hidden = true; capture('timer'); return; }
    showN();
  }, 1000);
});

$('#cam-speak').addEventListener('click', () => Voice.say(SAY.desc(byId(S.cur))));
$('#cam-back').addEventListener('click', leaveCam);
function leaveCam() {
  stopCamera(); Voice.stop(); clearTimeout(cam.posBtnTimer); clearTimeout(cam.autoGo);
  if (cam.view === 'pos') { cam.view = 'shoot'; if (S.posFrom === 'list') { renderList(); show('list'); } else openTutorial('welcome', true); return; }
  renderList(); show('list');
}

/* ───── 画布小图示（不用 emoji）───── */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function fitText(ctx, text, x, y, maxW) {
  let size = parseInt(/(\d+)px/.exec(ctx.font)[1], 10);
  while (ctx.measureText(text).width > maxW && size > 12) { size -= 2; ctx.font = ctx.font.replace(/\d+px/, `${size}px`); }
  ctx.fillText(text, x, y);
}
function drawCheck(ctx, cx, cy, s, color) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = s * 0.22; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(cx - s * .36, cy + s * .02); ctx.lineTo(cx - s * .08, cy + s * .3); ctx.lineTo(cx + s * .4, cy - s * .28); ctx.stroke(); ctx.restore();
}
function drawClock(ctx, cx, cy, s, color) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = s * 0.12; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(cx, cy + s * .04, s * .4, 0, Math.PI * 2); ctx.moveTo(cx, cy - s * .16); ctx.lineTo(cx, cy + s * .04); ctx.lineTo(cx + s * .16, cy + s * .14);
  ctx.moveTo(cx - s * .12, cy - s * .5); ctx.lineTo(cx + s * .12, cy - s * .5); ctx.stroke(); ctx.restore();
}
function drawCloud(ctx, x, y, sc, fill = '#fff', alpha = 1) { // (x,y)＝云的左上角，原图 100×60
  ctx.save(); ctx.globalAlpha *= alpha; ctx.translate(x, y); ctx.scale(sc, sc); ctx.fillStyle = fill; ctx.fill(new Path2D(CLOUD_D)); ctx.restore();
}
function drawArt(ctx, name, x, y, w, h) { // 动作小图（缺图时画一朵云），保持比例居中
  const im = ART[name];
  if (im) { const r = Math.min(w / im.width, h / im.height); ctx.drawImage(im, x + (w - im.width * r) / 2, y + (h - im.height * r) / 2, im.width * r, im.height * r); return; }
  drawCloud(ctx, x + w * .1, y + h * .25, Math.min(w, h) / 100, '#fff');
}
function grayArt(name) { // 灰阶版（未完成位置用）
  const im = ART[name]; if (!im) return null;
  const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
  const x = c.getContext('2d'); x.drawImage(im, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height), p = d.data;
  for (let i = 0; i < p.length; i += 4) { const g = p[i] * .3 + p[i + 1] * .59 + p[i + 2] * .11; p[i] = p[i + 1] = p[i + 2] = g; }
  x.putImageData(d, 0, 0); return c;
}

/* 拍照：先画镜像影像，再正常画文字（文字不会反） */
async function capture(kind) {
  if (cam.capturing) return;
  cam.capturing = true;
  if (cam.raf) cancelAnimationFrame(cam.raf); cam.raf = 0;
  clearInterval(cam.countTimer); cam.countTimer = 0; $('#count').hidden = true;
  const a = byId(S.cur);
  const f = $('#flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  Sound.click(); Sound.good();
  const cv = document.createElement('canvas'); cv.width = PHOTO_W; cv.height = PHOTO_H;
  const ctx = cv.getContext('2d');
  const v = $('#video');
  if (v.videoWidth) {
    const vw = v.videoWidth, vh = v.videoHeight, target = PHOTO_W / PHOTO_H;
    let sw = vw, sh = vh, sx = 0, sy = 0;
    if (vw / vh > target) { sw = vh * target; sx = (vw - sw) / 2; } else { sh = vw / target; sy = (vh - sh) / 2; }
    // 照片是 3:4，镜头是 9:16，上下（或左右）一定要裁掉一部分。以前固定裁中间，趴在地上的动作人在画面下方，
    // 会被裁掉，又被底部的名牌条盖住（老师 iPhone 实测鳄鱼撑地）。改成以人的位置来裁：人放在名牌条以上那块的中间。
    const box = personBox(cam.lastLm, performance.now() - (cam.lastLmT || 0) < 1500);
    const visH = (PHOTO_H - STAMP_H) / PHOTO_H; // 名牌条以上可见的比例
    if (box) {
      sy = clamp(box.cy * vh - sh * visH / 2, 0, vh - sh);
      sx = clamp(box.cx * vw - sw / 2, 0, vw - sw);
    } else if (FLOOR_POSES.has(a.id)) {
      sy = vh - sh; // 倒数拍没有骨架：地上的动作留下面、裁上面
    }
    ctx.save(); ctx.translate(PHOTO_W, 0); ctx.scale(-1, 1);
    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, PHOTO_W, PHOTO_H);
    ctx.restore();
  } else { ctx.fillStyle = '#5a82a8'; ctx.fillRect(0, 0, PHOTO_W, PHOTO_H); }
  await Promise.race([Promise.all([ensureFonts(), preloadArt()]), wait(2500)]);
  drawStamp(ctx, a, kind);
  const url = cv.toDataURL('image/jpeg', 0.9);
  stopCamera();
  Voice.say(SAY.done());
  const first = !S.photos[a.id];
  S.photos[a.id] = { url, mode: kind };
  await wait(300);
  $('#confirm-img').src = url;
  $('#btn-next').textContent = nextUndone() ? '下一个' : '完成';
  show('confirm');
  S._pop = first ? a.id : null;
}

function drawStamp(ctx, a, kind) {
  const barH = STAMP_H, y0 = PHOTO_H - barH;
  ctx.fillStyle = C.cloud; ctx.fillRect(0, y0, PHOTO_W, barH);
  ctx.fillStyle = C.grass; ctx.fillRect(0, y0, PHOTO_W, 8);
  // 动作小图贴纸
  ctx.fillStyle = '#D6E9FA'; ctx.beginPath(); ctx.arc(86, y0 + 104, 66, 0, Math.PI * 2); ctx.fill();
  drawArt(ctx, a.id, 28, y0 + 46, 116, 116);
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillStyle = C.ink; ctx.font = `700 46px ${F_KAI}`; fitText(ctx, a.zh, 170, y0 + 50, 330);
  ctx.fillStyle = '#46544A'; ctx.font = `italic 500 26px ${F_MS}`; fitText(ctx, a.ms, 170, y0 + 90, 330);
  ctx.fillStyle = C.ink; ctx.font = `800 34px ${F_SANS}`; fitText(ctx, S.name, 170, y0 + 138, 330);
  ctx.fillStyle = '#46544A'; ctx.font = `600 28px ${F_SANS}`; ctx.fillText(fmtDate(), 170, y0 + 174);
  const label = kind === 'pose' ? '动作完成' : '倒数拍';
  ctx.font = `800 36px ${F_SANS}`;
  const tw = ctx.measureText(label).width + 100, bx = PHOTO_W - tw - 22, by = y0 + 62;
  ctx.fillStyle = kind === 'pose' ? C.blue : C.sun;
  roundRect(ctx, bx, by, tw, 78, 14); ctx.fill();
  const fg = kind === 'pose' ? C.cloud : C.ink;
  (kind === 'pose' ? drawCheck : drawClock)(ctx, bx + 42, by + 39, 40, fg);
  ctx.fillStyle = fg; ctx.fillText(label, bx + 74, by + 41);
}

/* 生命周期：切走／关页面都放掉摄像头 */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (cam.stream) { stopCamera(); cam.interrupted = true; } }
  else if (cam.interrupted && !$('#s-cam').hidden) { cam.interrupted = false; startCamera(); }
});
window.addEventListener('pagehide', () => { stopCamera(); });

/* ═════════ 4 照片确认 ═════════ */
function nextUndone() {
  const i = MOVES.findIndex((a) => a.id === S.cur);
  for (let k = 1; k <= MOVES.length; k++) { const a = MOVES[(i + k) % MOVES.length]; if (!S.photos[a.id]) return a.id; }
  return null;
}
$('#btn-retake').addEventListener('click', () => enterCam(S.cur));
$('#btn-next').addEventListener('click', () => {
  const nx = nextUndone();
  renderList(S._pop); S._pop = null;
  if (nx) { enterCam(nx); } else { show('list'); Voice.say(SAY.allDone()); }
});
const safe = (s) => s.replace(/[\\/:*?"<>|\s]+/g, '_');
$('#btn-save-one').addEventListener('click', () => {
  const a = byId(S.cur), p = S.photos[S.cur];
  const l = document.createElement('a'); l.href = p.url; l.download = `PJ-${a.zh}-${safe(S.name)}-${ymd()}.jpg`;
  document.body.appendChild(l); l.click(); l.remove();
});

/* ═════════ 5 打卡卡：蓝天操场挂画 ═════════ */
let cardBlob = null;
const SEED = { // 固定种子，不是每次随机：每行的中心 x / 垂直微调 / 旋转角（-6°～6°）
  rows: [{ ry: 345, idx: [0, 1, 2], xs: [190, 540, 890], dy: [0, 20, -6], rot: [-4.5, 3, -2.2] },
         { ry: 835, idx: [3, 4], xs: [330, 770], dy: [8, -10], rot: [3.6, -4.2] },
         { ry: 1325, idx: [5, 6], xs: [250, 650], dy: [-4, 14], rot: [-2.8, 5.2] }],
};
function drawBackdrop(ctx, W, H) {
  const bg = ART['card-bg'];
  if (bg) {
    const r = Math.max(W / bg.width, H / bg.height);
    ctx.drawImage(bg, (W - bg.width * r) / 2, (H - bg.height * r) / 2, bg.width * r, bg.height * r);
    ctx.fillStyle = 'rgba(10,28,20,.18)'; ctx.fillRect(0, 0, W, H); // 稍压暗，让白边照片更跳
    return;
  }
  // 后备：晴空渐层 + 阳光 + 云 + 草坡
  const g = ctx.createLinearGradient(0, 0, W * .2, H); g.addColorStop(0, '#1B64B5'); g.addColorStop(.55, '#3F8FDD'); g.addColorStop(1, '#8CC8F2');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const beam = ctx.createRadialGradient(80, 40, 0, 80, 40, 900); beam.addColorStop(0, 'rgba(255,240,170,.55)'); beam.addColorStop(1, 'rgba(255,240,170,0)');
  ctx.fillStyle = beam; ctx.fillRect(0, 0, W, H);
  for (const [x, y, sc, al] of [[-40, 120, 4.2, .9], [780, 40, 3.6, .85], [60, 1180, 3, .6], [820, 1000, 3.4, .65], [380, 1500, 3.8, .55]]) drawCloud(ctx, x, y, sc, '#fff', al);
  for (const [y, amp, c] of [[H - 190, 60, '#5DB04F'], [H - 110, 40, '#3E9A44']]) {
    ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(0, y);
    ctx.bezierCurveTo(W * .22, y - amp, W * .45, y + amp * .4, W * .7, y - amp * .6); ctx.bezierCurveTo(W * .85, y - amp * 1.1, W * .95, y, W, y - amp * .3);
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();
  }
}
function ropeY(ry, x, W) { const t = x / W; return ry + 96 * t * (1 - t); }
function drawRope(ctx, ry, W) {
  ctx.save(); ctx.lineCap = 'round';
  ctx.strokeStyle = '#9CC0E6'; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(-10, ry); ctx.quadraticCurveTo(W / 2, ry + 48, W + 10, ry); ctx.stroke();
  ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 5; ctx.setLineDash([14, 9]); ctx.beginPath(); ctx.moveTo(-10, ry - 1); ctx.quadraticCurveTo(W / 2, ry + 47, W + 10, ry - 1); ctx.stroke();
  ctx.restore();
}
function drawClip(ctx) { // 木夹子（原点＝夹住相片上缘中心）
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 3;
  ctx.fillStyle = '#B98A55'; roundRect(ctx, -13, -30, 26, 64, 7); ctx.fill(); ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#8A6238'; ctx.fillRect(-13, -2, 26, 5); ctx.fillStyle = '#D6AE79'; ctx.fillRect(-9, -26, 5, 24);
  ctx.restore();
}
function cloudLabel(ctx, cx, cy, w, h, fill) { // 圆角名牌
  ctx.save(); ctx.translate(cx, cy); ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 5;
  ctx.fillStyle = fill; roundRect(ctx, -w / 2, -h / 2, w, h, h / 2); ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.strokeStyle = 'rgba(247,251,255,.35)'; ctx.lineWidth = 3; roundRect(ctx, -w / 2 + 6, -h / 2 + 6, w - 12, h - 12, h / 2 - 6); ctx.stroke();
  ctx.restore();
}
function drawSun(ctx, cx, cy, r) {
  ctx.save(); ctx.translate(cx, cy);
  ctx.strokeStyle = C.sun; ctx.lineWidth = r * .14; ctx.lineCap = 'round';
  for (let i = 0; i < 12; i++) { ctx.rotate(Math.PI / 6); ctx.beginPath(); ctx.moveTo(r * 1.3, 0); ctx.lineTo(r * 1.65, 0); ctx.stroke(); }
  ctx.shadowColor = 'rgba(8,28,60,.35)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 6;
  ctx.fillStyle = C.sun; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#FFE48A'; ctx.beginPath(); ctx.arc(-r * .22, -r * .22, r * .55, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

async function buildCard() {
  await Promise.race([Promise.all([ensureFonts(), preloadArt()]), wait(4000)]);
  const cv = $('#card'), ctx = cv.getContext('2d'), W = 1080, H = 1920;
  ctx.clearRect(0, 0, W, H); ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  drawBackdrop(ctx, W, H);
  const doneN = Object.keys(S.photos).length;

  // 标题牌：两条细绳吊着
  ctx.strokeStyle = '#F7FBFF'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(210, -10); ctx.lineTo(236, 78); ctx.moveTo(870, -10); ctx.lineTo(846, 78); ctx.stroke();
  ctx.save(); ctx.translate(540, 190); ctx.rotate(-0.012);
  ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 12;
  const wood = ctx.createLinearGradient(0, -125, 0, 125); wood.addColorStop(0, '#2F7FD1'); wood.addColorStop(1, '#1B64B5');
  ctx.fillStyle = wood; roundRect(ctx, -460, -118, 920, 236, 26); ctx.fill(); ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(255,255,255,.10)'; ctx.lineWidth = 2;
  for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.moveTo(-440, -96 + i * 25); ctx.bezierCurveTo(-200, -102 + i * 25, 200, -88 + i * 25, 440, -98 + i * 25); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(243,241,230,.35)'; ctx.lineWidth = 3; roundRect(ctx, -446, -104, 892, 208, 20); ctx.stroke();
  ctx.fillStyle = C.cloud; ctx.font = `400 92px ${F_KAI}`; ctx.shadowColor = 'rgba(8,28,60,.5)'; ctx.shadowOffsetY = 4; ctx.shadowBlur = 2;
  ctx.fillText('蓝天操场', -90, -34); ctx.shadowColor = 'transparent';
  ctx.font = `800 46px ${F_SANS}`; ctx.fillStyle = '#FFE9A8'; fitText(ctx, S.name + (S.cls ? `　${S.cls}` : ''), -90, 52, 640);
  ctx.font = `600 28px ${F_SANS}`; ctx.fillStyle = C.cloud; ctx.fillText(fmtDate(), -90, 98);
  // 完成章（跑道红）
  ctx.translate(335, 8); ctx.rotate(0.14);
  ctx.fillStyle = C.track; ctx.beginPath(); ctx.arc(0, 0, 84, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = C.cloud; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(0, 0, 72, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = C.cloud; ctx.font = `400 28px ${F_KAI}`; ctx.fillText('完成', 0, -28);
  ctx.font = `800 54px ${F_SANS}`; ctx.fillText(`${doneN}/${MOVES.length}`, 0, 22);
  ctx.restore();

  for (const row of SEED.rows) drawRope(ctx, row.ry, W);
  for (const row of SEED.rows) {
    for (let k = 0; k < row.idx.length; k++) {
      const a = MOVES[row.idx[k]], p = S.photos[a.id];
      const cx = row.xs[k], topY = ropeY(row.ry, cx, W) + 4 + row.dy[k], rot = row.rot[k] * Math.PI / 180;
      const PW = 270, PH = 360, BX = 14, BT = 14, BB = 56, OW = PW + 2 * BX, OH = PH + BT + BB;
      ctx.save(); ctx.translate(cx, topY); ctx.rotate(rot);
      // 拍立得白边
      ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 22; ctx.shadowOffsetX = 6; ctx.shadowOffsetY = 12;
      ctx.globalAlpha = p ? 1 : 0.55; ctx.fillStyle = '#FBFAF3'; roundRect(ctx, -OW / 2, 0, OW, OH, 4); ctx.fill(); ctx.shadowColor = 'transparent';
      const px = -PW / 2, py = BT;
      if (p) {
        const img = await loadImg(p.url);
        ctx.drawImage(img, px, py, PW, PH);
        // 贴纸：动作小图
        ctx.save(); ctx.translate(OW / 2 - 34, 62); ctx.rotate(0.18); ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 4;
        ctx.fillStyle = '#FBFAF3'; ctx.beginPath(); ctx.arc(0, 0, 58, 0, Math.PI * 2); ctx.fill(); ctx.shadowColor = 'transparent'; drawArt(ctx, a.id, -50, -50, 100, 100); ctx.restore();
        // 完成章
        ctx.save(); ctx.translate(-OW / 2 + 40, 52); ctx.rotate(-0.2); ctx.fillStyle = C.track; ctx.beginPath(); ctx.arc(0, 0, 32, 0, Math.PI * 2); ctx.fill(); drawCheck(ctx, 0, 0, 40, C.cloud); ctx.restore();
      } else {
        ctx.fillStyle = 'rgba(18,62,115,.5)'; ctx.fillRect(px, py, PW, PH);
        const g = grayArt(a.id); ctx.globalAlpha = .42; if (g) ctx.drawImage(g, px + 25, py + 52, PW - 50, PW - 50); else drawArt(ctx, a.id, px + 25, py + 52, PW - 50, PW - 50);
        ctx.globalAlpha = 1; ctx.fillStyle = C.cloud; ctx.font = `700 44px ${F_KAI}`; ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 6; ctx.fillText('未完成', 0, py + PH - 46); ctx.shadowColor = 'transparent';
      }
      ctx.globalAlpha = 1;
      // 名牌
      cloudLabel(ctx, 0, OH - 4, 300, 78, p ? (row.idx[k] % 2 ? C.blue : '#2F7FD1') : '#5C7592');
      ctx.fillStyle = C.cloud; ctx.font = `700 32px ${F_KAI}`; fitText(ctx, a.zh, 0, OH - 18, 230);
      ctx.fillStyle = '#FFE9A8'; ctx.font = `italic 500 20px ${F_MS}`; fitText(ctx, a.ms, 0, OH + 14, 240);
      drawClip(ctx);
      ctx.restore();
    }
  }
  drawSun(ctx, 930, 1625, 58);
  // 底部小字页脚
  ctx.font = `600 24px ${F_SANS}`; const ft = 'Pendidikan Jasmani Tahun 2', fw = ctx.measureText(ft).width + 44;
  ctx.fillStyle = 'rgba(8,28,60,.6)'; roundRect(ctx, 540 - fw / 2, 1860, fw, 40, 20); ctx.fill();
  ctx.fillStyle = C.cloud; ctx.textAlign = 'center'; ctx.fillText(ft, 540, 1881);

  cardBlob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.9));
  setupShare();
}

function cardFile() { return new File([cardBlob], `PJ-蓝天操场-${safe(S.name)}-${ymd()}.jpg`, { type: 'image/jpeg' }); }
function setupShare() {
  let canShare = false;
  try { canShare = !!(navigator.canShare && cardBlob && navigator.canShare({ files: [cardFile()] })); } catch { canShare = false; }
  $('#btn-share').hidden = !canShare;
}
$('#btn-share').addEventListener('click', async () => {
  try { await navigator.share({ files: [cardFile()], title: '蓝天操场', text: `${S.name} 的蓝天操场打卡卡` }); showDone(); }
  catch (e) { if (e && e.name !== 'AbortError') toast('分享没有成功，请改用「存到手机」'); }
});
$('#btn-download').addEventListener('click', () => {
  if (!cardBlob) return;
  const f = cardFile(), u = URL.createObjectURL(cardBlob);
  const l = document.createElement('a'); l.href = u; l.download = f.name; document.body.appendChild(l); l.click(); l.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
  setTimeout(showDone, 700);
});
$('#card-back').addEventListener('click', () => { renderList(); show('list'); });
$('#card-finish').addEventListener('click', showDone);

/* ═════════ 6 完成画面 ═════════ */
function showDone() {
  const n = Object.keys(S.photos).length;
  $('#done-title').textContent = `做得好，${S.name}！`;
  $('#done-sub').textContent = `完成了 ${n} / ${MOVES.length} 个动作`;
  const { pals, fore } = peekHTML(true);
  $('#curtain').innerHTML = pals + fore;
  show('done'); spawnFalling(); Sound.good(); Voice.say(SAY.finish());
}
$('#btn-again').addEventListener('click', () => { // 清空照片，保留名字
  S.photos = {}; cardBlob = null; S.cur = null; S.animated = false;
  Voice.stop(); renderList(); show('list');
});
$('#btn-redo').addEventListener('click', () => { renderList(null, true); show('list'); });
$('#btn-tocard').addEventListener('click', () => { buildCard(); show('card'); });

/* ───── 启动 + debug 钩子 ───── */
window.__pj = {
  allVoiceLines,
  state: S, cam,
  forcePass: () => capture('pose'),
  forcePosition: () => posDone(),
  voiceLog: () => Voice.log.slice(),
  trackStates: () => (cam.lastStream ? cam.lastStream.getTracks().map((t) => t.readyState) : []),
  activeTracks: () => (cam.stream ? cam.stream.getTracks().filter((t) => t.readyState === 'live').length : 0),
  classify,
  cardReady: () => !!cardBlob,
};
buildBg(); buildWelcome(); preloadArt();
document.addEventListener('pointerdown', () => { if (!window.__welcomed && !$('#s-welcome').hidden) { window.__welcomed = true; Voice.say(SAY.welcome()); } }, { once: true });
show('welcome');

// 画面比例跟着真实镜头走：笔电是横向镜头，若硬裁成直式会只显示中间一窄条，
// 而站位／动作判定用的是整个画面，学生看到的和系统判定的就对不上。照片仍在拍照时另裁 3:4。
function fitStage() {
  const v = $('#video'), st = v.closest('.stage');
  if (st && v.videoWidth && v.videoHeight) st.style.setProperty('--arn', String(v.videoWidth / v.videoHeight));
  if (cam.view === 'pos' && v.videoWidth) renderPosSilhouette();
  requestAnimationFrame(fitInsets);
}
// 手机上顶部条、底部列叠在画面上：算出提示药丸、横幅要离画面边缘多远，才不被它们盖住
function fitInsets() {
  const st = $('#stage'); if (!st || !matchMedia('(max-width: 700px)').matches) return;
  const r = st.getBoundingClientRect(); if (!r.height) return;
  const bar = $('.cam-bottom'), top = $('.cam-top');
  const gapB = innerHeight - r.bottom, gapT = r.top;
  st.style.setProperty('--hb', `${Math.max(10, (bar ? bar.offsetHeight : 76) - gapB + 6)}px`);
  st.style.setProperty('--ht', `${Math.max(8, (top ? top.offsetHeight : 56) - gapT + 6)}px`);
}
addEventListener('resize', () => requestAnimationFrame(fitInsets));
// iOS 会在开流后才把画面转成直式（video 触发 resize），所以两个事件都要跟。
$('#video').addEventListener('loadedmetadata', fitStage);
$('#video').addEventListener('resize', fitStage);
// iPhone Safari：同一个 <video> 关掉再接上新镜头后，有时不再撑满 .stage（老师 iPhone 实测：站位检查满屏，
// 进动作后画面缩成中间一小块）。每次开镜头都换一个全新的 video 元素，避开 Safari 留下的旧版面状态。
// 这是依症状推测的修法，Chromium 重现不出来，要 iPhone 实测确认。
function freshVideo() {
  const old = $('#video'), v = old.cloneNode(false);
  v.removeAttribute('src'); v.muted = true; v.playsInline = true;
  old.replaceWith(v);
  v.addEventListener('loadedmetadata', fitStage);
  v.addEventListener('resize', fitStage);
  return v;
}

// 手机直拿时要直式画面（看得到更多上下空间）。各浏览器对 width/height 的解读不同：
// iPhone 直拿时，要 1280×720 反而会给直式 720×1280；要 720×1280 却给横式（2026-10-10 老师 iPhone 实测）。
// 所以依序试，拿到的方向跟屏幕方向一致就用；都不一致就用最后一个。
const CAM_TRIES = [
  { width: { ideal: 1280 }, height: { ideal: 720 } },
  { width: { ideal: 720 }, height: { ideal: 1280 } },
  { aspectRatio: { ideal: 3 / 4 } },
];
function waitDims(video) {
  return new Promise((res) => {
    if (video.videoWidth) return res();
    const done = () => { video.removeEventListener('loadedmetadata', done); clearTimeout(t); res(); };
    const t = setTimeout(done, 2000);
    video.addEventListener('loadedmetadata', done);
  });
}
async function openFrontCamera(video, tok) {
  const wantPortrait = innerHeight > innerWidth;
  for (let i = 0; i < CAM_TRIES.length; i++) {
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', ...CAM_TRIES[i] }, audio: false });
    video.srcObject = s;
    // play() 在背景分页可能永远不 resolve，最多等 1.5 秒
    await Promise.race([video.play().catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
    await waitDims(video);
    await new Promise((r) => setTimeout(r, 150)); // 让 iOS 的旋转（resize）先发生
    cam.camTry = `试${i + 1}：${video.videoWidth}×${video.videoHeight}`;
    const isPortrait = video.videoHeight > video.videoWidth;
    if (isPortrait === wantPortrait || i === CAM_TRIES.length - 1 || tok !== cam.token) return s;
    s.getTracks().forEach((t) => t.stop());
  }
}
