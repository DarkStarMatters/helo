// FINAL BOSS CAT - browser beat 'em up demo.
// Plain canvas 2D, no dependencies. Sprites come from assets/atlas.js, which
// tools/extract_sprites.py generates from fbcatsprites.png.
'use strict';

const W = 960, H = 540;
const FLOOR_TOP = 365, FLOOR_BOT = 525;
const LEVEL_W = 4200;
const GRAV = 1600;
const DT = 1 / 60;
const PIXEL = '"Press Start 2P", monospace';
const BODY = '"Rajdhani", "Segoe UI", sans-serif';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = arr => arr[(Math.random() * arr.length) | 0];

// ---------------------------------------------------------------- assets
const A = { anims: {}, img: {}, white: {} };

function loadImage(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('failed to load ' + src));
    i.src = src;
  });
}

// White silhouette copy for hit flashes (compositing only - works under file://).
function whiten(img) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

async function loadAssets() {
  const jobs = [];
  for (const [variant, anims] of Object.entries(ATLAS.anims)) {
    A.anims[variant] = {};
    for (const [name, meta] of Object.entries(anims)) {
      jobs.push(loadImage(meta.src).then(img => {
        A.anims[variant][name] = { ...meta, img, white: whiten(img) };
      }));
    }
  }
  for (const [name, meta] of Object.entries(ATLAS.images)) {
    jobs.push(loadImage(meta.src).then(img => { A.img[name] = img; }));
  }
  const fonts = document.fonts
    ? Promise.race([
        Promise.all([document.fonts.load('16px "Press Start 2P"'), document.fonts.load('20px "Rajdhani"')]),
        new Promise(r => setTimeout(r, 2500)),
      ]).catch(() => {})
    : Promise.resolve();
  await Promise.all([...jobs, fonts]);
  A.white.human = whiten(A.img.human);
  buildBackdrops();
}

// ---------------------------------------------------------------- input
const input = { held: {}, pressed: {} };
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  KeyJ: 'attack', KeyZ: 'attack', KeyK: 'jump', KeyX: 'jump', Space: 'jump',
  KeyL: 'roar', KeyC: 'roar', KeyI: 'breath', KeyV: 'breath',
  Enter: 'start', Escape: 'pause', KeyP: 'pause', KeyM: 'mute',
};

function press(k) { if (!input.held[k]) input.pressed[k] = true; input.held[k] = true; }
function release(k) { input.held[k] = false; }

addEventListener('keydown', e => {
  Sfx.init();
  const k = KEYMAP[e.code];
  if (!k) return;
  e.preventDefault();
  if (!e.repeat) press(k);
});
addEventListener('keyup', e => { const k = KEYMAP[e.code]; if (k) release(k); });
addEventListener('blur', () => { input.held = {}; });
canvas.addEventListener('pointerdown', () => { Sfx.init(); press('start'); setTimeout(() => release('start'), 50); });

// Standard-mapping gamepad: d-pad/left stick move, A claw, B jump, X roar, Y breath, Start pause.
const padPrev = {};
function pollGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const p = pads && [...pads].find(Boolean);
  if (!p) return;
  const b = i => !!(p.buttons[i] && p.buttons[i].pressed);
  const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
  const state = {
    left: b(14) || ax < -0.4, right: b(15) || ax > 0.4, up: b(12) || ay < -0.4, down: b(13) || ay > 0.4,
    attack: b(0), jump: b(1), roar: b(2), breath: b(3), start: b(9), pause: b(9) || b(8),
  };
  for (const [k, v] of Object.entries(state)) {
    if (v && !padPrev[k]) { Sfx.init(); press(k); }
    if (!v && padPrev[k]) release(k);
    padPrev[k] = v;
  }
}

// ---------------------------------------------------------------- drawing helpers
function drawFrame(anim, frame, x, y, scale, flip, o = {}) {
  const { w, h, foot } = anim;
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  if (o.rot) ctx.rotate(o.rot);
  ctx.scale(flip ? -scale * (o.sx || 1) : scale * (o.sx || 1), scale * (o.sy || 1));
  ctx.globalAlpha = o.alpha ?? 1;
  ctx.drawImage(anim.img, frame * w, 0, w, h, -w / 2, -h + foot, w, h);
  if (o.white > 0) {
    ctx.globalAlpha = (o.alpha ?? 1) * Math.min(1, o.white);
    ctx.drawImage(anim.white, frame * w, 0, w, h, -w / 2, -h + foot, w, h);
  }
  ctx.restore();
}

function drawImg(img, x, y, scale, o = {}) {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  if (o.rot) ctx.rotate(o.rot);
  ctx.scale(o.flip ? -scale : scale, scale);
  ctx.globalAlpha = o.alpha ?? 1;
  if (o.add) ctx.globalCompositeOperation = 'lighter';
  if (o.filter) ctx.filter = o.filter;
  const ax = o.ax ?? 0.5, ay = o.ay ?? 0.5;
  ctx.drawImage(img, -img.width * ax, -img.height * ay);
  ctx.restore();
}

function text(str, x, y, o = {}) {
  ctx.save();
  ctx.font = `${o.weight || ''} ${o.size || 16}px ${o.font || PIXEL}`;
  ctx.textAlign = o.align || 'left';
  ctx.textBaseline = o.baseline || 'alphabetic';
  ctx.globalAlpha = o.alpha ?? 1;
  if (o.glow) { ctx.shadowColor = o.glow; ctx.shadowBlur = o.blur ?? 12; }
  if (o.stroke) { ctx.lineWidth = o.strokeW || 4; ctx.strokeStyle = o.stroke; ctx.lineJoin = 'round'; ctx.strokeText(str, x, y); }
  ctx.fillStyle = o.color || '#fff';
  ctx.fillText(str, x, y);
  ctx.restore();
}

function wrap(str, maxW, font) {
  ctx.save(); ctx.font = font;
  const words = str.split(' '), lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  ctx.restore();
  return lines;
}

function bar(x, y, w, h, frac, c1, c2, back = 'rgba(10,6,30,0.85)') {
  ctx.fillStyle = back; ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.strokeStyle = 'rgba(150,120,255,0.6)'; ctx.lineWidth = 1; ctx.strokeRect(x - 2.5, y - 2.5, w + 5, h + 5);
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  ctx.fillStyle = g; ctx.fillRect(x, y, w * clamp(frac, 0, 1), h);
  ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(x, y, w * clamp(frac, 0, 1), Math.max(1, h / 4));
}

// ---------------------------------------------------------------- backdrops
const BG = {};

function seeded(seed) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }

function buildBackdrops() {
  // star field + nebula, tiles horizontally
  const sf = document.createElement('canvas'); sf.width = 1600; sf.height = H;
  const g = sf.getContext('2d'), r = seeded(1799);
  g.fillStyle = '#02030c'; g.fillRect(0, 0, sf.width, H);
  const neb = [['#5a1fb0', 260, 120, 360], ['#0d6b9a', 900, 200, 300], ['#8a1f8f', 1350, 90, 280], ['#2b2fb5', 600, 330, 320]];
  for (const [c, x, y, rad] of neb) {
    for (const dx of [-1600, 0, 1600]) {
      const gr = g.createRadialGradient(x + dx, y, 0, x + dx, y, rad);
      gr.addColorStop(0, c + '55'); gr.addColorStop(0.5, c + '22'); gr.addColorStop(1, c + '00');
      g.fillStyle = gr; g.fillRect(0, 0, sf.width, H);
    }
  }
  for (let i = 0; i < 420; i++) {
    const x = r() * sf.width, y = r() * H, s = r() < 0.08 ? 2 : 1, a = 0.3 + r() * 0.7;
    g.fillStyle = `rgba(${200 + r() * 55 | 0},${200 + r() * 55 | 0},255,${a})`;
    g.fillRect(x | 0, y | 0, s, s);
  }
  BG.stars = sf;

  // twinkling bright stars, drawn live
  BG.twinkles = Array.from({ length: 40 }, () => ({ x: r() * 1600, y: r() * 330, p: r() * 6.28, s: 1 + r() * 2 }));

  // citadel banner art from the sheet, faded at the edges
  const src = A.img.bg_citadel, sc = 1.4;
  const cd = document.createElement('canvas'); cd.width = src.width * sc; cd.height = src.height * sc;
  const cg = cd.getContext('2d');
  cg.imageSmoothingEnabled = false;
  cg.drawImage(src, 0, 0, cd.width, cd.height);
  cg.globalCompositeOperation = 'destination-in';
  const mx = cg.createLinearGradient(0, 0, cd.width, 0);
  mx.addColorStop(0, 'rgba(0,0,0,0)'); mx.addColorStop(0.18, 'rgba(0,0,0,1)');
  mx.addColorStop(0.82, 'rgba(0,0,0,1)'); mx.addColorStop(1, 'rgba(0,0,0,0)');
  cg.fillStyle = mx; cg.fillRect(0, 0, cd.width, cd.height);
  const my = cg.createLinearGradient(0, 0, 0, cd.height);
  my.addColorStop(0, 'rgba(0,0,0,0)'); my.addColorStop(0.3, 'rgba(0,0,0,1)'); my.addColorStop(1, 'rgba(0,0,0,1)');
  cg.fillStyle = my; cg.fillRect(0, 0, cd.width, cd.height);
  BG.citadel = cd;

  // mid-layer spires, deterministic
  const r2 = seeded(1922);
  BG.spires = [];
  for (let x = 0; x < LEVEL_W * 0.6 + W; x += 140 + r2() * 200) {
    BG.spires.push({ x, w: 30 + r2() * 70, h: 80 + r2() * 190, tip: r2() < 0.5, lights: 2 + (r2() * 5 | 0), hue: r2() < 0.5 ? '#7a4dff' : '#2ad4ff' });
  }
}

