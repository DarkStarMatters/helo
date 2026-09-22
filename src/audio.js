// Procedural WebAudio sound effects and a small synthwave loop. No audio files.
window.Sfx = (() => {
  let ac = null, master = null, musicBus = null, noiseBuf = null;
  let muted = false, musicTimer = null, step = 0, nextTime = 0, tempo = 104, intensity = 0;

  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain(); master.gain.value = 0.55; master.connect(ac.destination);
    musicBus = ac.createGain(); musicBus.gain.value = 0.32; musicBus.connect(master);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function env(g, t, vol, a, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  function tone(freq, dur, { type = 'square', vol = 0.15, to = null, delay = 0, bus = master, attack = 0.005 } = {}) {
    if (!ac) return;
    const t = ac.currentTime + delay;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    env(g, t, vol, attack, dur);
    o.connect(g); g.connect(bus);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function noise(dur, { vol = 0.2, freq = 2000, to = null, type = 'lowpass', q = 1, delay = 0 } = {}) {
    if (!ac) return;
    const t = ac.currentTime + delay;
    const s = ac.createBufferSource(); s.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ac.createGain(); env(g, t, vol, 0.004, dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  const sounds = {
    swipe()   { noise(0.12, { vol: 0.25, freq: 900, to: 5000, type: 'bandpass', q: 2 }); },
    hit()     { noise(0.08, { vol: 0.4, freq: 3000, to: 400 }); tone(140, 0.12, { type: 'square', vol: 0.18, to: 50 }); },
    heavy()   { noise(0.25, { vol: 0.5, freq: 1800, to: 120 }); tone(90, 0.3, { type: 'sawtooth', vol: 0.25, to: 30 }); },
    hurt()    { tone(420, 0.18, { type: 'sawtooth', vol: 0.15, to: 160 }); noise(0.1, { vol: 0.25, freq: 1200 }); },
    jump()    { tone(220, 0.16, { type: 'triangle', vol: 0.18, to: 520 }); },
    land()    { noise(0.14, { vol: 0.3, freq: 500, to: 80 }); tone(70, 0.15, { type: 'sine', vol: 0.3, to: 40 }); },
    roar() {
      tone(70, 0.9, { type: 'sawtooth', vol: 0.35, to: 45, attack: 0.05 });
      tone(105, 0.8, { type: 'sawtooth', vol: 0.2, to: 60, attack: 0.05 });
      noise(0.9, { vol: 0.45, freq: 600, to: 150, q: 0.7 });
    },
    charge()  { tone(110, 0.5, { type: 'sawtooth', vol: 0.15, to: 880, attack: 0.02 }); },
    beam() {
      tone(55, 1.1, { type: 'sawtooth', vol: 0.22, attack: 0.02 });
      tone(58, 1.1, { type: 'square', vol: 0.12, attack: 0.02 });
      noise(1.1, { vol: 0.25, freq: 4000, type: 'bandpass', q: 0.8 });
    },
    zap()     { tone(1200 + Math.random() * 800, 0.05, { type: 'square', vol: 0.06, to: 300 }); },
    fizzle()  { tone(160, 0.12, { type: 'square', vol: 0.1, to: 110 }); tone(120, 0.12, { type: 'square', vol: 0.1, to: 80, delay: 0.1 }); },
    pickup()  { [660, 880, 1320].forEach((f, i) => tone(f, 0.1, { type: 'triangle', vol: 0.15, delay: i * 0.06 })); },
    power()   { [440, 660, 990, 1320].forEach((f, i) => tone(f, 0.12, { type: 'square', vol: 0.08, delay: i * 0.05 })); },
    enemyDie(){ tone(300, 0.35, { type: 'square', vol: 0.12, to: 60 }); noise(0.3, { vol: 0.25, freq: 2500, to: 200 }); },
    blink()   { tone(1800, 0.12, { type: 'sine', vol: 0.12, to: 300 }); },
    fireball(){ noise(0.35, { vol: 0.3, freq: 300, to: 2400, type: 'bandpass', q: 1.5 }); tone(200, 0.3, { type: 'sawtooth', vol: 0.1, to: 90 }); },
    select()  { tone(880, 0.06, { type: 'square', vol: 0.1 }); },
    confirm() { tone(660, 0.08, { type: 'square', vol: 0.12 }); tone(990, 0.12, { type: 'square', vol: 0.12, delay: 0.07 }); },
    wave()    { [330, 392, 494].forEach((f, i) => tone(f, 0.25, { type: 'sawtooth', vol: 0.1, delay: i * 0.1 })); },
    life() {
      [220, 277, 330, 440, 554, 660].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.15, delay: i * 0.07 }));
      noise(0.8, { vol: 0.2, freq: 8000, to: 500, type: 'highpass' });
    },
  };

  // --- music: A-minor space-synth loop, 16 steps per bar, 4 bars
  const ROOTS = [45, 41, 38, 40];                 // A2 F2 D2 E2 (midi)
  const ARP = [0, 7, 12, 15, 12, 7, 3, 7];
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  function scheduleStep(t) {
    const bar = Math.floor(step / 16) % 4, s = step % 16, root = ROOTS[bar];
    const sp = 60 / tempo / 4;
    if (s % 2 === 0) bassNote(mtof(root - (s % 8 === 0 ? 12 : 0)), t, sp * 1.8);
    if (intensity > 0) arpNote(mtof(root + 24 + ARP[s % 8]), t, sp * 0.9);
    if (s % 4 === 0) kick(t);
    if (intensity > 1 && s % 8 === 4) snare(t);
    step++;
  }
  function bassNote(f, t, d) {
    const o = ac.createOscillator(), g = ac.createGain(), fl = ac.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.value = f;
    fl.type = 'lowpass'; fl.frequency.setValueAtTime(900, t); fl.frequency.exponentialRampToValueAtTime(160, t + d);
    env(g, t, 0.35, 0.005, d);
    o.connect(fl); fl.connect(g); g.connect(musicBus); o.start(t); o.stop(t + d + 0.02);
  }
  function arpNote(f, t, d) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'square'; o.frequency.value = f;
    env(g, t, 0.06, 0.003, d);
    o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + d + 0.02);
  }
  function kick(t) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    env(g, t, 0.5, 0.003, 0.18);
    o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + 0.2);
  }
  function snare(t) {
    const s = ac.createBufferSource(); s.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1500;
    const g = ac.createGain(); env(g, t, 0.25, 0.002, 0.14);
    s.connect(f); f.connect(g); g.connect(musicBus); s.start(t); s.stop(t + 0.16);
  }

  return {
    init,
    play(name) { if (!muted && ac && sounds[name]) sounds[name](); },
    music(level, bpm) {
      if (!ac) return;
      intensity = level; if (bpm) tempo = bpm;
      if (musicTimer) return;
      nextTime = ac.currentTime + 0.05;
      musicTimer = setInterval(() => {
        while (nextTime < ac.currentTime + 0.12) {
          if (!muted) scheduleStep(nextTime); else step++;
          nextTime += 60 / tempo / 4;
        }
      }, 25);
    },
    stopMusic() { clearInterval(musicTimer); musicTimer = null; },
    toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.55; return muted; },
    get muted() { return muted; },
  };
})();
