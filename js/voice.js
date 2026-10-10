// 朗读：优先播预录 mp3（audio/，由 gen-voice.py 用 edge-tts 生成），没有就退回浏览器 speechSynthesis。
// 档名 = FNV-1a(声音|句子)，和 gen-voice.py 一致。改了 SAY 的句子要重跑 gen-voice.py。
// 句子里不放学生名字等不可预期内容，这样每一句都能预先录好。
import { MOVES, ALL_HINTS } from './poses.js';

// macOS 14 起中文声音列表最前面是 Eddy／Grandpa／Rocko 这类搞怪声音，一定要自己挑、排除。
const NOVELTY_VOICES = /Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley|Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox/i;
const VOICE_RANK = [/Xiaoxiao.*Natural|Xiaoxiao Online/i, /Google 普通话|Google.*(Mandarin|中国)/i, /Xiaoxiao|Xiaoyi|Yunxi/i, /Huihui/i, /Tingting|婷婷/i, /Lili|李莉/i, /Yaoyao|Kangkang/i];
export const VOICE_NARRATOR = 'zh-CN-XiaoxiaoNeural';

export function clipKey(voice, text) {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(voice + '|' + text)) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

export const SAY = {
  welcome: () => '你好！欢迎来到蓝天操场。先写上你的名字，再按开始。',
  intro: (a) => `把手机立在桌上，往后退，让全身都在框里。${a.desc}`,
  intro2: (a) => `站到拖鞋记号上。${a.desc}`,
  desc: (a) => a.desc,
  teach: (a) => `${a.zh}。${a.steps.map((s, i) => `第${'一二三'[i]}，${s}`).join('。')}。`,
  posStart: () => '把手机立好。先转动手机的角度，让人像的脚踩在地板上，对齐地平线。然后站进人像里面，之后不要再动手机。',
  posOk: () => '位置刚刚好！在你的脚边放一双拖鞋做记号，每个动作都回到这里做。',
  posGuide: () => '手机有点慢，请站到屏幕上的人像里面，全身都要在框里，站好了就按我站好了。',
  far: () => '再退后一点，让全身进框。',
  done: () => '做到了！你真棒！',
  slow: () => '手机有点慢，我们改用倒数拍。按下按钮，十秒后会自动拍照。',
  timerGo: () => '准备好了吗？十秒后拍照，快摆好动作！',
  copyUrl: () => '请复制网址，用 Chrome 或 Safari 打开。',
  finish: () => '全部完成！你真棒！',
  allDone: () => '太棒了！动作都做完了，来做打卡卡吧。',
};

export function allVoiceLines() {
  const out = new Map();
  const add = (text) => out.set(text, { text, voice: VOICE_NARRATOR, key: clipKey(VOICE_NARRATOR, text) });
  add(SAY.welcome()); add(SAY.far()); add(SAY.done()); add(SAY.slow()); add(SAY.timerGo()); add(SAY.copyUrl()); add(SAY.allDone()); add(SAY.finish());
  for (const h of ALL_HINTS) add(h); // 所有会出现的提示句（站位检查＋拍照判定）都预录
  add(SAY.posStart()); add(SAY.posOk()); add(SAY.posGuide());
  for (const a of MOVES) { add(SAY.intro(a)); add(SAY.intro2(a)); add(SAY.desc(a)); add(SAY.teach(a)); }
  return [...out.values()];
}

export const Voice = {
  on: true, voice: null, audio: null, log: [],
  busy() { return !!(this.audio && !this.audio.paused && !this.audio.ended) || ('speechSynthesis' in window && speechSynthesis.speaking); },
  pick() {
    if (!('speechSynthesis' in window)) return;
    const vs = speechSynthesis.getVoices().filter((v) => /^zh[-_](CN|Hans|SG|MY)/i.test(v.lang) && !NOVELTY_VOICES.test(v.name));
    this.voice = null;
    for (const re of VOICE_RANK) { const v = vs.find((x) => re.test(x.name)); if (v) { this.voice = v; break; } }
    if (!this.voice) this.voice = vs[0] || null;
  },
  say(text) {
    this.stop();
    if (!this.on || !text) return;
    const key = clipKey(VOICE_NARRATOR, text);
    const hasClip = !!(window.VOICE_CLIPS && window.VOICE_CLIPS[key]);
    this.log.push({ text, clip: hasClip, t: Date.now() }); if (this.log.length > 200) this.log.shift();
    if (hasClip) {
      const au = new Audio(`audio/${key}.mp3`);
      this.audio = au;
      au.play().catch(() => { if (this.audio === au) this.tts(text); });
      return;
    }
    this.tts(text);
  },
  tts(text) {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    if (!this.voice) this.pick();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN'; u.rate = 0.92; u.pitch = 1;
    if (this.voice) u.voice = this.voice;
    speechSynthesis.speak(u);
  },
  stop() {
    if (this.audio) { this.audio.pause(); this.audio = null; }
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  },
};
if ('speechSynthesis' in window) { Voice.pick(); speechSynthesis.onvoiceschanged = () => Voice.pick(); }