function drawPlanet(t, px, py, rad) {
  // Miu: tidally locked - burning day side, frozen night side, glowing terminator band
  ctx.save();
  const gl = ctx.createRadialGradient(px, py, rad * 0.9, px, py, rad * 1.5);
  gl.addColorStop(0, 'rgba(160,90,255,0.35)'); gl.addColorStop(1, 'rgba(160,90,255,0)');
  ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(px, py, rad * 1.5, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(px, py, rad, 0, 7); ctx.clip();
  const body = ctx.createLinearGradient(px - rad, py - rad, px + rad, py + rad);
  body.addColorStop(0, '#ffb35a'); body.addColorStop(0.38, '#d2551f');
  body.addColorStop(0.5, '#ff7ad9'); body.addColorStop(0.53, '#6a3cff');
  body.addColorStop(0.7, '#1a1d5a'); body.addColorStop(1, '#070818');
  ctx.fillStyle = body; ctx.fillRect(px - rad, py - rad, rad * 2, rad * 2);
  // faint latitude bands
  ctx.globalAlpha = 0.12; ctx.fillStyle = '#000';
  for (let i = -3; i <= 3; i += 2) ctx.fillRect(px - rad, py + i * rad * 0.22, rad * 2, rad * 0.1);
  ctx.restore();
}

function drawSky(camX, t) {
  const off = -(camX * 0.06) % 1600;
  ctx.drawImage(BG.stars, off, 0); ctx.drawImage(BG.stars, off + 1600, 0);
  for (const s of BG.twinkles) {
    const x = ((s.x - camX * 0.08) % 1600 + 1600) % 1600;
    if (x > W) continue;
    const a = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.3 + s.p));
    ctx.fillStyle = `rgba(210,220,255,${a})`;
    ctx.fillRect(x, s.y, s.s, s.s);
    if (s.s > 2) { ctx.fillRect(x - 3, s.y + 1, 7, 1); ctx.fillRect(x + 1, s.y - 3, 1, 7); }
  }
  drawPlanet(t, 820 - camX * 0.03, 150, 56);
}

function drawCitadelLayer(camX) {
  const img = BG.citadel, spacing = 1500;
  const px = camX * 0.22;
  const first = Math.floor((px - img.width) / spacing);
  for (let i = first; i <= first + 3; i++) {
    const x = i * spacing - px + 80;
    if (x > W || x + img.width < 0) continue;
    ctx.globalAlpha = 0.42;
    ctx.drawImage(img, x, FLOOR_TOP - img.height + 20);
  }
  ctx.globalAlpha = 1;
}

function drawSpires(camX, t) {
  const px = camX * 0.55;
  for (const s of BG.spires) {
    const x = s.x - px;
    if (x + s.w < -20 || x > W + 20) continue;
    const base = FLOOR_TOP + 4;
    ctx.fillStyle = '#080618';
    ctx.beginPath();
    ctx.moveTo(x, base); ctx.lineTo(x, base - s.h);
    if (s.tip) ctx.lineTo(x + s.w / 2, base - s.h - 50);
    ctx.lineTo(x + s.w, base - s.h); ctx.lineTo(x + s.w, base); ctx.fill();
    ctx.strokeStyle = s.hue; ctx.globalAlpha = 0.5; ctx.lineWidth = 1; ctx.stroke();
    for (let i = 0; i < s.lights; i++) {
      const on = Math.sin(t * 2 + s.x * 0.1 + i) > -0.3;
      ctx.globalAlpha = on ? 0.9 : 0.2;
      ctx.fillStyle = s.hue;
      ctx.fillRect(x + s.w * 0.3, base - s.h + 18 + i * 22, s.w * 0.4, 3);
    }
    ctx.globalAlpha = 1;
  }
}

function drawFloor(camX, t) {
  const g = ctx.createLinearGradient(0, FLOOR_TOP - 8, 0, H);
  g.addColorStop(0, '#1a1045'); g.addColorStop(0.08, '#0c0a24'); g.addColorStop(1, '#05040f');
  ctx.fillStyle = g; ctx.fillRect(0, FLOOR_TOP - 8, W, H - FLOOR_TOP + 8);
  // horizon glow
  const hg = ctx.createLinearGradient(0, FLOOR_TOP - 30, 0, FLOOR_TOP + 6);
  hg.addColorStop(0, 'rgba(140,80,255,0)'); hg.addColorStop(1, 'rgba(140,80,255,0.45)');
  ctx.fillStyle = hg; ctx.fillRect(0, FLOOR_TOP - 30, W, 36);
  ctx.fillStyle = '#b48cff'; ctx.fillRect(0, FLOOR_TOP - 8, W, 2);
  // perspective deck lines
  ctx.save();
  ctx.strokeStyle = 'rgba(90,120,255,0.18)'; ctx.lineWidth = 1;
  const cx = W / 2, sp = 110;
  for (let k = Math.floor((camX - 400) / sp); k < (camX + W + 400) / sp; k++) {
    const xt = k * sp - camX;
    ctx.beginPath(); ctx.moveTo(xt, FLOOR_TOP - 6); ctx.lineTo(cx + (xt - cx) * 1.9, H); ctx.stroke();
  }
  for (let i = 1; i < 7; i++) {
    const y = FLOOR_TOP - 6 + Math.pow(i / 6, 1.5) * (H - FLOOR_TOP + 6);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  // glowing conduit running along the deck
  const pulse = (t * 300) % 400;
  ctx.strokeStyle = 'rgba(42,212,255,0.35)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, FLOOR_BOT + 6); ctx.lineTo(W, FLOOR_BOT + 6); ctx.stroke();
  ctx.fillStyle = 'rgba(160,240,255,0.8)';
  for (let x = -((camX - pulse) % 400); x < W; x += 400) ctx.fillRect(x, FLOOR_BOT + 5, 30, 3);
  ctx.restore();
}

// ---------------------------------------------------------------- fx
function spawnFx(f) { S.fx.push({ t: 0, ...f }); return f; }

function sparks(x, y, n, color, speed = 260) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), s = rand(speed * 0.3, speed);
    spawnFx({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 80, life: rand(0.25, 0.5), color, size: rand(2, 4) });
  }
}

function hitSpark(x, y, big) {
  spawnFx({ kind: 'sprite', img: A.img.fx_star, x, y, scale: big ? 0.9 : 0.55, scaleTo: 0.1, rot: rand(0, 3), life: 0.22, add: true });
  sparks(x, y, big ? 14 : 7, pick(['#e6b8ff', '#8fe9ff', '#ffffff']));
}

function ring(x, y, r0, r1, life, color, width = 4) {
  spawnFx({ kind: 'ring', x, y, r0, r1, life, color, width });
}

function popText(x, y, str, color = '#fff', size = 12) {
  spawnFx({ kind: 'text', x, y, str, color, size, life: 0.8 });
}

function updateFx(dt) {
  for (const f of S.fx) {
    f.t += dt;
    if (f.kind === 'spark') { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 700 * dt; f.vx *= 0.96; }
    if (f.kind === 'text') f.y -= 40 * dt;
    if (f.vr) f.rot += f.vr * dt;
  }
  S.fx = S.fx.filter(f => f.t < f.life);
}

function drawFx(camX) {
  for (const f of S.fx) {
    const k = f.t / f.life, x = f.x - camX;
    if (f.kind === 'spark') {
      ctx.globalAlpha = 1 - k; ctx.fillStyle = f.color;
      ctx.fillRect(x, f.y, f.size, f.size);
    } else if (f.kind === 'sprite') {
      const sc = f.scale + ((f.scaleTo ?? f.scale) - f.scale) * k;
      drawImg(f.img, x, f.y, sc, { rot: f.rot, alpha: (f.alpha ?? 1) * (1 - k * k), add: f.add, flip: f.flip, filter: f.filter });
    } else if (f.kind === 'ring') {
      const r = f.r0 + (f.r1 - f.r0) * (1 - (1 - k) * (1 - k));
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 1 - k; ctx.strokeStyle = f.color; ctx.lineWidth = f.width * (1 - k) + 1;
      ctx.beginPath(); ctx.ellipse(x, f.y, r, r * 0.32, 0, 0, 7); ctx.stroke();
      ctx.restore();
    } else if (f.kind === 'text') {
      text(f.str, x, f.y, { size: f.size, color: f.color, align: 'center', alpha: 1 - k * k, stroke: '#12002a', strokeW: 4 });
    }
    ctx.globalAlpha = 1;
  }
}

function shake(n) { S.shake = Math.max(S.shake, n); }

// ---------------------------------------------------------------- actors
class Actor {
  constructor(x, y, variant, scale) {
    Object.assign(this, { x, y, z: 0, vx: 0, vy: 0, vz: 0, face: 1, variant, scale, flash: 0, invuln: 0, st: 0, dead: false, remove: false });
    this.hitList = new Set();
  }
  play(name, from = 0, to = null, fps = null, loop = null) {
    const a = A.anims[this.variant][name];
    Object.assign(this, { a, animName: name, from, to: to ?? a.frames - 1, fps: fps ?? a.fps, loop: loop ?? a.loop, animT: 0, frame: from });
  }
  playIf(name, ...rest) { if (this.animName !== name) this.play(name, ...rest); }
  get animDone() { return !this.loop && this.animT * this.fps >= this.to - this.from + 1; }
  stepAnim(dt) {
    this.animT += dt;
    const n = this.to - this.from + 1;
    let i = Math.floor(this.animT * this.fps);
    i = this.loop ? i % n : Math.min(i, n - 1);
    this.frame = this.from + i;
  }
  setState(s) { this.state = s; this.st = 0; }
  physics(dt) {
    this.x += this.vx * dt; this.y += this.vy * dt;
    if (this.z > 0 || this.vz > 0) {
      this.z += this.vz * dt; this.vz -= GRAV * dt;
      if (this.z <= 0) { this.z = 0; const v = this.vz; this.vz = 0; this.onLand && this.onLand(v); }
    }
    this.y = clamp(this.y, FLOOR_TOP + 8, FLOOR_BOT);
  }
  drawShadow(camX) {
    const k = clamp(1 - this.z / 400, 0.4, 1), rx = 30 * this.scale * k;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.ellipse(this.x - camX, this.y, rx, rx * 0.26, 0, 0, 7); ctx.fill();
  }
  get bodyH() { return 60 * this.scale; }
}

function inBox(att, t, near, far, depth, zTol = 90) {
  const dx = (t.x - att.x) * att.face;
  return dx >= near && dx <= far && Math.abs(t.y - att.y) <= depth && Math.abs(t.z - att.z) <= zTol;
}

// ---------------------------------------------------------------- player: Grimalkin the Ninefold
const PMOVES = [
  { anim: 'claw', from: 0, to: 3, fps: 22, active: [1, 2], near: -20, far: 120, depth: 36, dmg: 8, kb: 110, stun: 0.34, lunge: 110 },
  { anim: 'claw', from: 4, to: 7, fps: 22, active: [5, 6], near: -20, far: 125, depth: 36, dmg: 9, kb: 140, stun: 0.36, lunge: 110 },
  { anim: 'jump', from: 1, to: 3, fps: 11, active: [2, 3], near: -10, far: 150, depth: 42, dmg: 16, kb: 380, kz: 420, knock: true, stun: 0.5, lunge: 460, hop: 240 },
];
const ROAR_COST = 35, BREATH_COST = 60;

class Player extends Actor {
  constructor(x, y) {
    super(x, y, 'boss', 1.7);
    Object.assign(this, { hp: 100, maxHp: 100, energy: 50, lives: 9, combo: 0, queued: false, beamT: 0, beamTick: 0, roared: false, portrait: 'normal', portraitT: 0 });
    this.setState('idle'); this.play('idle');
  }

  get busy() { return !['idle', 'walk'].includes(this.state); }

  update(dt) {
    this.st += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.flash = Math.max(0, this.flash - dt);
    this.portraitT = Math.max(0, this.portraitT - dt);
    if (!['breath', 'roar', 'dying', 'revive'].includes(this.state)) this.energy = Math.min(100, this.energy + 2.5 * dt);
    const P = input.pressed, Hd = input.held;

    switch (this.state) {
      case 'idle': case 'walk': {
        const mx = (Hd.right ? 1 : 0) - (Hd.left ? 1 : 0), my = (Hd.down ? 1 : 0) - (Hd.up ? 1 : 0);
        this.vx = mx * 240; this.vy = my * 160;
        if (mx) this.face = mx;
        const s = mx || my ? 'walk' : 'idle';
        if (s !== this.state) { this.setState(s); this.play(s === 'walk' ? 'run' : 'idle'); }
        if (P.attack) this.startAttack(0);
        else if (P.jump) this.startJump();
        else if (P.roar) this.startRoar();
        else if (P.breath) this.startBreath();
        break;
      }
      case 'attack': {
        const m = PMOVES[this.combo];
        this.vx *= 0.82;
        if (P.attack && this.st > 0.04) this.queued = true;
        if (this.frame >= m.active[0] && this.frame <= m.active[1]) this.strike(m);
        if (this.animDone) {
          if (this.queued && this.combo < 2) this.startAttack(this.combo + 1);
          else { this.setState('recover'); this.play('idle'); }
        }
        break;
      }
      case 'recover':
        this.vx *= 0.8;
        if (P.attack) this.startAttack(0);
        else if (this.st > (this.combo === 2 ? 0.22 : 0.08)) this.setState('idle');
        break;
      case 'jump': {
        const mx = (Hd.right ? 1 : 0) - (Hd.left ? 1 : 0);
        this.vx = mx * 230; if (mx) this.face = mx;
        if (P.attack) {
          this.setState('dive'); this.hitList.clear();
          this.vx = this.face * 480; this.vz = Math.min(this.vz, 60) - 260;
          Sfx.play('swipe');
        }
        break;
      }
      case 'dive':
        this.strike({ near: -20, far: 130, depth: 44, dmg: 14, kb: 300, kz: 380, knock: true, stun: 0.5, zTol: 160 });
        break;
      case 'land':
        this.vx *= 0.7; this.vy = 0;
        if (this.animDone) this.setState('idle'), this.play('idle');
        break;
      case 'roar':
        this.vx = 0; this.vy = 0;
        if (this.frame >= 5 && !this.roared) { this.roared = true; this.roarBlast(260, 14); }
        if (this.animDone) { this.setState('idle'); this.play('idle'); }
        break;
      case 'breath':
        this.vx = 0; this.vy = 0;
        if (this.animDone && this.beamT <= 0 && this.st < 1) { this.beamT = 1.15; Sfx.play('beam'); }
        if (this.beamT > 0) {
          this.beamT -= dt; this.beamTick -= dt;
          if (this.beamTick <= 0) { this.beamTick = 0.09; this.beamDamage(); }
          if (this.beamT <= 0) { this.setState('idle'); this.play('idle'); }
        }
        break;
      case 'hurt':
        this.vx *= 0.85;
        if (this.st > 0.32) { this.setState('idle'); this.play('idle'); }
        break;
      case 'knocked':
        break;
      case 'down':
        this.vx = 0;
        if (this.st > 0.55) { this.setState('idle'); this.play('idle'); this.invuln = 1.0; }
        break;
      case 'dying':
        this.vx *= 0.9;
        if (this.animDone && this.st > 1.6) this.loseLife();
        break;
      case 'revive':
        if (this.st > 0.9) { this.setState('idle'); this.play('idle'); }
        break;
    }

    this.physics(dt);
    this.x = clamp(this.x, S.camX + 40, S.camX + W - 40);
    this.stepAnim(dt);
    if (this.state === 'jump') this.frame = this.vz > 180 ? 1 : this.vz > -150 ? 2 : 3;
    else if (this.state === 'dive') this.frame = 3;
  }

  startAttack(i) {
    const m = PMOVES[i];
    this.combo = i; this.queued = false; this.hitList.clear();
    this.setState('attack'); this.play(m.anim, m.from, m.to, m.fps, false);
    this.vx = this.face * m.lunge; this.vy = 0;
    if (m.hop) { this.vz = m.hop; this.z = 0.1; }
    Sfx.play('swipe');
    if (i === 2) spawnFx({ kind: 'sprite', img: A.img.fx_slash, x: this.x + this.face * 90, y: this.y - 80, scale: 1.3, scaleTo: 1.7, life: 0.25, add: true, flip: this.face < 0 });
  }

  startJump() {
    this.setState('jump'); this.play('jump', 1, 1, 1, false);
    this.vz = 540; this.z = 0.1; this.hitList.clear();
    Sfx.play('jump');
  }

  onLand() {
    if (['jump', 'dive'].includes(this.state)) {
      if (this.state === 'dive') {
        shake(8); ring(this.x, this.y, 20, 150, 0.35, '#b77bff', 5);
        this.blast(150, 6, 260, 300);
      }
      Sfx.play('land');
      this.setState('land'); this.play('jump', 4, 6, 20, false);
    } else if (this.state === 'knocked') {
      this.setState('down'); this.play('death', 2, 2, 1, false);
      shake(5); Sfx.play('land');
    } else if (this.state === 'attack') {
      this.vx *= 0.5;
    }
  }

  startRoar() {
    if (this.energy < ROAR_COST) { Sfx.play('fizzle'); S.meterFlash = 0.4; return; }
    this.energy -= ROAR_COST; this.roared = false;
    this.setState('roar'); this.play('roar', 0, 7, 12, false);
    this.portrait = 'roar'; this.portraitT = 1;
    Sfx.play('roar');
  }

  startBreath() {
    if (this.energy < BREATH_COST) { Sfx.play('fizzle'); S.meterFlash = 0.4; return; }
    this.energy -= BREATH_COST; this.beamT = 0; this.beamTick = 0;
    this.setState('breath'); this.play('special', 0, 3, 8, false);
    this.portrait = 'angry'; this.portraitT = 1.8;
    Sfx.play('charge');
  }

  get mouth() {
    const a = A.anims.boss.special, s = this.scale;
    return { x: this.x + this.face * 22 * s, y: this.y - this.z - ((a.h - a.foot) - 57) * s };
  }

  strike(m) {
    let n = 0;
    for (const e of S.enemies) {
      if (!e.hittable || this.hitList.has(e)) continue;
      if (!inBox(this, e, m.near, m.far, m.depth, m.zTol ?? 90)) continue;
      this.hitList.add(e);
      e.takeHit(m.dmg, this.face * m.kb, m.kz || 0, m.stun, !!m.knock, this);
      landedHit(e, m.dmg, m.knock);
      n++;
    }
    if (n) { S.hitstop = m.knock ? 0.09 : 0.05; Sfx.play(m.knock ? 'heavy' : 'hit'); }
    return n;
  }

  blast(radius, dmg, kb, kz) {
    for (const e of S.enemies) {
      if (!e.hittable) continue;
      const dx = e.x - this.x, dy = (e.y - this.y) * 2.2;
      if (dx * dx + dy * dy > radius * radius) continue;
      const dir = dx >= 0 ? 1 : -1;
      e.takeHit(dmg, dir * kb, kz, 0.5, true, this);
      landedHit(e, dmg, true);
    }
  }

  roarBlast(radius, dmg) {
    shake(14); S.flash = 0.25;
    ring(this.x, this.y, 30, radius * 1.1, 0.5, '#c28bff', 8);
    ring(this.x, this.y, 10, radius * 0.8, 0.4, '#5fe0ff', 5);
    spawnFx({ kind: 'sprite', img: A.img.fx_orb, x: this.x + this.face * 30, y: this.y - 110, scale: 0.6, scaleTo: 2.6, life: 0.45, add: true });
    this.blast(radius, dmg, 460, 360);
    for (const pr of S.projectiles) {
      const dx = pr.x - this.x, dy = (pr.y - this.y) * 2.2;
      if (dx * dx + dy * dy < radius * radius) pr.dead = true, hitSpark(pr.x, pr.y - pr.z, false);
    }
  }

  beamDamage() {
    const L = 820, m = this.mouth;
    Sfx.play('zap');
    let n = 0;
    for (const e of S.enemies) {
      if (!e.hittable) continue;
      const dx = (e.x - this.x) * this.face;
      if (dx < 10 || dx > L || Math.abs(e.y - this.y) > 42) continue;
      e.takeHit(4, this.face * 60, 0, 0.2, false, this);
      landedHit(e, 4, false, true);
      n++;
    }
    for (const pr of S.projectiles) {
      const dx = (pr.x - this.x) * this.face;
      if (dx > 0 && dx < L && Math.abs(pr.y - this.y) < 50) pr.dead = true;
    }
    shake(n ? 4 : 2);
    spawnFx({ kind: 'sprite', img: A.img.fx_bolt, x: m.x + this.face * rand(80, L - 60), y: m.y + rand(-20, 20), scale: rand(0.5, 0.9), life: 0.12, add: true, rot: rand(-0.6, 0.6) });
  }

  takeHit(dmg, kbx, kz, stun, knock) {
    if (this.invuln > 0 || ['dying', 'revive'].includes(this.state)) return false;
    if (['roar', 'breath'].includes(this.state)) {           // super armor
      this.hp -= dmg * 0.5; this.flash = 0.1;
      if (this.hp <= 0) this.die();
      return true;
    }
    this.hp -= dmg; this.flash = 0.15; this.beamT = 0;
    this.portrait = 'hurt'; this.portraitT = 0.8;
    Sfx.play('hurt'); shake(knock ? 9 : 5);
    S.combo = 0;
    if (this.hp <= 0) { this.die(); return true; }
    if (knock) {
      this.setState('knocked'); this.play('death', 0, 2, 10, false);
      this.vx = kbx; this.vy = 0; this.vz = kz || 320; this.z = Math.max(this.z, 0.1);
      this.invuln = 0.9;
    } else {
      this.setState('hurt'); this.play('hit', 0, 4, 15, false);
      this.vx = kbx; this.vy = 0; this.invuln = 0.4;
    }
    return true;
  }

  die() {
    this.hp = 0; this.setState('dying'); this.play('death', 0, 7, 7, false);
    this.vy = 0; this.vz = Math.max(this.vz, 0); this.portrait = 'death'; this.portraitT = 99;
    Sfx.play('heavy'); shake(12); S.hitstop = 0.2;
    for (const e of S.enemies) e.release && e.release();
  }

  loseLife() {
    this.lives--;
    if (this.lives <= 0) { toScene('gameover'); return; }
    this.hp = this.maxHp; this.energy = 100; this.invuln = 2.6;
    this.setState('revive'); this.play('roar', 3, 7, 10, false);
    this.portrait = 'roar'; this.portraitT = 1.5;
    S.flash = 0.6; shake(16); Sfx.play('life');
    banner(`NINEFOLD RETURN`, `LIFE ${10 - this.lives} OF 9 CONSUMED`, 2.2, '#ff7ae0');
    ring(this.x, this.y, 20, 420, 0.7, '#ff9af0', 10);
    spawnFx({ kind: 'sprite', img: A.img.crownfire, x: this.x, y: this.y - 230, scale: 0.4, scaleTo: 1.2, life: 1.2, add: true });
    this.blast(420, 20, 520, 420);
  }

  get hittable() { return !['dying', 'revive'].includes(this.state) && this.invuln <= 0; }

  draw(camX) {
    const blink = this.invuln > 0 && ['idle', 'walk', 'recover', 'attack', 'jump', 'land'].includes(this.state) && Math.floor(S.time * 20) % 2;
    const alpha = this.state === 'dying' && this.animDone ? Math.max(0, 1 - (this.st - 0.9) / 0.6) : blink ? 0.45 : 1;
    const x = this.x - camX, y = this.y - this.z;
    if (this.state === 'breath' || this.state === 'roar') {
      // crackling static aura while channeling
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const gr = ctx.createRadialGradient(x, y - 80, 10, x, y - 80, 150);
      gr.addColorStop(0, 'rgba(150,90,255,0.35)'); gr.addColorStop(1, 'rgba(150,90,255,0)');
      ctx.fillStyle = gr; ctx.fillRect(x - 150, y - 230, 300, 300); ctx.restore();
    }
    drawFrame(this.a, this.frame, x, y, this.scale, this.face < 0, { white: this.flash * 8, alpha });
    if (this.state === 'breath' && this.beamT > 0) this.drawBeam(camX);
  }

  drawBeam(camX) {
    const m = this.mouth, L = 820, f = this.face;
    const k = Math.min(1, (1.15 - this.beamT) / 0.1) * Math.min(1, this.beamT / 0.15);
    const x0 = m.x - camX, y0 = m.y, x1 = x0 + f * L;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const band = (w, color, a) => { ctx.globalAlpha = a; ctx.fillStyle = color; ctx.fillRect(Math.min(x0, x1), y0 - w / 2, L, w); };
    band(46 * k + Math.sin(S.time * 60) * 4, '#5b1fd6', 0.35);
    band(22 * k, '#b36bff', 0.6);
    band(8 * k, '#ffffff', 0.9);
    for (let j = 0; j < 3; j++) {
      ctx.globalAlpha = 0.8; ctx.strokeStyle = j ? '#8fe9ff' : '#e0b3ff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x0, y0);
      for (let d = 30; d <= L; d += 30) ctx.lineTo(x0 + f * d, y0 + rand(-18, 18) * k);
      ctx.stroke();
    }
    ctx.restore();
    drawImg(A.img.fx_orb, x0, y0, 0.55 * k + 0.1, { rot: S.time * 8, add: true });
    drawImg(A.img.fx_star, x1, y0, 0.8 * k, { rot: -S.time * 5, add: true });
  }
}

function landedHit(e, dmg, heavy, quiet) {
  S.combo++; S.comboT = 1.8;
  S.score += Math.round(dmg * 10 * (1 + Math.min(S.combo, 50) / 10));
  S.player.energy = Math.min(100, S.player.energy + (quiet ? 0.5 : 4));
  const hy = e.y - e.z - e.bodyH * 0.7;
  if (!quiet || Math.random() < 0.3) hitSpark(e.x + rand(-10, 10), hy, heavy);
  popText(e.x + rand(-14, 14), hy - 20, String(dmg), heavy ? '#ff9af0' : '#ffffff', heavy ? 16 : 12);
  shake(heavy ? 7 : 3);
}

// ---------------------------------------------------------------- enemies
const ETYPES = {
  thrall:  { hp: 26, speed: 115, range: 78, hover: 220, dmg: 7, windup: 0.5, cd: [1.2, 2.4], score: 100, scale: 1.6 },
  solar:   { hp: 44, speed: 165, range: 98, hover: 260, dmg: 9, windup: 0.38, cd: [1.0, 2.0], score: 250, scale: 1.05 },
  void:    { hp: 34, speed: 235, range: 92, hover: 200, dmg: 8, windup: 0.26, cd: [0.8, 1.6], score: 300, scale: 1.0 },
  boss:    { hp: 620, speed: 120, range: 150, hover: 150, dmg: 12, windup: 0.4, cd: [0.6, 1.3], score: 5000, scale: 1.95 },
};
const VARIANT = { thrall: 'boss', solar: 'solar', void: 'void', boss: 'crimson' };

class Enemy extends Actor {
  constructor(type, x, y) {
    const T = ETYPES[type];
    super(x, y, VARIANT[type], T.scale);
    Object.assign(this, { type, T, hp: T.hp, maxHp: T.hp, engaged: false, cd: rand(0.5, 1.5), yoff: rand(-40, 40), alpha: 1, poise: 0, phase: 1, act: null, fired: false });
    this.face = x < S.player.x ? 1 : -1;
    this.setState('approach');
    if (type !== 'thrall') this.play('run');
  }

  get hittable() { return !this.dead && !['down', 'blink', 'dying'].includes(this.state) && this.invuln <= 0 && this.alpha > 0.5; }
  get bodyH() { return this.type === 'thrall' ? 60 * this.scale : 64 * this.scale; }

  release() { if (this.engaged) { this.engaged = false; S.tokens++; } }

  update(dt) {
    this.st += dt;
    this.flash = Math.max(0, this.flash - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.cd -= dt;
    const p = S.player, T = this.T;
    const pAlive = !['dying', 'revive'].includes(p.state);

    switch (this.state) {
      case 'approach': this.approach(dt, p, pAlive); break;
      case 'windup':
        this.vx = 0; this.vy = 0;
        if (this.st > T.windup) this.startStrike();
        break;
      case 'strike': {
        this.vx *= 0.85;
        const active = this.type === 'thrall' ? this.st > 0.06 && this.st < 0.2 : this.frame >= 3 && this.frame <= 5;
        if (active && !this.hitList.has(p) && p.hittable && inBox(this, p, -10, T.range + 20, 30, 70)) {
          this.hitList.add(p);
          if (p.takeHit(T.dmg, this.face * 180, 0, 0.3, false)) hitSpark(p.x, p.y - 100, false);
        }
        const done = this.type === 'thrall' ? this.st > 0.4 : this.animDone;
        if (done) this.endAttack();
        break;
      }
      case 'pounce':
        if (!this.hitList.has(p) && p.hittable && Math.abs(p.x - this.x) < 70 && Math.abs(p.y - this.y) < 34 && this.z < 60) {
          this.hitList.add(p);
          p.takeHit(this.type === 'boss' ? 16 : 11, this.face * 300, 320, 0.4, true);
        }
        break;
      case 'land':
        this.vx *= 0.7; this.vy = 0;
        if (this.animDone) this.endAttack();
        break;
      case 'recover':
        this.vx *= 0.8; this.vy = 0;
        if (this.st > (this.type === 'boss' ? 0.35 : 0.45)) { this.setState('approach'); }
        break;
      case 'hurt':
        this.vx *= 0.86;
        if (this.st > this.stun) {
          if (this.blinkNext) { this.blinkNext = false; this.startBlink(); }
          else this.setState('approach');
        }
        break;
      case 'knocked': break;
      case 'down':
        this.vx = 0;
        if (this.st > (this.type === 'boss' ? 0.4 : 0.75)) { this.invuln = 0.35; this.setState('approach'); }
        break;
      case 'blink':
        this.alpha = this.st < 0.18 ? 1 - this.st / 0.18 : Math.min(1, (this.st - 0.3) / 0.15);
        if (this.st > 0.18 && !this.blinked) {
          this.blinked = true;
          sparks(this.x, this.y - 60, 8, '#6bffb0');
          this.x = clamp(p.x - p.face * 95, S.camX + 40, S.camX + W - 40); this.y = p.y;
          this.face = p.x > this.x ? 1 : -1;
          sparks(this.x, this.y - 60, 8, '#6bffb0'); Sfx.play('blink');
        }
        if (this.st > 0.45) {
          this.alpha = 1;
          if (!this.engaged && S.tokens > 0) { S.tokens--; this.engaged = true; }
          this.startWindup();
        }
        break;
      case 'roar':
        this.vx = 0; this.vy = 0;
        if (this.frame >= 5 && !this.fired) {
          this.fired = true; shake(12);
          ring(this.x, this.y, 30, 300, 0.5, '#ff5a6e', 8);
          const dx = p.x - this.x, dy = (p.y - this.y) * 2.2;
          if (dx * dx + dy * dy < 260 * 260) p.takeHit(14, (dx >= 0 ? 1 : -1) * 420, 360, 0.4, true);
        }
        if (this.animDone) this.endAttack();
        break;
      case 'cast':
        this.vx = 0; this.vy = 0;
        if (this.animDone && !this.fired) {
          this.fired = true; Sfx.play('fireball');
          const lanes = this.phase > 1 ? [-60, -20, 20, 60] : [-45, 0, 45];
          for (const off of lanes) {
            S.projectiles.push({ x: this.x + this.face * 90, y: clamp(p.y + off, FLOOR_TOP + 10, FLOOR_BOT), z: 95, vx: this.face * (320 + rand(0, 60)), dmg: 10, life: 3.5, face: this.face });
          }
        }
        if (this.st > 0.9) this.endAttack();
        break;
      case 'dying':
        if (this.z <= 0) {
          this.vx *= 0.85;
          if (this.type !== 'thrall' && this.animName !== 'death') this.play('death', this.type === 'boss' ? 0 : 2, 7, this.type === 'boss' ? 4 : 10, false);
          const done = this.type === 'thrall' ? this.st > 0.9 : this.animDone;
          if (done) this.alpha -= dt * 2.2;
          if (this.alpha <= 0) this.remove = true;
          if (this.type === 'boss' && Math.random() < 0.3) sparks(this.x + rand(-80, 80), this.y - rand(20, 200), 3, pick(['#ff5a6e', '#ffb35a', '#ffffff']), 200);
        }
        break;
    }

    this.physics(dt);
    if (this.state !== 'dying') this.x = clamp(this.x, S.camX - 140, S.camX + W + 140);
    if (this.type !== 'thrall') this.stepAnim(dt);
    if (this.state === 'pounce' && this.z > 0) this.frame = this.vz > 150 ? 1 : this.vz > -150 ? 2 : 3;
  }

  approach(dt, p, pAlive) {
    const T = this.T, dx = p.x - this.x, dy = p.y - this.y;
    this.face = dx >= 0 ? 1 : -1;
    if (!pAlive) this.release();
    if (this.type === 'boss') return this.bossThink(dt, p, dx, dy);

    if (!this.engaged && this.cd <= 0 && S.tokens > 0 && pAlive) { this.engaged = true; S.tokens--; }
    let tx, ty;
    if (this.engaged) { tx = p.x - this.face * T.range * 0.75; ty = p.y; }
    else { tx = p.x - this.face * T.hover; ty = clamp(p.y + this.yoff, FLOOR_TOP + 10, FLOOR_BOT); }
    const mx = tx - this.x, my = ty - this.y, dist = Math.hypot(mx, my);
    const sp = T.speed * (this.engaged ? 1 : 0.75);
    if (dist > 8) { this.vx = mx / dist * sp; this.vy = my / dist * sp * 0.7; } else { this.vx = 0; this.vy = 0; }
    if (this.type !== 'thrall') {
      if (Math.abs(this.vx) + Math.abs(this.vy) > 30) this.playIf('run'); else this.playIf('idle');
    }

    if (!this.engaged) return;
    // solar tabbies pounce from mid range
    if (this.type === 'solar' && Math.abs(dx) > 150 && Math.abs(dx) < 330 && Math.random() < dt * 1.2) return this.startPounce(p);
    if (this.type === 'void' && Math.abs(dx) > 260 && Math.random() < dt * 0.8) return this.startBlink();
    if (Math.abs(dx) < T.range && Math.abs(dy) < 18) this.startWindup();
  }

  bossThink(dt, p, dx, dy) {
    const T = this.T, adx = Math.abs(dx), fast = this.phase > 1 ? 1.3 : 1;
    if (this.cd > 0) {
      const tx = p.x - this.face * 170, ty = p.y;
      const mx = tx - this.x, my = ty - this.y, d = Math.hypot(mx, my);
      if (d > 12) { this.vx = mx / d * T.speed * fast; this.vy = my / d * T.speed * 0.7 * fast; this.playIf('run'); }
      else { this.vx = 0; this.vy = 0; this.playIf('idle'); }
      return;
    }
    if (['dying', 'revive'].includes(p.state)) { this.cd = 1; return; }
    const r = Math.random();
    if (adx < 210 && Math.abs(dy) < 40) {
      if (r < 0.3 * fast) this.startRoar();
      else { this.bossCombo = 0; this.startWindup(); }
    } else if (r < 0.5) this.startCast();
    else if (r < 0.8) this.startPounce(p);
    else this.cd = 0.8;
  }

  startWindup() {
    this.setState('windup'); this.vx = 0; this.vy = 0; this.hitList.clear();
    if (this.type !== 'thrall') this.play('claw', 0, 1, 5, false);
  }
  startStrike() {
    this.setState('strike'); this.hitList.clear();
    this.vx = this.face * (this.type === 'boss' ? 160 : 120);
    if (this.type !== 'thrall') this.play('claw', this.bossCombo === 1 ? 4 : 1, this.bossCombo === 1 ? 7 : 7, 18, false);
    Sfx.play('swipe');
  }
  startPounce(p) {
    this.setState('pounce'); this.play('jump', 1, 1, 1, false); this.hitList.clear();
    const air = 2 * 520 / GRAV;
    this.face = p.x >= this.x ? 1 : -1;
    this.vz = 520; this.z = 0.1;
    this.vx = clamp((p.x - this.x) / air, -620, 620);
    this.vy = clamp((p.y - this.y) / air, -200, 200);
    Sfx.play('jump');
  }
  startBlink() { this.setState('blink'); this.blinked = false; this.vx = 0; this.vy = 0; Sfx.play('blink'); }
  startRoar() { this.setState('roar'); this.fired = false; this.play('roar', 0, 7, 11, false); Sfx.play('roar'); banner(null, 'CRIMSON HISS!', 0.8, '#ff5a6e'); }
  startCast() { this.setState('cast'); this.fired = false; this.play('special', 0, 3, 6, false); Sfx.play('charge'); }

  endAttack() {
    if (this.type === 'boss' && this.state === 'strike' && this.bossCombo === 0) { this.bossCombo = 1; this.startWindup(); this.st = this.T.windup * 0.6; return; }
    this.release();
    this.cd = rand(...this.T.cd) / (this.phase > 1 ? 1.5 : 1);
    this.setState('recover');
    if (this.type !== 'thrall') this.play('idle');
  }

  onLand(v) {
    if (this.state === 'pounce') {
      this.setState('land'); this.play('jump', 4, 6, 18, false); Sfx.play('land');
      if (this.type === 'boss') { shake(10); ring(this.x, this.y, 20, 180, 0.4, '#ff5a6e', 6); }
    } else if (this.state === 'knocked') {
      this.setState('down'); shake(3);
      if (this.type !== 'thrall') this.play('death', 2, 2, 1, false);
    } else if (this.state === 'dying') {
      shake(4);
    }
  }

  takeHit(dmg, kbx, kz, stun, knock) {
    this.hp -= dmg; this.flash = 0.12;
    if (this.hp <= 0) return this.die(kbx);
    if (this.type === 'boss') {
      this.poise += dmg;
      if (this.hp < this.maxHp / 2 && this.phase === 1) this.enrage();
      if (this.poise < 70 && !(knock && kz > 400)) return;   // super armor
      this.poise = 0; knock = false; stun = 0.6; kbx *= 0.4;
    }
    this.release();
    this.fired = true;
    if (knock || this.z > 1) {
      this.setState('knocked'); this.vx = kbx; this.vy = 0; this.vz = kz || 260; this.z = Math.max(this.z, 1);
      if (this.type !== 'thrall') this.play('hit', 2, 2, 1, false);
    } else {
      this.setState('hurt'); this.stun = stun; this.vx = kbx; this.vy = 0;
      if (this.type !== 'thrall') this.play('hit', 0, 4, 14, false);
      if (this.type === 'void' && Math.random() < 0.3) this.blinkNext = true;
    }
  }

  enrage() {
    this.phase = 2; this.T = { ...this.T, speed: this.T.speed * 1.25 };
    banner('VERMILLIA IS ENRAGED', 'THE CRIMSON COURT SENDS REINFORCEMENTS', 2, '#ff5a6e');
    S.flash = 0.3; Sfx.play('roar');
    spawnEnemy('thrall', 'left'); spawnEnemy('thrall', 'right');
  }

  die(kbx) {
    this.dead = true; this.release();
    this.setState('dying'); this.vx = kbx * 1.2; this.vy = 0; this.vz = this.type === 'boss' ? 300 : 340; this.z = Math.max(this.z, 1);
    if (this.type !== 'thrall') this.play('hit', 2, 2, 1, false);
    Sfx.play('enemyDie');
    S.score += Math.round(this.T.score * (1 + Math.min(S.combo, 50) / 10));
    S.kills++;
    if (this.type === 'boss') {
      S.hitstop = 0.5; S.flash = 0.8; shake(20);
      banner('REGENT VERMILLIA FALLS', 'THE CROWN HOLDS', 3, '#ffd36b');
      S.endT = 4.2;
    } else {
      const r = Math.random();
      if (r < 0.22) S.pickups.push({ type: 'gem', x: this.x, y: this.y, z: 40, vz: 300, t: 0 });
      else if (r < 0.36) S.pickups.push({ type: 'star', x: this.x, y: this.y, z: 40, vz: 300, t: 0 });
    }
  }

  draw(camX) {
    const x = this.x - camX, y = this.y - this.z;
    let white = this.flash * 8;
    if (this.state === 'windup') white = Math.max(white, 0.35 + 0.35 * Math.sin(this.st * 40));
    const o = { white, alpha: this.alpha };
    if (this.type === 'thrall') {
      let rot = 0, bob = 0, sx = 1, ox = 0;
      if (this.state === 'approach' && Math.abs(this.vx) + Math.abs(this.vy) > 20) { bob = Math.abs(Math.sin(S.time * 14 + this.x)) * -5; }
      else if (this.state === 'windup') rot = -0.18 * this.face;
      else if (this.state === 'strike') { rot = 0.28 * this.face; ox = this.face * 14; }
      else if (this.state === 'hurt') ox = Math.sin(this.st * 80) * 3;
      else if (this.state === 'knocked' || this.state === 'dying') rot = -this.face * Math.min(1.5, (this.st + 0.2) * 4);
      else if (this.state === 'down') rot = -this.face * 1.5;
      ctx.save();
      ctx.translate(Math.round(x + ox), Math.round(y + bob));
      ctx.rotate(rot);
      ctx.scale(this.face < 0 ? -this.scale * sx : this.scale * sx, this.scale);
      ctx.globalAlpha = this.alpha;
      const img = A.img.human;
      ctx.drawImage(img, -img.width / 2, -img.height + 2);
      if (white > 0) { ctx.globalAlpha = Math.min(1, white) * this.alpha; ctx.drawImage(A.white.human, -img.width / 2, -img.height + 2); }
      ctx.restore();
      // the Treat Signal: a faint red point behind the eyes
      if (!this.dead) { ctx.fillStyle = `rgba(255,40,60,${0.5 + 0.5 * Math.sin(S.time * 6 + this.x)})`; ctx.fillRect(x + this.face * 4 - 1, y - 88 + bob, 3, 3); }
      return;
    }
    if (this.state === 'blink' && this.alpha < 1) {
      drawImg(A.img.fx_bolt, x, y - 70 * this.scale, 0.9, { add: true, alpha: 1 - this.alpha, filter: 'hue-rotate(-110deg)' });
    }
    drawFrame(this.a, this.frame, x, y, this.scale, this.face < 0, o);
    if (this.type === 'boss' && this.state === 'cast' && !this.fired) {
      drawImg(A.img.fx_orb, x + this.face * 70, y - 120, 0.3 + this.st * 0.5, { add: true, rot: S.time * 6, filter: 'hue-rotate(110deg)' });
    }
  }
}

// ---------------------------------------------------------------- projectiles & pickups
function updateProjectiles(dt) {
  const p = S.player;
  for (const pr of S.projectiles) {
    pr.x += pr.vx * dt; pr.life -= dt;
    if (Math.random() < 0.5) sparks(pr.x - pr.face * 30, pr.y - pr.z, 1, '#ff8a5a', 60);
    if (p.hittable && Math.abs(p.x - pr.x) < 42 && Math.abs(p.y - pr.y) < 24 && p.z < 90) {
      if (p.takeHit(pr.dmg, pr.face * 220, 280, 0.4, true)) { pr.dead = true; hitSpark(pr.x, pr.y - pr.z, true); }
    }
    if (pr.life <= 0 || pr.x < S.camX - 200 || pr.x > S.camX + W + 200) pr.dead = true;
  }
  S.projectiles = S.projectiles.filter(pr => !pr.dead);
}

function updatePickups(dt) {
  const p = S.player;
  for (const it of S.pickups) {
    it.t += dt;
    if (it.z > 0 || it.vz > 0) { it.z += it.vz * dt; it.vz -= GRAV * dt; if (it.z <= 0) { it.z = 0; it.vz = it.vz < -150 ? -it.vz * 0.4 : 0; } }
    if (it.t > 0.4 && Math.abs(p.x - it.x) < 50 && Math.abs(p.y - it.y) < 30 && !['dying', 'revive'].includes(p.state)) {
      it.taken = true;
      if (it.type === 'gem') { p.hp = Math.min(p.maxHp, p.hp + 30); popText(it.x, it.y - 120, 'NEBULA NIP +30', '#8fe9ff', 12); Sfx.play('pickup'); }
      else { p.energy = Math.min(100, p.energy + 45); popText(it.x, it.y - 120, 'STATIC +45', '#e0b3ff', 12); Sfx.play('power'); }
      sparks(it.x, it.y - 30, 12, it.type === 'gem' ? '#8fe9ff' : '#e0b3ff');
    }
  }
  S.pickups = S.pickups.filter(it => !it.taken && it.t < 14);
}

// ---------------------------------------------------------------- stage / waves
const WAVES = [
  { at: 380, name: 'WAVE 1', sub: 'THE CAN-OPENER THRALLS', groups: [['thrall', 'thrall', 'thrall'], ['thrall', 'thrall', 'thrall', 'thrall']] },
  { at: 1250, name: 'WAVE 2', sub: 'THE SOLAR TABBY LEGION', groups: [['solar', 'solar'], ['solar', 'thrall', 'thrall'], ['solar', 'solar', 'thrall']] },
  { at: 2200, name: 'WAVE 3', sub: 'THE VOID SIAMESE SYNDICATE', groups: [['void', 'void'], ['void', 'void', 'solar'], ['void', 'solar', 'thrall', 'thrall']] },
  { at: LEVEL_W - W, name: 'REGENT VERMILLIA', sub: 'OF THE CRIMSON PERSIAN COURT', boss: true, groups: [['boss']] },
];

let S = null;

function newStage() {
  S = {
    camX: 0, camMin: 0, lockX: null, time: 0,
    enemies: [], projectiles: [], pickups: [], fx: [],
    waveIdx: 0, waveActive: false, groupIdx: 0, groupDelay: 0,
    score: 0, kills: 0, combo: 0, comboT: 0, bestCombo: 0,
    hitstop: 0, shake: 0, flash: 0, meterFlash: 0, tokens: 2,
    banner: null, go: 0, boss: null, endT: 0, startT: 0,
  };
  S.player = new Player(180, 450);
  banner(LORE.stageName, 'DEFEND THE NINE-POINTED CROWN', 3, '#c9a2ff');
}

function banner(title, sub, dur, color = '#fff') { S.banner = { title, sub, dur, t: 0, color }; }

function spawnEnemy(type, side) {
  const fromLeft = side === 'left' || (side == null && Math.random() < 0.4);
  const x = fromLeft ? S.camX - 70 : S.camX + W + 70;
  const e = new Enemy(type, x, rand(FLOOR_TOP + 20, FLOOR_BOT - 10));
  S.enemies.push(e);
  if (type === 'boss') { S.boss = e; e.x = S.camX + W + 90; e.y = (FLOOR_TOP + FLOOR_BOT) / 2; e.cd = 2; }
  return e;
}

function spawnGroup() {
  const wave = WAVES[S.waveIdx], group = wave.groups[S.groupIdx];
  group.forEach((t, i) => spawnEnemy(t, i % 2 ? 'left' : 'right'));
}

function updateStage(dt) {
  if (S.hitstop > 0) { S.hitstop -= dt; return; }
  S.time += dt;
  S.shake = Math.max(0, S.shake - dt * 40);
  S.flash = Math.max(0, S.flash - dt * 2);
  S.meterFlash = Math.max(0, S.meterFlash - dt);
  if (S.banner) { S.banner.t += dt; if (S.banner.t > S.banner.dur) S.banner = null; }
  if (S.comboT > 0) { S.comboT -= dt; if (S.comboT <= 0) S.combo = 0; }
  S.bestCombo = Math.max(S.bestCombo, S.combo);

  S.player.update(dt);
  for (const e of S.enemies) e.update(dt);
  S.enemies = S.enemies.filter(e => !e.remove);
  updateProjectiles(dt);
  updatePickups(dt);
  updateFx(dt);

  // camera: follows forward only, locks during waves
  let target = clamp(S.player.x - W * 0.42, S.camMin, LEVEL_W - W);
  if (!S.waveActive && S.waveIdx < WAVES.length && target >= WAVES[S.waveIdx].at) {
    const wv = WAVES[S.waveIdx];
    S.lockX = wv.at; S.waveActive = true; S.groupIdx = 0; S.groupDelay = wv.boss ? 1.6 : 0.3;
    banner(wv.name, wv.sub, 2.2, wv.boss ? '#ff5a6e' : '#c9a2ff');
    Sfx.play('wave');
    if (wv.boss) Sfx.music(2, 124);
    S.spawnedGroup = false;
  }
  if (S.lockX != null) target = Math.min(target, S.lockX);
  S.camX += (target - S.camX) * Math.min(1, dt * 7);
  S.camMin = Math.max(S.camMin, S.camX);

  if (S.waveActive) {
    const wave = WAVES[S.waveIdx];
    const alive = S.enemies.filter(e => !e.dead).length;
    if (!S.spawnedGroup) {
      S.groupDelay -= dt;
      if (S.groupDelay <= 0) { spawnGroup(); S.spawnedGroup = true; }
    } else if (S.groupIdx < wave.groups.length - 1 && alive <= 1) {
      S.groupIdx++; S.spawnedGroup = false; S.groupDelay = 0.6;
    } else if (S.groupIdx === wave.groups.length - 1 && alive === 0 && !wave.boss) {
      S.waveActive = false; S.lockX = null; S.waveIdx++; S.go = 3;
      Sfx.play('confirm');
    }
  }
  S.go = Math.max(0, S.go - dt);

  if (S.endT > 0) { S.endT -= dt; if (S.endT <= 0) toScene('victory'); }
}

// ---------------------------------------------------------------- stage render
function renderStage() {
  const camX = S.camX;
  const sx = (Math.random() - 0.5) * S.shake, sy = (Math.random() - 0.5) * S.shake;
  ctx.save();
  ctx.translate(sx, sy);
  drawSky(camX, S.time);
  drawCitadelLayer(camX);
  drawSpires(camX, S.time);
  drawFloor(camX, S.time);

  const things = [S.player, ...S.enemies];
  for (const t of things) t.drawShadow(camX);
  for (const it of S.pickups) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(it.x - camX, it.y, 14, 4, 0, 0, 7); ctx.fill();
  }
  const drawables = [...things, ...S.pickups.map(it => ({ y: it.y, draw: () => drawPickup(it, camX) })), ...S.projectiles.map(pr => ({ y: pr.y, draw: () => drawProjectile(pr, camX) }))];
  drawables.sort((a, b) => a.y - b.y);
  for (const d of drawables) d.draw(camX);
  drawFx(camX);
  ctx.restore();

  if (S.flash > 0) { ctx.fillStyle = `rgba(230,200,255,${S.flash * 0.5})`; ctx.fillRect(0, 0, W, H); }
  drawHUD();
}

function drawPickup(it, camX) {
  const bob = Math.sin(it.t * 5) * 4, x = it.x - camX, y = it.y - it.z - 22 + bob;
  const blink = it.t > 11 && Math.floor(it.t * 10) % 2;
  if (blink) return;
  if (it.type === 'gem') drawImg(A.img.gem, x, y, 0.42);
  else drawImg(A.img.fx_star, x, y, 0.55, { rot: it.t * 2, add: true });
}

function drawProjectile(pr, camX) {
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(pr.x - camX, pr.y, 26, 6, 0, 0, 7); ctx.fill();
  drawImg(A.img.fx_fireball, pr.x - camX - pr.face * 20, pr.y - pr.z, 0.6, { flip: pr.face < 0, add: true, filter: 'hue-rotate(110deg) saturate(1.4)' });
}

function drawHUD() {
  const p = S.player;
  // portrait panel
  ctx.fillStyle = 'rgba(6,4,22,0.78)'; ctx.fillRect(10, 10, 372, 96);
  ctx.strokeStyle = '#6b4dff'; ctx.lineWidth = 2; ctx.strokeRect(10, 10, 372, 96);
  let pk = 'normal';
  if (p.portraitT > 0) pk = p.portrait;
  else if (p.hp < 30) pk = 'hurt';
  else if (p.energy >= 100) pk = 'angry';
  const pi = A.img['portrait_' + pk];
  ctx.save(); ctx.beginPath(); ctx.rect(16, 16, 84, 84); ctx.clip();
  ctx.fillStyle = '#120a33'; ctx.fillRect(16, 16, 84, 84);
  ctx.drawImage(pi, 16 + (84 - pi.width * 0.78) / 2, 16 + (84 - pi.height * 0.78) / 2, pi.width * 0.78, pi.height * 0.78);
  ctx.restore();
  ctx.strokeStyle = '#b48cff'; ctx.strokeRect(16, 16, 84, 84);

  text('GRIMALKIN', 110, 31, { size: 12, color: '#e9dcff' });
  text('FINAL BOSS CAT', 236, 31, { size: 8, color: '#9d86ff' });
  bar(110, 38, 262, 14, p.hp / p.maxHp, p.hp < 30 ? '#ff3a6e' : '#c2308f', p.hp < 30 ? '#ff8a5a' : '#ff7ae0');
  const full = p.energy >= BREATH_COST;
  const mf = S.meterFlash > 0 && Math.floor(S.meterFlash * 20) % 2;
  bar(110, 60, 200, 8, p.energy / 100, mf ? '#ff3a6e' : '#2a7bff', full ? '#8fffff' : '#5fe0ff');
  text('STATIC', 318, 68, { size: 8, color: full ? '#8fffff' : '#6aa7ff' });
  // roar / breath readiness ticks
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillRect(110 + 200 * ROAR_COST / 100, 58, 1, 12); ctx.fillRect(110 + 200 * BREATH_COST / 100, 58, 1, 12);
  // nine lives
  for (let i = 0; i < 9; i++) {
    const alive = i < p.lives;
    ctx.globalAlpha = alive ? 1 : 0.18;
    ctx.drawImage(A.img.crown, 110 + i * 29, 76, 26, 20);
  }
  ctx.globalAlpha = 1;

  text(String(S.score).padStart(8, '0'), W - 16, 34, { size: 16, align: 'right', color: '#fff', glow: '#7a4dff' });
  text('SCORE', W - 16, 52, { size: 8, align: 'right', color: '#9d86ff' });
  text(Sfx.muted ? 'MUTED [M]' : '', W - 16, 70, { size: 8, align: 'right', color: '#665' });

  if (S.combo >= 3) {
    const tag = S.combo >= 35 ? 'FELINE DIVINE' : S.combo >= 20 ? 'CATASTROPHIC' : S.combo >= 10 ? 'PURR-FECT' : S.combo >= 5 ? 'NICE' : '';
    const pulse = 1 + Math.max(0, S.comboT - 1.6) * 2;
    text(`${S.combo} HITS`, W - 20, 140, { size: Math.round(20 * pulse), align: 'right', color: '#ffe36b', stroke: '#3a0a4a', strokeW: 5 });
    if (tag) text(tag, W - 20, 162, { size: 10, align: 'right', color: '#ff9af0', stroke: '#3a0a4a' });
  }

  if (S.boss && !S.boss.remove) {
    const b = S.boss;
    text('REGENT VERMILLIA', W / 2, H - 34, { size: 10, align: 'center', color: '#ff9aa8', stroke: '#200', strokeW: 3 });
    bar(W / 2 - 250, H - 26, 500, 12, Math.max(0, b.hp) / b.maxHp, '#8a0f2a', '#ff5a6e');
  }

  if (S.go > 0 && Math.floor(S.go * 3) % 2 === 0) {
    text('GO', W - 90, H / 2, { size: 28, color: '#ffe36b', stroke: '#3a0a4a', strokeW: 6, align: 'center' });
    ctx.fillStyle = '#ffe36b';
    ctx.beginPath(); ctx.moveTo(W - 50, H / 2 - 30); ctx.lineTo(W - 20, H / 2 - 12); ctx.lineTo(W - 50, H / 2 + 6); ctx.fill();
  }

  const bn = S.banner;
  if (bn) {
    const k = Math.min(1, bn.t / 0.25, (bn.dur - bn.t) / 0.3);
    ctx.save(); ctx.globalAlpha = Math.max(0, k);
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, 'rgba(20,6,50,0)'); g.addColorStop(0.5, 'rgba(20,6,50,0.85)'); g.addColorStop(1, 'rgba(20,6,50,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 196, W, bn.title ? 92 : 50);
    if (bn.title) text(bn.title, W / 2, 238, { size: 20, align: 'center', color: bn.color, glow: bn.color, stroke: '#12002a', strokeW: 5 });
    if (bn.sub) text(bn.sub, W / 2, bn.title ? 270 : 228, { size: 11, align: 'center', color: '#fff', stroke: '#12002a' });
    ctx.restore();
  }
}

// ---------------------------------------------------------------- scenes
let scene = 'loading', sceneT = 0, menuIdx = 0, codexIdx = 0, ending = null;
const MENU = ['START GAME', 'CODEX', 'CONTROLS'];
let titleT = 0;

function toScene(s) {
  scene = s; sceneT = 0;
  if (s === 'play') Sfx.music(1, 104);
  if (s === 'victory' || s === 'gameover') { Sfx.stopMusic(); ending = { score: S.score, kills: S.kills, best: S.bestCombo, lives: S.player.lives }; }
  if (s === 'title') Sfx.music(0, 90);
}

function update(dt) {
  sceneT += dt; titleT += dt;
  const P = input.pressed;
  if (P.mute) Sfx.toggleMute();
  switch (scene) {
    case 'title':
      if (P.up) { menuIdx = (menuIdx + MENU.length - 1) % MENU.length; Sfx.play('select'); }
      if (P.down) { menuIdx = (menuIdx + 1) % MENU.length; Sfx.play('select'); }
      if (P.start || P.attack) {
        Sfx.play('confirm');
        if (menuIdx === 0) { toScene('intro'); }
        else if (menuIdx === 1) toScene('codex');
        else toScene('controls');
      }
      break;
    case 'codex':
      if (P.up) { codexIdx = (codexIdx + LORE.codex.length - 1) % LORE.codex.length; Sfx.play('select'); }
      if (P.down) { codexIdx = (codexIdx + 1) % LORE.codex.length; Sfx.play('select'); }
      if (P.pause || P.start || P.jump) toScene('title');
      break;
    case 'controls':
      if (P.pause || P.start || P.attack || P.jump) toScene('title');
      break;
    case 'intro':
      if (P.start || P.attack || P.pause || sceneT > LORE.intro.length * 1.1 + 12) { newStage(); toScene('play'); }
      break;
    case 'play':
      if (P.pause) { toScene('paused'); break; }
      updateStage(dt);
      break;
    case 'paused':
      if (P.pause || P.start) { scene = 'play'; }
      break;
    case 'victory': case 'gameover':
      if (sceneT > 2 && (P.start || P.attack)) { toScene('title'); }
      break;
  }
  input.pressed = {};
}

function renderTitle() {
  drawSky(titleT * 40, titleT);
  drawCitadelLayer(titleT * 40);
  drawFloor(titleT * 40, titleT);
  const a = A.anims.boss.idle;
  drawFrame(a, Math.floor(titleT * a.fps) % a.frames, 290, 505, 2.6, false);
  const logo = A.img.logo, pulse = 1 + Math.sin(titleT * 2) * 0.015;
  ctx.save(); ctx.shadowColor = '#8a4dff'; ctx.shadowBlur = 30 + Math.sin(titleT * 3) * 10;
  drawImg(logo, W / 2, 96, 1.45 * pulse);
  ctx.restore();
  text('THE ULTIMATE PREDATOR. THE LAST MEME. FEAR IT.', W / 2, 200, { size: 10, align: 'center', color: '#d9ccff', stroke: '#0a0420', strokeW: 5 });
  for (let i = 0; i < MENU.length; i++) {
    const sel = i === menuIdx, y = 300 + i * 50;
    if (sel) drawImg(A.img.gem, 590, y - 7, 0.22);
    text(MENU[i], 612, y, { size: sel ? 18 : 14, color: sel ? '#ffffff' : '#8b7bd6', glow: sel ? '#9b6bff' : null });
  }
  if (Math.floor(titleT * 2) % 2 === 0) text('PRESS ENTER', 612, 470, { size: 10, color: '#ffe36b' });
  text('ARROWS / WASD TO SELECT   M: MUTE', 612, 492, { size: 8, color: '#6a5aa8' });
}

function renderCodex() {
  drawSky(titleT * 20, titleT);
  ctx.fillStyle = 'rgba(4,2,16,0.8)'; ctx.fillRect(0, 0, W, H);
  text('CODEX OF FELIS', 40, 56, { size: 20, color: '#c9a2ff', glow: '#7a4dff' });
  text('UP/DOWN: BROWSE   ESC: BACK', 40, 80, { size: 8, color: '#6a5aa8' });
  LORE.codex.forEach((c, i) => {
    const sel = i === codexIdx, y = 118 + i * 34;
    if (sel) { ctx.fillStyle = 'rgba(122,77,255,0.25)'; ctx.fillRect(34, y - 20, 330, 30); }
    text(c.title, 44, y, { size: 8, color: sel ? '#fff' : c.title.startsWith('[') ? '#ff6a7a' : '#8b7bd6' });
  });
  const c = LORE.codex[codexIdx];
  ctx.fillStyle = 'rgba(20,10,50,0.8)'; ctx.fillRect(390, 100, 540, 410);
  ctx.strokeStyle = '#6b4dff'; ctx.strokeRect(390, 100, 540, 410);
  text(c.title, 412, 138, { size: 12, color: c.title.startsWith('[') ? '#ff6a7a' : '#ffe36b' });
  const font = `500 21px ${BODY}`;
  wrap(c.body, 496, font).forEach((ln, i) => text(ln, 412, 176 + i * 26, { size: 21, font: BODY, weight: 500, color: '#e3dbff' }));
  const port = ['portrait_normal', 'portrait_roar', 'portrait_angry', 'portrait_hurt', 'portrait_death'][codexIdx % 5];
  drawImg(A.img[port], 870, 450, 0.5, { alpha: 0.5 });
}

function renderControls() {
  drawSky(titleT * 20, titleT);
  ctx.fillStyle = 'rgba(4,2,16,0.8)'; ctx.fillRect(0, 0, W, H);
  text('CONTROLS', W / 2, 70, { size: 20, align: 'center', color: '#c9a2ff', glow: '#7a4dff' });
  const rows = [
    ['MOVE', 'ARROWS / WASD', 'D-PAD / STICK'],
    ['MONOFILAMENT TALONS (combo x3)', 'J / Z', 'A'],
    ['JUMP  (+ attack in air = GRAVITY POUNCE)', 'K / X / SPACE', 'B'],
    [`PRIMORDIAL HISS  (${ROAR_COST} static)`, 'L / C', 'X'],
    [`STATIC SINGULARITY  (${BREATH_COST} static)`, 'I / V', 'Y'],
    ['PAUSE', 'ESC / P', 'START'],
    ['MUTE', 'M', ''],
  ];
  text('ACTION', 70, 130, { size: 8, color: '#6a5aa8' }); text('KEYBOARD', 600, 130, { size: 8, color: '#6a5aa8' }); text('PAD', 800, 130, { size: 8, color: '#6a5aa8' });
  rows.forEach((r, i) => {
    const y = 170 + i * 40;
    text(r[0], 70, y, { size: 20, font: BODY, weight: 700, color: '#e3dbff' });
    text(r[1], 600, y, { size: 10, color: '#ffe36b' });
    text(r[2], 800, y, { size: 10, color: '#8fe9ff' });
  });
  text('Landing hits builds STATIC. Roar and Breath make you super-armored.', W / 2, 470, { size: 19, font: BODY, weight: 500, align: 'center', color: '#b9a4ff' });
  text('You have NINE LIVES. Of course you do.', W / 2, 496, { size: 19, font: BODY, weight: 500, align: 'center', color: '#b9a4ff' });
}

function renderIntro() {
  drawSky(sceneT * 12, sceneT);
  const lines = LORE.intro, speed = 34, gap = 34;
  const y0 = H + 20 - sceneT * speed;
  lines.forEach((ln, i) => {
    const y = y0 + i * gap;
    if (y < -20 || y > H + 20) return;
    const fade = clamp((y - 40) / 120, 0, 1) * clamp((H - y) / 60, 0, 1);
    const big = ln === ln.toUpperCase() && ln.length > 0;
    text(ln, W / 2, y, big
      ? { size: 14, align: 'center', color: '#ffe36b', alpha: fade, glow: '#ff9a3a', blur: 8 }
      : { size: 24, font: BODY, weight: 500, align: 'center', color: '#dcd3ff', alpha: fade });
  });
  text('ENTER: SKIP', W - 16, H - 14, { size: 8, align: 'right', color: '#6a5aa8' });
}

function renderEnding(win) {
  drawSky(sceneT * 10, sceneT);
  ctx.fillStyle = win ? 'rgba(10,2,20,0.5)' : 'rgba(30,0,10,0.6)'; ctx.fillRect(0, 0, W, H);
  if (win) {
    // the Red Dot escapes
    const rx = W / 2 + Math.sin(sceneT * 1.7) * 300, ry = 90 + Math.cos(sceneT * 2.3) * 40;
    ctx.save(); ctx.shadowColor = '#ff2030'; ctx.shadowBlur = 20; ctx.fillStyle = '#ff3040';
    ctx.beginPath(); ctx.arc(rx, ry, 4, 0, 7); ctx.fill(); ctx.restore();
  }
  const lines = win ? LORE.victory : LORE.gameOver;
  lines.forEach((ln, i) => {
    const a = clamp((sceneT - i * 0.35) / 0.5, 0, 1);
    const big = ln === ln.toUpperCase() && ln.length > 0;
    text(ln, W / 2, 70 + i * 26, big
      ? { size: 14, align: 'center', color: win ? (ln.includes('PUNCTUM') ? '#ff5a6e' : '#ffe36b') : '#ff6a7a', alpha: a }
      : { size: 22, font: BODY, weight: 500, align: 'center', color: '#dcd3ff', alpha: a });
  });
  const y = 70 + lines.length * 26 + 24, a = clamp((sceneT - lines.length * 0.35) / 0.5, 0, 1);
  text(`SCORE ${ending.score}    KOs ${ending.kills}    BEST COMBO ${ending.best}    LIVES LEFT ${ending.lives}/9`, W / 2, y, { size: 10, align: 'center', color: '#8fe9ff', alpha: a });
  drawImg(A.img[win ? 'portrait_roar' : 'portrait_death'], W / 2, y + 58, 0.6, { alpha: a });
  if (sceneT > 2 && Math.floor(sceneT * 2) % 2 === 0) text('PRESS ENTER', W / 2, H - 16, { size: 10, align: 'center', color: '#ffe36b' });
}

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#02030c'; ctx.fillRect(0, 0, W, H);
  switch (scene) {
    case 'loading':
      text('LOADING THE CROWN LATTICE...', W / 2, H / 2, { size: 12, align: 'center', color: '#9d86ff' });
      break;
    case 'error':
      text('FAILED TO LOAD ASSETS', W / 2, H / 2 - 10, { size: 12, align: 'center', color: '#ff6a7a' });
      text(String(loadError), W / 2, H / 2 + 20, { size: 16, font: BODY, align: 'center', color: '#dcd3ff' });
      break;
    case 'title': renderTitle(); break;
    case 'codex': renderCodex(); break;
    case 'controls': renderControls(); break;
    case 'intro': renderIntro(); break;
    case 'play': renderStage(); break;
    case 'paused':
      renderStage();
      ctx.fillStyle = 'rgba(4,2,16,0.7)'; ctx.fillRect(0, 0, W, H);
      text('PAUSED', W / 2, H / 2 - 10, { size: 24, align: 'center', color: '#c9a2ff', glow: '#7a4dff' });
      text('THE FINAL BOSS IS GROOMING. PRESS ESC TO RESUME.', W / 2, H / 2 + 24, { size: 8, align: 'center', color: '#8b7bd6' });
      break;
    case 'victory': renderEnding(true); break;
    case 'gameover': renderEnding(false); break;
  }
}

// ---------------------------------------------------------------- boot
function fit() {
  const s = Math.min(innerWidth / W, innerHeight / H);
  canvas.style.width = Math.floor(W * s) + 'px';
  canvas.style.height = Math.floor(H * s) + 'px';
}
addEventListener('resize', fit);
fit();

let last = performance.now(), acc = 0, loadError = null;
function frame(now) {
  acc += Math.min(0.1, (now - last) / 1000); last = now;
  pollGamepad();
  while (acc >= DT) { update(DT); acc -= DT; }
  render();
  requestAnimationFrame(frame);
}

loadAssets()
  .then(() => { toScene('title'); })
  .catch(err => { console.error(err); loadError = err.message; scene = 'error'; });
requestAnimationFrame(frame);
