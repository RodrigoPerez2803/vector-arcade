(() => {
  'use strict';
  /* =====================================================================
     IMPACT ZONE — raycasting first-person shooter
     The 3D scene is rendered into a pixel buffer (textures, fog and
     emissive lights) that is upscaled with smoothing; the weapon and HUD
     are drawn on top at the screen's native resolution.
     ===================================================================== */
  const $ = s => document.querySelector(s);
  const canvas = $('#game'), ctx = canvas.getContext('2d');
  const W = 1280, H = 720, TAU = Math.PI * 2, TS = 128, TSH = 7, TM = 127, FOVK = .7, DS = 64; // DS: texture drawing space
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* no storage available */ } };
  const hexRgb = h => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const rgba = (h, a) => { const [r, g, b] = hexRgb(h); return `rgba(${r},${g},${b},${a})`; };

  /* ---------------- Screen and quality ---------------- */
  let scale = 1;
  function resize() {
    const r = canvas.getBoundingClientRect();
    const bw = Math.round(clamp(r.width * Math.min(2, window.devicePixelRatio || 1), 640, 2560));
    if (canvas.width !== bw) { canvas.width = bw; canvas.height = Math.round(bw * 9 / 16); }
    scale = canvas.width / W;
  }
  window.addEventListener('resize', resize); resize();

  const settings = Object.assign({ quality: 'high', sens: 1, diff: 'normal', music: true }, load('zona-ajustes', {}));
  // Older saves used Spanish ids for quality and difficulty: map them to the current ones.
  const LEGACY_IDS = { alta: 'high', media: 'medium', baja: 'low', facil: 'easy', dificil: 'hard', pesadilla: 'nightmare' };
  if (LEGACY_IDS[settings.quality]) settings.quality = LEGACY_IDS[settings.quality];
  if (LEGACY_IDS[settings.diff]) settings.diff = LEGACY_IDS[settings.diff];
  const QUALITY = { ultra: [1280, 720], high: [960, 540], medium: [768, 432], low: [576, 324] };
  if (!QUALITY[settings.quality]) settings.quality = 'high'; // unknown saved value: use the default
  const QNAMES = { ultra: 'Ultra', high: 'High', medium: 'Medium', low: 'Low' };
  let RW, RH, view, vctx, img, buf, zbuf;
  function setRes(q) {
    [RW, RH] = QUALITY[q];
    view = document.createElement('canvas'); view.width = RW; view.height = RH;
    vctx = view.getContext('2d'); img = vctx.createImageData(RW, RH);
    buf = new Uint32Array(img.data.buffer); zbuf = new Float32Array(RW);
  }
  setRes(settings.quality);

  const DIFFS = {
    easy: { name: 'Easy', note: 'Just enjoy the ride', hp: .7, dmg: .55, speed: .9, regen: true },
    normal: { name: 'Normal', note: 'Tough but fair', hp: 1, dmg: 1, speed: 1 },
    hard: { name: 'Hard', note: 'Tougher enemies', hp: 1.3, dmg: 1.35, speed: 1.08 },
    nightmare: { name: 'Nightmare', note: 'For veterans', hp: 1.6, dmg: 1.7, speed: 1.16 }
  };
  if (!DIFFS[settings.diff]) settings.diff = 'normal'; // unknown saved value: use the default

  /* =====================================================================
     PROCEDURAL TEXTURES (base + emissive mask)
     ===================================================================== */
  function texPair(fn, size = TS) {
    const a = document.createElement('canvas'), b = document.createElement('canvas');
    a.width = a.height = b.width = b.height = size;
    const g = a.getContext('2d'), e = b.getContext('2d');
    e.fillStyle = '#000'; e.fillRect(0, 0, size, size);
    g.scale(size / 64, size / 64); e.scale(size / 64, size / 64);
    fn(g, e, 64);
    const px = new Uint32Array(g.getImageData(0, 0, size, size).data.buffer.slice(0));
    const ed = e.getImageData(0, 0, size, size).data, em = new Uint8Array(size * size);
    for (let i = 0; i < em.length; i++) em[i] = ed[i * 4];
    return { px, em };
  }
  function grain(g, base, amt, n = 600) {
    g.fillStyle = base; g.fillRect(0, 0, DS, DS);
    for (let i = 0; i < n; i++) {
      g.fillStyle = Math.random() < .55 ? `rgba(0,0,0,${amt * Math.random()})` : `rgba(255,255,255,${amt * .5 * Math.random()})`;
      g.fillRect(randi(0, 63), randi(0, 63), randi(1, 3), randi(1, 2));
    }
  }
  function shadeV(g, top = .1, bottom = .28) {
    const gr = g.createLinearGradient(0, 0, 0, DS);
    gr.addColorStop(0, `rgba(255,255,255,${top})`); gr.addColorStop(1, `rgba(0,0,0,${bottom})`);
    g.fillStyle = gr; g.fillRect(0, 0, DS, DS);
  }
  function both(g, e, fn) { fn(g); e.fillStyle = '#fff'; e.strokeStyle = '#fff'; fn(e); }
  function crack(g, e, col, n = 3) {
    for (let k = 0; k < n; k++) {
      let x = randi(4, 60), y = randi(4, 60);
      g.strokeStyle = col; g.lineWidth = randi(1, 2); e.strokeStyle = '#fff'; e.lineWidth = g.lineWidth;
      g.beginPath(); e.beginPath(); g.moveTo(x, y); e.moveTo(x, y);
      for (let i = 0; i < 6; i++) { x += randi(-8, 8); y += randi(-8, 8); g.lineTo(x, y); e.lineTo(x, y); }
      g.stroke(); e.stroke();
    }
  }
  function bricks(g, mortar, h = 10, w = 20) {
    g.strokeStyle = mortar; g.lineWidth = 2;
    for (let y = 0; y < DS; y += h) { g.beginPath(); g.moveTo(0, y); g.lineTo(DS, y); g.stroke(); for (let x = (y / h) % 2 ? w / 2 : 0; x < DS; x += w) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + h); g.stroke(); } }
  }
  function panels(g, n = 2) {
    const s = DS / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 2; g.strokeRect(i * s + 1, j * s + 1, s - 2, s - 2);
      g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 1; g.beginPath(); g.moveTo(i * s + 2, j * s + s - 3); g.lineTo(i * s + 2, j * s + 2); g.lineTo(i * s + s - 3, j * s + 2); g.stroke();
      g.fillStyle = 'rgba(0,0,0,.45)'; for (const [a, b] of [[4, 4], [s - 5, 4], [4, s - 5], [s - 5, s - 5]]) { g.beginPath(); g.arc(i * s + a, j * s + b, 1.3, 0, TAU); g.fill(); }
    }
  }

  const THEMES = {
    industrial: { name: 'Industrial Complex', wall: '#5d6872', wall2: '#7a5a3a', accent: '#f07a5a', floor: '#3a3f44', ceil: '#2a3036', light: '#ffc27a', fog: '#0b0f14', fogDist: 12 },
    foundry: { name: 'Foundry', wall: '#5a3a2e', wall2: '#3a2620', accent: '#ff6a1a', floor: '#2e2420', ceil: '#1a1210', light: '#ff8a3d', fog: '#1c0904', fogDist: 10.5 },
    cryo: { name: 'Cryogenics Lab', wall: '#b8cad8', wall2: '#6a8aa8', accent: '#46c8ff', floor: '#7f93a6', ceil: '#d4e2ee', light: '#bff0ff', fog: '#0a1824', fogDist: 13 },
    toxic: { name: 'Toxic Greenhouse', wall: '#3e573a', wall2: '#594a2a', accent: '#9dff3a', floor: '#2c3a26', ceil: '#1a2418', light: '#c8ff6a', fog: '#071406', fogDist: 9.5 },
    hive: { name: 'The Hive', wall: '#4e2c4c', wall2: '#6a2a5a', accent: '#d06aff', floor: '#2a1a2a', ceil: '#1a0e1a', light: '#e08aff', fog: '#100410', fogDist: 9 },
    data: { name: 'Data Core', wall: '#1c2a3c', wall2: '#202042', accent: '#46f0d0', accent2: '#ff4fa3', floor: '#121a28', ceil: '#0b111c', light: '#46f0d0', fog: '#04060c', fogDist: 12 },
    cathedral: { name: 'Void Cathedral', wall: '#4c4658', wall2: '#2e2a38', accent: '#ffd166', floor: '#2c2834', ceil: '#17141d', light: '#ffd9a0', fog: '#08060c', fogDist: 10 },
    lunar: { name: 'Lunar Base', wall: '#cfd0c8', wall2: '#8f908a', accent: '#5fa8ff', floor: '#9fa09a', ceil: '#e2e2da', light: '#d8ecff', fog: '#0e1218', fogDist: 14 },
    inferno: { name: 'Machine Inferno', wall: '#4c1c16', wall2: '#2a0e0a', accent: '#ff3a1a', floor: '#2a0e0a', ceil: '#150604', light: '#ff5a2a', fog: '#220402', fogDist: 8.5 }
  };

  // Each setting draws its main wall, accent wall, floor and ceiling.
  const STYLE = {
    industrial: {
      wall: (g, e, t) => { grain(g, t.wall, .2); shadeV(g); panels(g, 2); for (let x = -8; x < DS; x += 8) { g.fillStyle = x / 8 % 2 ? '#1b1b1b' : t.accent; g.beginPath(); g.moveTo(x, 64); g.lineTo(x + 8, 52); g.lineTo(x + 12, 52); g.lineTo(x + 4, 64); g.fill(); } g.fillStyle = '#ffc27a'; g.beginPath(); g.arc(54, 9, 3, 0, TAU); g.fill(); e.fillStyle = '#fff'; e.beginPath(); e.arc(54, 9, 3, 0, TAU); e.fill(); },
      accent: (g, e, t) => { grain(g, '#2b2f33', .2); for (const x of [8, 26, 44]) { const gr = g.createLinearGradient(x, 0, x + 14, 0); gr.addColorStop(0, '#2a2016'); gr.addColorStop(.4, t.wall2); gr.addColorStop(1, '#1a120a'); g.fillStyle = gr; g.fillRect(x, 0, 14, 64); g.fillStyle = '#111'; g.fillRect(x - 1, 20, 16, 4); g.fillRect(x - 1, 46, 16, 4); } g.fillStyle = '#c0392b'; g.beginPath(); g.arc(33, 33, 4, 0, TAU); g.fill(); },
      floor: (g, e, t) => { grain(g, t.floor, .25); g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 1; for (let i = 0; i < DS; i += 8) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, DS); g.moveTo(0, i); g.lineTo(DS, i); g.stroke(); } g.strokeStyle = 'rgba(255,255,255,.07)'; for (let i = 1; i < DS; i += 8) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, DS); g.stroke(); } },
      ceil: (g, e, t) => { grain(g, t.ceil, .15); panels(g, 2); both(g, e, c => { c.fillStyle = c === g ? t.light : '#fff'; c.fillRect(6, 29, 52, 5); }); }
    },
    foundry: {
      wall: (g, e, t) => { grain(g, t.wall, .25); shadeV(g, .05, .35); bricks(g, '#140a06', 12, 22); crack(g, e, '#ff7a2a', 3); const gr = e.createLinearGradient(0, 40, 0, 64); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(255,255,255,.35)'); e.fillStyle = gr; e.fillRect(0, 40, 64, 24); },
      accent: (g, e, t) => { grain(g, '#1a0e0a', .2); for (let x = 10; x < 60; x += 16) both(g, e, c => { const gr = c.createLinearGradient(x, 0, x + 10, 0); gr.addColorStop(0, c === g ? '#ff4a00' : '#888'); gr.addColorStop(.5, c === g ? '#ffd23a' : '#fff'); gr.addColorStop(1, c === g ? '#ff4a00' : '#888'); c.fillStyle = gr; c.fillRect(x, 0, 10, 64); }); },
      floor: (g, e, t) => { grain(g, t.floor, .3); bricks(g, '#0c0604', 16, 16); crack(g, e, '#ff6a1a', 2); },
      ceil: (g, e, t) => { grain(g, t.ceil, .3); for (let i = 0; i < 6; i++) both(g, e, c => { c.fillStyle = c === g ? '#ff7a2a' : '#fff'; c.fillRect(randi(0, 62), randi(0, 62), 2, 2); }); }
    },
    cryo: {
      wall: (g, e, t) => { grain(g, t.wall, .12); shadeV(g, .15, .2); panels(g, 2); g.fillStyle = 'rgba(255,255,255,.35)'; for (let i = 0; i < 8; i++) g.fillRect(randi(0, 60), randi(0, 60), randi(4, 10), 1); both(g, e, c => { c.fillStyle = c === g ? t.accent : '#fff'; c.fillRect(0, 11, 64, 2); }); },
      accent: (g, e, t) => { grain(g, '#55687a', .15); both(g, e, c => { const gr = c.createLinearGradient(12, 0, 52, 0); gr.addColorStop(0, c === g ? '#1a5a8a' : '#666'); gr.addColorStop(.5, c === g ? '#8ae8ff' : '#fff'); gr.addColorStop(1, c === g ? '#1a5a8a' : '#666'); c.fillStyle = gr; c.fillRect(12, 6, 40, 52); }); g.strokeStyle = '#dfe9f2'; g.lineWidth = 3; g.strokeRect(12, 6, 40, 52); },
      floor: (g, e, t) => { grain(g, t.floor, .12); g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; g.strokeRect(.5, .5, 31, 31); g.strokeRect(32.5, 32.5, 31, 31); g.strokeRect(32.5, .5, 31, 31); g.strokeRect(.5, 32.5, 31, 31); },
      ceil: (g, e, t) => { grain(g, t.ceil, .08); panels(g, 2); both(g, e, c => { c.fillStyle = c === g ? '#ffffff' : '#fff'; c.fillRect(10, 10, 12, 12); c.fillRect(42, 42, 12, 12); }); }
    },
    toxic: {
      wall: (g, e, t) => { grain(g, t.wall, .25); bricks(g, '#141e12', 16, 32); g.strokeStyle = '#1f6a1a'; g.lineWidth = 3; for (let i = 0; i < 3; i++) { g.beginPath(); let x = randi(0, 64); g.moveTo(x, 0); for (let y = 0; y <= 64; y += 8) { x += randi(-5, 5); g.lineTo(x, y); } g.stroke(); } for (let i = 0; i < 7; i++) both(g, e, c => { c.fillStyle = c === g ? t.accent : '#fff'; c.beginPath(); c.arc(randi(2, 62), randi(2, 62), 1.4, 0, TAU); c.fill(); }); },
      accent: (g, e, t) => { grain(g, '#1a2a18', .2); g.fillStyle = 'rgba(160,255,140,.12)'; g.fillRect(6, 4, 52, 56); for (let i = 0; i < 6; i++) both(g, e, c => { c.fillStyle = c === g ? '#b8ff4a' : '#fff'; const x = randi(12, 50), y = randi(20, 52); c.beginPath(); c.ellipse(x, y, 4, 7, 0, 0, TAU); c.fill(); }); g.strokeStyle = '#8aa080'; g.lineWidth = 2; g.strokeRect(6, 4, 52, 56); },
      floor: (g, e, t) => { grain(g, t.floor, .3); for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(60,120,40,${rand(.2, .5)})`; g.beginPath(); g.arc(randi(0, 64), randi(0, 64), randi(2, 6), 0, TAU); g.fill(); } },
      ceil: (g, e, t) => { grain(g, t.ceil, .25); for (let i = 0; i < 4; i++) both(g, e, c => { c.fillStyle = c === g ? t.accent : '#fff'; c.fillRect(randi(0, 62), randi(0, 62), 2, 2); }); }
    },
    hive: {
      wall: (g, e, t) => { grain(g, t.wall, .3); for (let y = 0; y < 64; y += 9) { g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, y, 64, 3); } g.lineCap = 'round'; for (let i = 0; i < 3; i++) both(g, e, c => { c.strokeStyle = c === g ? '#ff6ae0' : '#bbb'; c.lineWidth = 1.5; c.beginPath(); let x = randi(0, 64), y = 0; c.moveTo(x, y); while (y < 64) { x += randi(-6, 6); y += 6; c.lineTo(x, y); } c.stroke(); }); },
      accent: (g, e, t) => { grain(g, '#2a1428', .25); for (let i = 0; i < 5; i++) both(g, e, c => { const x = randi(12, 52), y = randi(12, 52); const gr = c.createRadialGradient(x, y, 1, x, y, 9); gr.addColorStop(0, c === g ? '#ffd0ff' : '#fff'); gr.addColorStop(1, c === g ? '#7a2a8a' : '#000'); c.fillStyle = gr; c.beginPath(); c.arc(x, y, 9, 0, TAU); c.fill(); }); },
      floor: (g, e, t) => { grain(g, t.floor, .3); crack(g, e, '#a03ac8', 2); },
      ceil: (g, e, t) => { grain(g, t.ceil, .3); }
    },
    data: {
      wall: (g, e, t) => { grain(g, t.wall, .12); g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 1; for (let i = 0; i <= 64; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 64); g.moveTo(0, i); g.lineTo(64, i); g.stroke(); } both(g, e, c => { c.fillStyle = c === g ? t.accent : '#fff'; c.fillRect(0, 30, 64, 2); c.fillStyle = c === g ? t.accent2 : '#fff'; c.fillRect(46, 8, 2, 16); }); },
      accent: (g, e, t) => { grain(g, '#0a0e16', .1); g.fillStyle = '#151b26'; g.fillRect(6, 2, 52, 60); for (let y = 6; y < 60; y += 6) { g.fillStyle = '#0b0f17'; g.fillRect(8, y, 48, 4); for (let x = 10; x < 54; x += 5) if (Math.random() < .5) both(g, e, c => { c.fillStyle = c === g ? pick(['#46f0d0', '#ff4fa3', '#ffd166', '#6fa8ff']) : '#fff'; c.fillRect(x, y + 1, 2, 2); }); } },
      floor: (g, e, t) => { grain(g, t.floor, .1); g.strokeStyle = t.accent; e.strokeStyle = '#777'; g.lineWidth = e.lineWidth = 1; g.globalAlpha = .45; g.strokeRect(.5, .5, 63, 63); g.globalAlpha = 1; e.strokeRect(.5, .5, 63, 63); },
      ceil: (g, e, t) => { grain(g, t.ceil, .1); both(g, e, c => { c.fillStyle = c === g ? t.accent2 : '#fff'; c.fillRect(30, 0, 4, 64); }); }
    },
    cathedral: {
      wall: (g, e, t) => { grain(g, t.wall, .22); shadeV(g, .06, .3); bricks(g, '#15121b', 16, 24); both(g, e, c => { c.fillStyle = c === g ? t.accent : '#ccc'; c.fillRect(0, 4, 64, 2); }); },
      accent: (g, e, t) => { grain(g, '#1a1622', .2); const cols = ['#ff4f6e', '#4fa3ff', '#ffd166', '#8dff6a', '#c86bff']; for (let y = 6; y < 58; y += 13) for (let x = 14; x < 50; x += 12) both(g, e, c => { c.fillStyle = c === g ? pick(cols) : '#bbb'; c.fillRect(x, y, 11, 12); }); g.strokeStyle = '#100c14'; g.lineWidth = 2; for (let y = 6; y <= 58; y += 13) { g.beginPath(); g.moveTo(14, y); g.lineTo(50, y); g.stroke(); } g.strokeRect(14, 6, 36, 52); },
      floor: (g, e, t) => { for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#3a3444' : '#1e1a24'; g.fillRect(i * 32, j * 32, 32, 32); } grain(g, 'rgba(0,0,0,0)', .2, 300); },
      ceil: (g, e, t) => { grain(g, t.ceil, .2); both(g, e, c => { c.strokeStyle = c === g ? t.accent : '#888'; c.lineWidth = 1; c.beginPath(); c.moveTo(0, 32); c.lineTo(64, 32); c.stroke(); }); }
    },
    lunar: {
      wall: (g, e, t) => { grain(g, t.wall, .08); shadeV(g, .15, .15); panels(g, 2); both(g, e, c => { c.fillStyle = c === g ? t.accent : '#fff'; c.fillRect(0, 44, 64, 3); }); },
      accent: (g, e, t) => { grain(g, '#bfc0b8', .08); both(g, e, c => { c.fillStyle = c === g ? '#020308' : '#000'; c.fillRect(8, 8, 48, 40); if (c === g) { for (let i = 0; i < 18; i++) { c.fillStyle = '#fff'; c.fillRect(randi(9, 55), randi(9, 47), 1, 1); } const gr = c.createRadialGradient(40, 36, 2, 40, 36, 12); gr.addColorStop(0, '#9fd2ff'); gr.addColorStop(1, '#1a4a8a'); c.fillStyle = gr; c.beginPath(); c.arc(40, 36, 10, 0, TAU); c.fill(); } else { c.fillStyle = '#555'; c.beginPath(); c.arc(40, 36, 10, 0, TAU); c.fill(); } }); g.strokeStyle = '#7a7b75'; g.lineWidth = 3; g.strokeRect(8, 8, 48, 40); },
      floor: (g, e, t) => { grain(g, t.floor, .08); g.strokeStyle = 'rgba(0,0,0,.3)'; g.strokeRect(.5, .5, 63, 63); g.fillStyle = '#d8b84a'; g.fillRect(0, 60, 64, 3); },
      ceil: (g, e, t) => { grain(g, t.ceil, .05); panels(g, 2); both(g, e, c => { c.fillStyle = '#fff'; c.fillRect(24, 24, 16, 16); }); }
    },
    inferno: {
      wall: (g, e, t) => { grain(g, t.wall, .3); shadeV(g, .05, .4); panels(g, 2); crack(g, e, '#ff3a1a', 3); },
      accent: (g, e, t) => { grain(g, '#120604', .2); both(g, e, c => { const gr = c.createLinearGradient(0, 64, 0, 10); gr.addColorStop(0, c === g ? '#ffe04a' : '#fff'); gr.addColorStop(.5, c === g ? '#ff4a0a' : '#aaa'); gr.addColorStop(1, c === g ? '#3a0400' : '#111'); c.fillStyle = gr; c.fillRect(8, 10, 48, 50); }); g.fillStyle = '#0a0402'; for (let x = 8; x < 56; x += 8) g.fillRect(x, 10, 3, 50); },
      floor: (g, e, t) => { both(g, e, c => { c.fillStyle = c === g ? '#ff5a1a' : '#999'; c.fillRect(0, 0, 64, 64); }); g.fillStyle = '#1a0806'; e.fillStyle = '#000'; for (let i = 0; i < 64; i += 8) { g.fillRect(i, 0, 6, 64); e.fillRect(i, 0, 6, 64); } },
      ceil: (g, e, t) => { grain(g, t.ceil, .3); crack(g, e, '#ff3a1a', 2); }
    }
  };

  function techTex(t) {
    return texPair((g, e) => {
      grain(g, '#20262c', .15); g.fillStyle = '#0a0d10'; g.fillRect(8, 8, 48, 36);
      both(g, e, c => {
        c.strokeStyle = c === g ? t.accent : '#fff'; c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(11, 34); for (let x = 11; x < 54; x += 4) c.lineTo(x, 34 - randi(2, 18)); c.stroke();
        c.fillStyle = c === g ? t.accent : '#fff'; for (let y = 12; y < 22; y += 4) c.fillRect(12, y, randi(10, 30), 2);
      });
      g.fillStyle = '#3a4248'; g.fillRect(8, 50, 48, 6);
    });
  }
  function doorTex(t) {
    return texPair((g, e) => {
      grain(g, '#3a3d40', .2); shadeV(g, .12, .3);
      for (let y = 6; y < 58; y += 12) { g.fillStyle = '#1a1a1a'; g.beginPath(); g.moveTo(10, y); g.lineTo(32, y + 8); g.lineTo(54, y); g.lineTo(54, y + 5); g.lineTo(32, y + 13); g.lineTo(10, y + 5); g.fill(); g.fillStyle = t.accent; g.globalAlpha = .55; g.fillRect(10, y + 1, 44, 2); g.globalAlpha = 1; }
      g.fillStyle = '#111'; g.fillRect(31, 0, 2, 64);
      both(g, e, c => { c.fillStyle = c === g ? '#ff3a3a' : '#fff'; c.fillRect(26, 28, 12, 8); });
    });
  }
  function exitTex(t) {
    return texPair((g, e) => {
      grain(g, '#101418', .15);
      for (let r = 28; r > 4; r -= 6) both(g, e, c => { c.strokeStyle = c === g ? (r % 12 ? '#46f0d0' : '#ffd166') : '#fff'; c.lineWidth = 2; c.beginPath(); c.arc(32, 32, r, 0, TAU); c.stroke(); });
    });
  }
  function buildTextures(themeId) {
    const t = THEMES[themeId], st = STYLE[themeId];
    const walls = [];
    walls[1] = texPair((g, e) => st.wall(g, e, t));
    walls[2] = texPair((g, e) => st.accent(g, e, t));
    walls[3] = doorTex(t);
    walls[5] = techTex(t);
    walls[6] = texPair((g, e) => st.wall(g, e, t)); // variant with a different random pattern
    return { walls, floor: texPair((g, e) => st.floor(g, e, t)), ceil: texPair((g, e) => st.ceil(g, e, t)), exit: exitTex(t), theme: t, fog: hexRgb(t.fog) };
  }

  /* =====================================================================
     ANIMATED SPRITES (vector drawings converted to pixels)
     ===================================================================== */
  const FRAMES = ['w0', 'w1', 'w2', 'w3', 'a0', 'a1', 'p', 'd0', 'd1', 'd2', 'd3'];
  function spriteFrom(size, fn) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'); fn(g, size);
    return { w: size, h: size, px: new Uint32Array(g.getImageData(0, 0, size, size).data.buffer.slice(0)) };
  }
  const metal = (g, x0, y0, x1, y1, light, dark) => { const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, light); gr.addColorStop(1, dark); return gr; };
  function glowDot(g, x, y, r, col) { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, '#fff'); gr.addColorStop(.35, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
  const isDeath = f => f[0] === 'd', di = f => +f[1] || 0, wi = f => +f[1] || 0;

  const DRAW = {
    drone(g, f) {
      const bob = f[0] === 'w' ? Math.sin(wi(f) / 4 * TAU) * 3 : 0, cy = 44 + bob;
      if (isDeath(f)) {
        const k = di(f);
        g.globalAlpha = 1 - k * .2;
        for (let i = 0; i < 5; i++) { const a = i * 1.3 + k, d = 8 + k * 9; g.fillStyle = metal(g, 0, 0, 0, 20, '#9aa6b8', '#2a3240'); g.beginPath(); g.arc(48 + Math.cos(a) * d, cy + 10 + Math.sin(a) * d * .5 + k * 8, 8 - k, 0, TAU); g.fill(); }
        if (k < 2) glowDot(g, 48, cy + 6, 22 - k * 6, '#ff9a3d');
        return;
      }
      const flap = f[0] === 'w' ? Math.sin(wi(f) / 4 * TAU) * .4 : 0;
      for (const s of [-1, 1]) { g.save(); g.translate(48 + s * 20, cy); g.rotate(s * (.35 + flap)); g.fillStyle = metal(g, 0, -6, 0, 6, '#7c8796', '#1e242e'); g.fillRect(s > 0 ? 0 : -18, -5, 18, 10); g.restore(); }
      g.fillStyle = metal(g, 30, 26, 66, 66, '#c4ccd8', '#1e242e'); g.beginPath(); g.arc(48, cy, 21, 0, TAU); g.fill();
      g.strokeStyle = '#11151b'; g.lineWidth = 2; g.beginPath(); g.arc(48, cy, 21, 0, TAU); g.stroke();
      g.fillStyle = '#0b0d12'; g.beginPath(); g.arc(48, cy + 1, 11, 0, TAU); g.fill();
      const atk = f[0] === 'a';
      glowDot(g, 48, cy + 1, atk ? 14 : 9, f === 'a1' ? '#ffdd55' : '#ff3c3c');
      glowDot(g, 48, cy + 24, 9, '#5fd8ff');
      g.strokeStyle = '#596372'; g.lineWidth = 2; g.beginPath(); g.moveTo(48, cy - 21); g.lineTo(48, cy - 30); g.stroke();
      if (f === 'p') { g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(0, 0, 96, 96); }
    },
    soldier(g, f) {
      const dead = isDeath(f), k = di(f);
      if (dead && k >= 2) {
        g.fillStyle = metal(g, 0, 70, 0, 90, '#58606a', '#1a1d22'); g.beginPath(); g.ellipse(48, 84, 34, 8, 0, 0, TAU); g.fill();
        g.fillStyle = '#2a2e34'; g.fillRect(24, 76, 46, 9); glowDot(g, 72, 80, 5, k === 2 ? '#ff3c3c' : '#551010'); return;
      }
      g.save();
      if (dead) { g.translate(48, 92); g.rotate(k ? .9 : .35); g.translate(-48, -92); }
      if (f === 'p') { g.translate(48, 92); g.rotate(-.12); g.translate(-48, -92); }
      const step = f[0] === 'w' ? Math.sin(wi(f) / 4 * TAU) : 0;
      for (const s of [-1, 1]) { g.fillStyle = metal(g, 0, 60, 0, 94, '#4a525c', '#15181c'); g.save(); g.translate(48 + s * 7, 60); g.rotate(s * step * .35); g.fillRect(-5, 0, 10, 32); g.fillStyle = '#0e1012'; g.fillRect(-6, 28, 12, 6); g.restore(); }
      g.fillStyle = metal(g, 30, 30, 66, 62, '#7d8794', '#22262c'); g.beginPath(); g.roundRect(32, 30, 32, 32, 6); g.fill();
      g.fillStyle = '#b8462e'; g.fillRect(36, 38, 24, 4);
      g.fillStyle = metal(g, 38, 12, 58, 30, '#9aa3ae', '#2a2e34'); g.beginPath(); g.roundRect(37, 12, 22, 20, 7); g.fill();
      glowDot(g, 48, 22, 8, '#ff3c3c'); g.fillStyle = '#ff6a5a'; g.fillRect(41, 20, 14, 3);
      const aim = f[0] === 'a';
      g.save(); g.translate(48, 42); g.rotate(aim ? -.1 : .55);
      g.fillStyle = '#1a1d22'; g.fillRect(-4, -4, 34, 8); g.fillStyle = '#3a4048'; g.fillRect(10, -6, 12, 4);
      if (f === 'a1') glowDot(g, 34, 0, 14, '#ffd166');
      if (f === 'a0') glowDot(g, 31, 0, 5, '#ff3c3c');
      g.restore(); g.restore();
    },
    brute(g, f) {
      const dead = isDeath(f), k = di(f);
      if (dead && k >= 2) { g.fillStyle = metal(g, 0, 60, 0, 94, '#6a5a50', '#1c1612'); g.beginPath(); g.ellipse(48, 82, 42, 12, 0, 0, TAU); g.fill(); glowDot(g, 40, 80, 6, k === 2 ? '#ff8a3d' : '#3a1a08'); return; }
      g.save();
      if (dead) { g.translate(48, 94); g.rotate(-(k ? .8 : .3)); g.translate(-48, -94); }
      const step = f[0] === 'w' ? Math.sin(wi(f) / 4 * TAU) : 0, sway = step * 2;
      for (const s of [-1, 1]) { g.fillStyle = metal(g, 0, 64, 0, 94, '#5a4e46', '#1a1410'); g.save(); g.translate(48 + s * 14 + sway, 66); g.rotate(s * step * .25); g.fillRect(-8, 0, 16, 26); g.restore(); }
      g.fillStyle = metal(g, 18, 18, 78, 70, '#a08070', '#2a1e18'); g.beginPath(); g.ellipse(48 + sway, 46, 30, 26, 0, 0, TAU); g.fill();
      g.fillStyle = '#3a2a22'; g.fillRect(28 + sway, 40, 40, 6);
      g.fillStyle = metal(g, 40, 14, 56, 30, '#8a7466', '#2a1e18'); g.beginPath(); g.arc(48 + sway, 24, 9, 0, TAU); g.fill();
      glowDot(g, 44 + sway, 23, 4, '#ffb03a'); glowDot(g, 52 + sway, 23, 4, '#ffb03a');
      const up = f === 'a0' ? -28 : f === 'a1' ? 14 : 0;
      for (const s of [-1, 1]) { g.fillStyle = metal(g, 0, 40, 0, 80, '#9a8070', '#2a1e18'); g.beginPath(); g.arc(48 + s * 34 + sway, 58 + up * (s > 0 ? 1 : .6), 13, 0, TAU); g.fill(); g.fillStyle = '#d0b090'; g.fillRect(48 + s * 34 - 8 + sway, 54 + up * (s > 0 ? 1 : .6), 16, 3); }
      if (f === 'p') { g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(255,255,255,.45)'; g.fillRect(0, 0, 96, 96); }
      g.restore();
    },
    spider(g, f) {
      const dead = isDeath(f), k = di(f), step = f[0] === 'w' ? wi(f) : 0;
      const cy = 70;
      for (let i = 0; i < 3; i++) for (const s of [-1, 1]) {
        const ph = (step + i + (s > 0 ? 2 : 0)) % 4, lift = dead ? 10 + k * 4 : (ph < 2 ? -5 : 2);
        g.strokeStyle = '#2a2a30'; g.lineWidth = 3; g.lineCap = 'round';
        g.beginPath(); g.moveTo(48 + s * 8, cy); g.lineTo(48 + s * (22 + i * 6), cy - 14 + lift); g.lineTo(48 + s * (30 + i * 7), dead ? cy + 4 : 90); g.stroke();
      }
      g.fillStyle = metal(g, 30, 52, 66, 86, '#7a7f8c', '#1c1e24'); g.beginPath(); g.ellipse(48, cy, 18, 12, 0, 0, TAU); g.fill();
      g.fillStyle = metal(g, 30, 52, 66, 86, '#5a5f6c', '#141518'); g.beginPath(); g.ellipse(48, cy + 8, 14, 9, 0, 0, TAU); g.fill();
      if (!dead || k < 2) for (const [x, y] of [[42, 66], [48, 64], [54, 66], [45, 70], [51, 70]]) glowDot(g, x, y, f[0] === 'a' ? 5 : 3.5, '#ff3c8c');
      if (f === 'a0' || f === 'a1') { g.strokeStyle = '#3a3a44'; g.lineWidth = 3; for (const s of [-1, 1]) { g.beginPath(); g.moveTo(48 + s * 6, cy - 6); g.lineTo(48 + s * 12, cy - (f === 'a1' ? 30 : 22)); g.stroke(); } }
      if (f === 'p') { g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(0, 0, 96, 96); }
    },
    kamikaze(g, f) {
      if (isDeath(f)) return;
      const k = f[0] === 'a' ? (f === 'a1' ? 1.25 : 1.12) : 1, rot = f[0] === 'w' ? wi(f) * .4 : 0;
      g.save(); g.translate(48, 66); g.scale(k, k);
      for (let i = 0; i < 8; i++) { g.save(); g.rotate(rot + i * TAU / 8); g.fillStyle = '#3a3a40'; g.beginPath(); g.moveTo(-4, -18); g.lineTo(0, -28); g.lineTo(4, -18); g.fill(); g.restore(); }
      g.fillStyle = metal(g, -18, -18, 18, 18, '#a0a6b0', '#22252a'); g.beginPath(); g.arc(0, 0, 19, 0, TAU); g.fill();
      g.fillStyle = '#d23a2a'; g.fillRect(-19, -3, 38, 6);
      glowDot(g, 0, 0, f[0] === 'a' ? 16 : 8, f === 'a1' ? '#ffffff' : '#ff3c3c');
      g.restore();
    },
    turret(g, f) {
      const dead = isDeath(f), k = di(f);
      g.fillStyle = metal(g, 0, 70, 0, 94, '#4a525c', '#121418'); g.beginPath(); g.moveTo(26, 94); g.lineTo(34, 66); g.lineTo(62, 66); g.lineTo(70, 94); g.fill();
      if (dead && k >= 1) { g.fillStyle = '#1a1c20'; g.beginPath(); g.ellipse(48, 64, 20, 9, .3, 0, TAU); g.fill(); if (k < 3) glowDot(g, 46, 60, 10 - k * 2, '#ff8a3d'); return; }
      const sw = f[0] === 'w' ? Math.sin(wi(f) / 4 * TAU) * 2 : 0;
      g.fillStyle = metal(g, 28, 34, 68, 70, '#8a949e', '#1c2026'); g.beginPath(); g.roundRect(28 + sw, 36, 40, 30, 8); g.fill();
      g.fillStyle = '#16181c'; for (const dx of [-8, 0, 8]) g.fillRect(44 + dx + sw, 44, 6, 26);
      glowDot(g, 48 + sw, 46, 7, '#46f0d0');
      if (f === 'a0') glowDot(g, 48 + sw, 72, 10, '#ff5a3c');
      if (f === 'a1') glowDot(g, 48 + sw, 74, 20, '#ffd166');
      if (f === 'p') { g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(0, 0, 96, 96); }
    },
    summoner(g, f) {
      const dead = isDeath(f), k = di(f);
      if (dead) g.globalAlpha = 1 - k * .24;
      const bob = f[0] === 'w' ? Math.sin(wi(f) / 4 * TAU) * 3 : 0, sc = dead ? 1 - k * .15 : 1;
      g.save(); g.translate(48, 50 + bob + (dead ? k * 8 : 0)); g.scale(sc, sc);
      const gr = g.createLinearGradient(0, -34, 0, 40); gr.addColorStop(0, '#6a4ab8'); gr.addColorStop(1, 'rgba(30,10,60,0)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(0, -34); g.quadraticCurveTo(26, -10, 22, 40); g.lineTo(-22, 40); g.quadraticCurveTo(-26, -10, 0, -34); g.fill();
      g.fillStyle = '#e8dcff'; g.beginPath(); g.ellipse(0, -18, 8, 10, 0, 0, TAU); g.fill();
      glowDot(g, -3, -19, 4, '#c86bff'); glowDot(g, 3, -19, 4, '#c86bff');
      const atk = f[0] === 'a', spread = atk ? 30 : 22;
      for (let i = 0; i < 2; i++) { const a = (f[0] === 'w' ? wi(f) : 0) * .8 + i * Math.PI; glowDot(g, Math.cos(a) * spread, -4 + Math.sin(a) * 8 - (atk ? 14 : 0), atk ? 10 : 7, '#c86bff'); }
      g.restore();
      if (f === 'p') { g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(0, 0, 96, 96); }
    }
  };

  // Bosses: 160 px canvases with extra detail.
  const DRAW_BOSS = {
    colossus(g, f) {
      const dead = isDeath(f), k = di(f), step = f[0] === 'w' ? Math.sin(wi(f) / 4 * TAU) : 0;
      g.save();
      if (dead) { g.translate(80, 158); g.rotate(-k * .25); g.translate(-80, -158); g.globalAlpha = 1 - k * .15; }
      for (const s of [-1, 1]) { g.fillStyle = metal(g, 0, 100, 0, 158, '#6a5a4e', '#16110d'); g.save(); g.translate(80 + s * 24, 104); g.rotate(s * step * .22); g.fillRect(-13, 0, 26, 48); g.fillStyle = '#0e0b08'; g.fillRect(-16, 44, 32, 10); g.restore(); }
      g.fillStyle = metal(g, 30, 40, 130, 110, '#b08a6a', '#2a1c12'); g.beginPath(); g.roundRect(36, 44, 88, 64, 16); g.fill();
      const furnace = g.createRadialGradient(80, 76, 2, 80, 76, 20); furnace.addColorStop(0, '#fff2b0'); furnace.addColorStop(.4, '#ff8a2a'); furnace.addColorStop(1, 'rgba(120,30,0,0)'); g.fillStyle = furnace; g.beginPath(); g.arc(80, 76, 20, 0, TAU); g.fill();
      for (const s of [-1, 1]) {
        g.fillStyle = metal(g, 0, 20, 0, 60, '#8a7464', '#21160f'); g.beginPath(); g.roundRect(80 + s * 46 - 18, 24, 36, 34, 8); g.fill();
        for (let i = 0; i < 3; i++) { g.fillStyle = '#120c08'; g.beginPath(); g.arc(80 + s * 46 - 9 + i * 9, 36, 4, 0, TAU); g.fill(); if (f[0] === 'a') glowDot(g, 80 + s * 46 - 9 + i * 9, 36, f === 'a1' ? 9 : 5, '#ffb03a'); }
      }
      g.fillStyle = metal(g, 66, 22, 94, 46, '#9a8474', '#2a1e14'); g.beginPath(); g.roundRect(66, 24, 28, 24, 6); g.fill();
      glowDot(g, 80, 36, 8, '#ff3c3c');
      if (f === 'p') { g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(255,255,255,.45)'; g.fillRect(0, 0, 160, 160); }
      g.restore();
    },
    queen(g, f) {
      const dead = isDeath(f), k = di(f), step = f[0] === 'w' ? wi(f) : 0;
      if (dead) g.globalAlpha = 1 - k * .18;
      const cy = 112;
      for (let i = 0; i < 4; i++) for (const s of [-1, 1]) {
        const ph = (step + i + (s > 0 ? 2 : 0)) % 4, lift = dead ? 18 : (ph < 2 ? -8 : 3);
        g.strokeStyle = '#2c1e34'; g.lineWidth = 5; g.lineCap = 'round';
        g.beginPath(); g.moveTo(80 + s * 14, cy); g.lineTo(80 + s * (40 + i * 9), cy - 26 + lift); g.lineTo(80 + s * (52 + i * 10), dead ? cy + 8 : 156); g.stroke();
      }
      const ab = g.createRadialGradient(80, cy + 14, 4, 80, cy + 14, 40); ab.addColorStop(0, '#f0a0ff'); ab.addColorStop(.5, '#6a2a8a'); ab.addColorStop(1, '#1c0a24');
      g.fillStyle = ab; g.beginPath(); g.ellipse(80, cy + 16, 38, 26, 0, 0, TAU); g.fill();
      g.fillStyle = metal(g, 50, 70, 110, 120, '#9a7ab0', '#1c1024'); g.beginPath(); g.ellipse(80, cy - 10, 26, 22, 0, 0, TAU); g.fill();
      g.fillStyle = '#ffd166'; g.beginPath(); g.moveTo(64, cy - 28); g.lineTo(70, cy - 46); g.lineTo(76, cy - 32); g.lineTo(80, cy - 50); g.lineTo(84, cy - 32); g.lineTo(90, cy - 46); g.lineTo(96, cy - 28); g.fill();
      for (const [x, y] of [[72, cy - 14], [80, cy - 18], [88, cy - 14], [76, cy - 8], [84, cy - 8]]) glowDot(g, x, y, f[0] === 'a' ? 7 : 5, '#ff3c8c');
      if (f === 'a1') glowDot(g, 80, cy + 2, 22, '#9dff3a');
      if (f === 'p') { g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(255,255,255,.45)'; g.fillRect(0, 0, 160, 160); }
    },
    mind(g, f) {
      const dead = isDeath(f), k = di(f), rot = (f[0] === 'w' ? wi(f) : f[0] === 'a' ? 2 : 0) * .4;
      if (dead) g.globalAlpha = 1 - k * .22;
      g.save(); g.translate(80, 72);
      for (let i = 0; i < 6; i++) {
        const a = rot + i * TAU / 6, d = (f[0] === 'a' ? 54 : 46) + (dead ? k * 14 : 0);
        g.save(); g.translate(Math.cos(a) * d, Math.sin(a) * d * .55); g.rotate(a);
        const gr = g.createLinearGradient(-8, -14, 8, 14); gr.addColorStop(0, '#e8fbff'); gr.addColorStop(1, '#3a8ab8'); g.fillStyle = gr;
        g.beginPath(); g.moveTo(0, -14); g.lineTo(7, 0); g.lineTo(0, 14); g.lineTo(-7, 0); g.fill(); g.restore();
      }
      if (!dead || k < 3) {
        const gr = g.createLinearGradient(-30, -44, 30, 44); gr.addColorStop(0, '#ffffff'); gr.addColorStop(.5, '#7ad8ff'); gr.addColorStop(1, '#1a3a6a'); g.fillStyle = gr;
        g.beginPath(); g.moveTo(0, -46); g.lineTo(28, 0); g.lineTo(0, 46); g.lineTo(-28, 0); g.fill();
        g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, -46); g.lineTo(0, 46); g.moveTo(-28, 0); g.lineTo(28, 0); g.stroke();
        glowDot(g, 0, 0, f[0] === 'a' ? 26 : 16, f === 'a1' ? '#ffffff' : '#ff4fd8');
      }
      g.restore();
      if (f === 'p') { g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(255,255,255,.45)'; g.fillRect(0, 0, 160, 160); }
    },
    forge(g, f) {
      const dead = isDeath(f), k = di(f), step = f[0] === 'w' ? Math.sin(wi(f) / 4 * TAU) : 0;
      g.save();
      if (dead) { g.translate(80, 158); g.rotate(k * .22); g.translate(-80, -158); g.globalAlpha = 1 - k * .15; }
      for (const s of [-1, 1]) { g.fillStyle = metal(g, 0, 100, 0, 158, '#4a2a22', '#120604'); g.save(); g.translate(80 + s * 22, 106); g.rotate(s * step * .22); g.fillRect(-12, 0, 24, 46); g.restore(); }
      g.fillStyle = metal(g, 30, 30, 130, 110, '#7a3a2a', '#1a0806'); g.beginPath(); g.moveTo(34, 50); g.lineTo(126, 50); g.lineTo(112, 110); g.lineTo(48, 110); g.fill();
      const fr = g.createRadialGradient(80, 78, 2, 80, 78, 26); fr.addColorStop(0, '#fff6c0'); fr.addColorStop(.35, '#ff7a1a'); fr.addColorStop(1, 'rgba(90,10,0,0)'); g.fillStyle = fr; g.beginPath(); g.arc(80, 78, 26, 0, TAU); g.fill();
      g.fillStyle = '#1a0806'; for (let x = 62; x < 100; x += 8) g.fillRect(x, 60, 3, 36);
      g.fillStyle = metal(g, 60, 16, 100, 52, '#8a4a3a', '#1a0806'); g.beginPath(); g.roundRect(62, 22, 36, 30, 8); g.fill();
      g.fillStyle = '#d8c8a0'; for (const s of [-1, 1]) { g.beginPath(); g.moveTo(80 + s * 14, 26); g.lineTo(80 + s * 30, 2); g.lineTo(80 + s * 20, 28); g.fill(); }
      glowDot(g, 73, 36, 6, '#ff2a1a'); glowDot(g, 87, 36, 6, '#ff2a1a');
      for (const s of [-1, 1]) { g.fillStyle = metal(g, 0, 50, 0, 100, '#6a3a2a', '#140604'); g.save(); g.translate(80 + s * 52, 62); g.rotate(s * (f[0] === 'a' ? -.6 : .15)); g.fillRect(-10, 0, 20, 44); g.fillStyle = '#0a0302'; g.fillRect(-7, 40, 14, 10); if (f[0] === 'a') glowDot(g, 0, 50, f === 'a1' ? 16 : 9, '#ff8a2a'); g.restore(); }
      if (f === 'p') { g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(255,255,255,.45)'; g.fillRect(0, 0, 160, 160); }
      g.restore();
    }
  };

  const SPR = {};
  for (const k in DRAW) { SPR[k] = {}; for (const f of FRAMES) SPR[k][f] = spriteFrom(128, g => { g.scale(128 / 96, 128 / 96); DRAW[k](g, f); }); }
  for (const k in DRAW_BOSS) { SPR[k] = {}; for (const f of FRAMES) SPR[k][f] = spriteFrom(224, g => { g.scale(1.4, 1.4); DRAW_BOSS[k](g, f); }); }

  // Floor pickups
  const ITEM_SPR = {};
  const itemSprite = (id, fn) => { ITEM_SPR[id] = spriteFrom(48, fn); };
  const box = (g, c1, c2, label) => { g.fillStyle = metal(g, 0, 18, 0, 46, c1, c2); g.beginPath(); g.roundRect(9, 20, 30, 24, 4); g.fill(); g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(9, 20, 30, 3); g.fillStyle = '#111'; g.font = '700 10px sans-serif'; g.textAlign = 'center'; g.fillText(label, 24, 37); };
  itemSprite('shells', g => box(g, '#d0503a', '#5a1a10', '|||'));
  itemSprite('bullets', g => box(g, '#e0b040', '#5a4010', '≡'));
  itemSprite('cells', g => { g.fillStyle = metal(g, 0, 14, 0, 46, '#6fd0ff', '#1a4a6a'); g.beginPath(); g.roundRect(15, 16, 18, 28, 4); g.fill(); glowDot(g, 24, 30, 9, '#46e0ff'); g.fillStyle = '#ddd'; g.fillRect(20, 12, 8, 4); });
  itemSprite('rockets', g => box(g, '#7a8a4a', '#2a3214', '▲'));
  itemSprite('health', g => { g.fillStyle = metal(g, 0, 16, 0, 46, '#f4f4f4', '#9a9a9a'); g.beginPath(); g.roundRect(10, 18, 28, 26, 5); g.fill(); g.fillStyle = '#e03a3a'; g.fillRect(21, 22, 6, 18); g.fillRect(15, 28, 18, 6); });
  itemSprite('healthBig', g => { g.fillStyle = metal(g, 0, 10, 0, 46, '#ffffff', '#8a8a8a'); g.beginPath(); g.roundRect(5, 12, 38, 32, 6); g.fill(); g.fillStyle = '#e03a3a'; g.fillRect(20, 16, 8, 24); g.fillRect(12, 24, 24, 8); });
  itemSprite('armor', g => { g.fillStyle = metal(g, 0, 10, 0, 46, '#8ad8ff', '#1a3a6a'); g.beginPath(); g.moveTo(24, 10); g.lineTo(40, 18); g.lineTo(36, 38); g.lineTo(24, 46); g.lineTo(12, 38); g.lineTo(8, 18); g.fill(); g.strokeStyle = '#dff6ff'; g.lineWidth = 2; g.stroke(); });
  itemSprite('key', g => { glowDot(g, 24, 30, 18, '#ffd166'); g.fillStyle = '#ffd166'; g.beginPath(); g.roundRect(13, 20, 22, 15, 3); g.fill(); g.fillStyle = '#5a3a0a'; g.fillRect(16, 24, 10, 3); g.fillRect(16, 29, 14, 2); });
  itemSprite('module', g => { g.fillStyle = '#20242c'; g.beginPath(); g.roundRect(12, 18, 24, 24, 4); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); for (let i = 0; i < 4; i++) { g.fillStyle = '#c8c8c8'; g.fillRect(15 + i * 6, 14, 2, 4); g.fillRect(15 + i * 6, 42, 2, 4); } g.fillStyle = '#fff'; g.fillRect(19, 25, 10, 10); });
  itemSprite('chest', g => { g.fillStyle = metal(g, 0, 16, 0, 46, '#8a6a3a', '#2a1a0a'); g.beginPath(); g.roundRect(6, 22, 36, 22, 4); g.fill(); g.fillStyle = metal(g, 0, 10, 0, 24, '#b08a4a', '#4a2a0a'); g.beginPath(); g.roundRect(6, 12, 36, 12, 6); g.fill(); g.fillStyle = '#ffd166'; g.fillRect(21, 20, 6, 8); });
  const WEAPON_ICON = {};

  // Additive glows (projectiles, sparks, flashes)
  const GLOW = {};
  function glowTex(color) {
    if (GLOW[color]) return GLOW[color];
    return (GLOW[color] = spriteFrom(32, g => glowDot(g, 16, 16, 16, color)));
  }

  /* =====================================================================
     GAME DATA: levels, weapons, enemies, bosses, loot
     ===================================================================== */
  const CAMPAIGN = [
    { theme: 'industrial' }, { theme: 'foundry' }, { theme: 'foundry', boss: 'colossus' },
    { theme: 'cryo' }, { theme: 'toxic' }, { theme: 'hive', boss: 'queen' },
    { theme: 'data' }, { theme: 'cathedral' }, { theme: 'cathedral', boss: 'mind' },
    { theme: 'lunar' }, { theme: 'inferno' }, { theme: 'inferno', boss: 'forge' }
  ];
  const levelInfo = i => i < CAMPAIGN.length ? CAMPAIGN[i] : { theme: pick(Object.keys(THEMES)), boss: (i + 1) % 3 === 0 ? pick(['colossus', 'queen', 'mind', 'forge']) : null };
  const WEAPON_UNLOCK = { 0: 'shotgun', 1: 'minigun', 3: 'rail', 4: 'launcher', 6: 'tesla' };

  const WEAPONS = {
    blaster: { name: 'Pulse Blaster', slot: 1, ammo: null, rate: .17, dmg: 15, color: '#46e0ff', desc: 'Unlimited ammo, but it overheats' },
    shotgun: { name: 'Scatter Shotgun', slot: 2, ammo: 'shells', mag: 6, rate: .82, dmg: 10, pellets: 9, spread: .13, shell: .38, color: '#ffb35a', desc: 'Nine pellets; loads one shell at a time' },
    minigun: { name: 'Rotary Cannon', slot: 3, ammo: 'bullets', mag: 90, rate: .055, dmg: 7.5, spinup: .5, reload: 2.3, color: '#ffd166', desc: 'Spins up its barrels, then spits lead' },
    rail: { name: 'Railgun', slot: 4, ammo: 'cells', mag: 5, rate: .5, dmg: 130, charge: .65, reload: 2.4, color: '#7ad8ff', desc: 'Charged shot that pierces everything' },
    launcher: { name: 'Rocket Launcher', slot: 5, ammo: 'rockets', mag: 4, rate: .85, dmg: 95, splash: 2.3, reload: 2.6, color: '#ff8a3d', desc: 'Splash damage. Never fire point-blank!' },
    tesla: { name: 'Tesla Arc', slot: 6, ammo: 'cells', dmg: 9, range: 7.5, chains: 3, perCell: .32, color: '#b98cff', desc: 'Continuous beam that chains between enemies' }
  };
  const ORDER = ['blaster', 'shotgun', 'minigun', 'rail', 'launcher', 'tesla'];
  const POOL_MAX = { shells: 48, bullets: 400, cells: 60, rockets: 20 };
  const AMMO_PICK = { shells: 8, bullets: 60, cells: 10, rockets: 3 };

  const ENEMY = {
    drone: { name: 'Sentinel', hp: 40, speed: 1.9, r: .32, h: .7, z: .35, ranged: true, range: 11, keep: [3.5, 7], cd: [1.5, 2.3], proj: 'orb', dmg: 10, score: 60, unlock: 0 },
    soldier: { name: 'Enforcer', hp: 58, speed: 1.6, r: .3, h: 1, ranged: true, range: 13, keep: [4, 9], cd: [1.7, 2.6], proj: 'bolt', burst: 3, dmg: 7, score: 80, unlock: 0 },
    spider: { name: 'Stalker', hp: 26, speed: 3.3, r: .28, h: .48, melee: true, dmg: 7, cd: [.55, .75], score: 40, unlock: 1 },
    kamikaze: { name: 'Detonator', hp: 30, speed: 2.75, r: .3, h: .55, kamikaze: true, dmg: 34, score: 50, unlock: 2 },
    brute: { name: 'Brute', hp: 200, speed: 1.35, r: .45, h: 1.25, melee: true, charger: true, dmg: 20, cd: [1, 1.4], score: 200, unlock: 3 },
    turret: { name: 'Turret', hp: 130, speed: 0, r: .4, h: .85, ranged: true, range: 15, cd: [2.2, 3], proj: 'orb', burst: 4, spreadA: .16, dmg: 9, score: 150, unlock: 4 },
    summoner: { name: 'Conduit', hp: 115, speed: 1.5, r: .35, h: 1.05, z: .1, ranged: true, range: 12, keep: [5, 9], cd: [2.2, 3], proj: 'seeker', dmg: 12, summoner: true, score: 250, unlock: 6 }
  };
  const BOSS = {
    colossus: { name: 'Molten Colossus', hp: 1600, speed: 1.05, r: .9, h: 2.3, color: '#ff8a3d' },
    queen: { name: 'Swarm Queen', hp: 1350, speed: 2.1, r: .85, h: 1.7, color: '#d06aff' },
    mind: { name: 'Crystal Mind', hp: 1450, speed: 1.4, r: .7, h: 1.7, z: .45, color: '#7ad8ff' },
    forge: { name: 'Forge Lord', hp: 3300, speed: 1.25, r: 1, h: 2.5, color: '#ff3a1a' }
  };
  const PROJ = {
    orb: { speed: 6.5, r: .16, color: '#ff5a3c', size: .35 },
    bolt: { speed: 13, r: .1, color: '#ffd166', size: .22 },
    seeker: { speed: 4.6, r: .16, color: '#c86bff', size: .4, homing: 1.1 },
    acid: { speed: 7.5, r: .16, color: '#9dff3a', size: .38 },
    shard: { speed: 8.5, r: .12, color: '#9fe8ff', size: .3 },
    rocketE: { speed: 8.5, r: .18, color: '#ff8a3d', size: .4, splash: 1.6 },
    plasma: { speed: 22, r: .12, color: '#46e0ff', size: .3 },
    rocket: { speed: 13, r: .16, color: '#ffb35a', size: .4 }
  };

  const RARITY = [
    { id: 'common', name: 'Common', color: '#cfd8e8', w: 60 },
    { id: 'rare', name: 'Rare', color: '#4fa3ff', w: 27 },
    { id: 'epic', name: 'Epic', color: '#c86bff', w: 10 },
    { id: 'legendary', name: 'Legendary', color: '#ffd166', w: 3 }
  ];
  const MODS = [
    { id: 'dmg', name: 'Overcharged Rounds', vals: [.1, .18, .28, .4], fmt: v => `+${Math.round(v * 100)}% damage` },
    { id: 'rate', name: 'Hair Trigger', vals: [.08, .14, .2, .28], fmt: v => `+${Math.round(v * 100)}% fire rate` },
    { id: 'reload', name: 'Speed Loader', vals: [.15, .25, .35, .5], fmt: v => `Reload ${Math.round(v * 100)}% faster` },
    { id: 'mag', name: 'Extended Mags', vals: [.2, .35, .5, .75], fmt: v => `+${Math.round(v * 100)}% magazine size` },
    { id: 'speed', name: 'Servo Boost', vals: [.06, .1, .15, .2], fmt: v => `+${Math.round(v * 100)}% movement speed` },
    { id: 'leech', name: 'Vampirism', vals: [1, 2, 3, 5], fmt: v => `Heal ${v} health per kill` },
    { id: 'crit', name: 'Deadeye', vals: [.05, .09, .14, .2], fmt: v => `${Math.round(v * 100)}% crit chance (×2.5)` },
    { id: 'armorMax', name: 'Reactive Plating', vals: [15, 25, 40, 60], fmt: v => `+${v} max armour` },
    { id: 'hpMax', name: 'Bionic Graft', vals: [10, 15, 25, 35], fmt: v => `+${v} max health` },
    { id: 'splash', name: 'Blast Charge', vals: [.15, .25, .4, .6], fmt: v => `+${Math.round(v * 100)}% blast radius` }
  ];

  /* =====================================================================
     STATE
     ===================================================================== */
  let mode = 'menu';
  let run = null, L = null, P = null, T = null;
  let enemies = [], projectiles = [], items = [], particles = [], rings = [], beams = [], toasts = [], dmgDirs = [];
  let time = 0, flash = 0, hurtFlash = 0, shake = 0, hitMark = 0, critMark = 0, lightBoost = 0, banner = null;
  const keys = Object.create(null);
  let mouseDown = false, locked = false, padPrev = [], pad = { mx: 0, my: 0, lx: 0, ly: 0, fire: false };

  /* =====================================================================
     MAP GENERATOR
     ===================================================================== */
  function genLevel(idx) {
    const info = levelInfo(idx), boss = info.boss;
    const N = clamp(28 + idx * 2, 28, 46);
    const map = new Uint8Array(N * N).fill(1);
    const at = (x, y) => map[y * N + x];
    const set = (x, y, v) => { if (x > 0 && y > 0 && x < N - 1 && y < N - 1) map[y * N + x] = v; };
    const rooms = [];
    const overlaps = r => rooms.some(o => r.x < o.x + o.w + 2 && r.x + r.w + 2 > o.x && r.y < o.y + o.h + 2 && r.y + r.h + 2 > o.y);
    if (boss) { const r = { x: N - 15, y: N - 15, w: 12, h: 12, arena: true }; rooms.push(r); }
    const target = Math.min(16, 7 + idx);
    for (let tries = 0; tries < 400 && rooms.length < target; tries++) {
      const w = randi(4, 9), h = randi(4, 9), r = { x: randi(1, N - w - 2), y: randi(1, N - h - 2), w, h };
      if (!overlaps(r)) rooms.push(r);
    }
    for (const r of rooms) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) set(x, y, 0);
    const center = r => ({ x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) });
    // Starting room: the one furthest from the arena / bottom-right corner
    let start = rooms.reduce((b, r) => (r.x + r.y < b.x + b.y && !r.arena ? r : b), rooms.find(r => !r.arena));
    const dist = (a, b) => { const ca = center(a), cb = center(b); return Math.hypot(ca.x - cb.x, ca.y - cb.y); };
    // The exit room is the furthest one (or the boss arena) and has only one connection.
    const exitRoom = boss ? rooms.find(r => r.arena) : rooms.filter(r => r !== start).reduce((b, r) => dist(r, start) > dist(b, start) ? r : b);
    // No-go zone for corridors: the exit room and its outline (the door will be its only way in).
    const forbid = new Uint8Array(N * N);
    if (!boss) for (let y = exitRoom.y - 1; y <= exitRoom.y + exitRoom.h; y++) for (let x = exitRoom.x - 1; x <= exitRoom.x + exitRoom.w; x++) if (x >= 0 && y >= 0 && x < N && y < N) forbid[y * N + x] = 1;
    // Breadth-first corridor: always connects and never crosses the no-go zone.
    const carveBFS = (sx, sy, tx, ty) => {
      const prev = new Int32Array(N * N).fill(-1), q = [sy * N + sx]; prev[sy * N + sx] = sy * N + sx;
      const dirs = Math.random() < .5 ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [[0, 1], [0, -1], [1, 0], [-1, 0]];
      for (let h = 0; h < q.length; h++) {
        const c = q[h], x = c % N, y = (c / N) | 0;
        if (x === tx && y === ty) break;
        for (const [dx, dy] of dirs) {
          const nx = x + dx, ny = y + dy, ni = ny * N + nx;
          if (nx < 1 || ny < 1 || nx > N - 2 || ny > N - 2 || prev[ni] >= 0 || forbid[ni]) continue;
          prev[ni] = c; q.push(ni);
        }
      }
      let c = ty * N + tx; if (prev[c] < 0) return;
      while (c !== prev[c]) { const x = c % N, y = (c / N) | 0; set(x, y, 0); if (idx >= 6 && Math.random() < .25 && !forbid[y * N + x + 1]) set(x + 1, y, 0); c = prev[c]; }
      set(sx, sy, 0);
    };
    const carve = (a, b) => { const ca = center(a), cb = center(b); carveBFS(ca.x, ca.y, cb.x, cb.y); };
    // Minimum spanning tree between the rooms (excluding the exit room), plus a few loops.
    const others = rooms.filter(r => r !== exitRoom), inTree = [start], edges = [];
    while (inTree.length < others.length) {
      let best = null;
      for (const a of inTree) for (const b of others) if (!inTree.includes(b)) { const d = dist(a, b); if (!best || d < best.d) best = { a, b, d }; }
      inTree.push(best.b); edges.push([best.a, best.b]);
    }
    for (let i = 0; i < 2 + Math.floor(idx / 3); i++) { const a = pick(others), b = pick(others); if (a !== b) edges.push([a, b]); }
    for (const [a, b] of edges) carve(a, b);
    const link = others.reduce((b, r) => dist(r, exitRoom) < dist(b, exitRoom) ? r : b);
    let door = null;
    if (boss) carve(exitRoom, link);
    else {
      // The door goes on the side of the room that faces the neighbouring room.
      const ce = center(exitRoom), cl = center(link), r = exitRoom;
      const sides = [
        { dx: 1, dy: 0, x: r.x + r.w, y: clamp(cl.y, r.y, r.y + r.h - 1) }, { dx: -1, dy: 0, x: r.x - 1, y: clamp(cl.y, r.y, r.y + r.h - 1) },
        { dx: 0, dy: 1, x: clamp(cl.x, r.x, r.x + r.w - 1), y: r.y + r.h }, { dx: 0, dy: -1, x: clamp(cl.x, r.x, r.x + r.w - 1), y: r.y - 1 }
      ].sort((a, b) => ((cl.x - ce.x) * b.dx + (cl.y - ce.y) * b.dy) - ((cl.x - ce.x) * a.dx + (cl.y - ce.y) * a.dy));
      const sd = sides.find(s => s.x + s.dx >= 1 && s.x + s.dx <= N - 2 && s.y + s.dy >= 1 && s.y + s.dy <= N - 2);
      door = { x: sd.x, y: sd.y }; map[sd.y * N + sd.x] = 3;
      carveBFS(sd.x + sd.dx, sd.y + sd.dy, cl.x, cl.y);
    }
    // Pillars in large rooms and variety in the walls
    for (const r of rooms) if (r.w >= 7 && r.h >= 7 && !r.arena && r !== start) for (let y = r.y + 2; y < r.y + r.h - 2; y += 3) for (let x = r.x + 2; x < r.x + r.w - 2; x += 3) if (Math.random() < .55) set(x, y, 2);
    if (boss) { const r = exitRoom; for (const [dx, dy] of [[3, 3], [8, 3], [3, 8], [8, 8]]) set(r.x + dx, r.y + dy, 2); }
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
      if (at(x, y) !== 1) continue;
      const nearFloor = at(x + 1, y) === 0 || at(x - 1, y) === 0 || at(x, y + 1) === 0 || at(x, y - 1) === 0;
      if (!nearFloor) continue;
      const r = Math.random();
      map[y * N + x] = r < .07 ? 5 : r < .16 ? 2 : r < .3 ? 6 : 1;
    }
    const sc = center(start), ec = center(exitRoom);
    return { idx, info, N, map, rooms, start, exitRoom, door, startPos: { x: sc.x + .5, y: sc.y + .5 }, exitCell: boss ? null : ec, boss };
  }

  function freeCell(room, avoid = []) {
    for (let i = 0; i < 40; i++) {
      const x = randi(room.x + 1, room.x + room.w - 2), y = randi(room.y + 1, room.y + room.h - 2);
      if (L.map[y * L.N + x] === 0 && !avoid.some(a => Math.hypot(a.x - x - .5, a.y - y - .5) < 1.2)) return { x: x + .5, y: y + .5 };
    }
    return null;
  }

  function populate() {
    const idx = L.idx, placed = [{ x: L.startPos.x, y: L.startPos.y }];
    const types = Object.keys(ENEMY).filter(k => ENEMY[k].unlock <= idx);
    const dens = .62 + idx * .055;
    const roomsByDist = L.rooms.filter(r => r !== L.start).sort((a, b) => Math.hypot(a.x - L.start.x, a.y - L.start.y) - Math.hypot(b.x - L.start.x, b.y - L.start.y));
    for (const r of roomsByDist) {
      if (r.arena) continue;
      const n = Math.max(1, Math.round(r.w * r.h / 13 * dens * rand(.7, 1.3)));
      for (let i = 0; i < n; i++) {
        const p = freeCell(r, placed); if (!p) continue;
        placed.push(p);
        const t = Math.random() < .3 && types.includes('spider') && idx > 1 ? 'spider' : pick(types);
        const e = spawnEnemy(t, p.x, p.y);
        if (t === 'spider') for (let k = 0; k < randi(0, 1); k++) spawnEnemy('spider', p.x + rand(-.4, .4), p.y + rand(-.4, .4));
        if (Math.random() < clamp((idx - 1) * .03, 0, .22)) makeElite(e);
      }
      // Floor loot
      if (Math.random() < .55) { const p = freeCell(r, placed); if (p) addItem(Math.random() < .5 ? 'ammo' : pick(['health', 'health', 'armor']), p.x, p.y); }
    }
    // The guardian carries the keycard
    if (!L.boss) {
      const far = roomsByDist.filter(r => r !== L.exitRoom);
      const room = far[Math.max(0, Math.floor(far.length * .6))] || L.start;
      const p = freeCell(room, placed) || { x: room.x + room.w / 2, y: room.y + room.h / 2 };
      const g = spawnEnemy(idx >= 3 ? 'brute' : 'soldier', p.x, p.y); makeElite(g); g.key = true;
    } else {
      const r = L.exitRoom, b = spawnEnemy(L.boss, r.x + r.w / 2, r.y + r.h / 2, true);
      b.idle = true;
    }
    // The sector's new weapon and a chest
    const unlock = WEAPON_UNLOCK[idx];
    if (unlock && !P.owned.includes(unlock)) { const r = roomsByDist[Math.floor(roomsByDist.length * .35)]; const p = freeCell(r, placed); if (p) addItem('weapon', p.x, p.y, unlock); }
    const cr = pick(roomsByDist.filter(r => !r.arena)); const cp = cr && freeCell(cr, placed); if (cp) addItem('chest', cp.x, cp.y, rollRarity(0));
    for (let i = 0; i < 2; i++) { const r = pick(roomsByDist); const p = r && freeCell(r, placed); if (p) addItem('ammo', p.x, p.y); }
  }

  /* =====================================================================
     ENTITIES
     ===================================================================== */
  const diff = () => DIFFS[settings.diff] || DIFFS.normal;
  const hpMul = () => (1 + L.idx * .16) * diff().hp;
  const dmgMul = () => (1 + L.idx * .085) * diff().dmg;
  const spdMul = () => (1 + L.idx * .025) * diff().speed;

  function spawnEnemy(type, x, y, isBoss = false) {
    const d = isBoss ? BOSS[type] : ENEMY[type];
    const e = { type, boss: isBoss, def: d, x, y, a: 0, hp: Math.round(d.hp * hpMul()), r: d.r, h: d.h, z: d.z || 0,
      state: 'idle', alert: false, cd: rand(.6, 1.6), anim: 'w', frameT: 0, walk: rand(0, 4), pain: 0, deadT: 0, dead: false,
      speed: (d.speed || 0) * spdMul() * rand(.9, 1.1), burst: 0, burstT: 0, windup: 0, charge: 0, fuse: 0, seen: false, elite: false, phase: 1, atkN: 0, summoned: 0 };
    if (isBoss) e.hp = Math.round(d.hp * (1 + L.idx * .07) * diff().hp);
    e.maxHp = e.hp;
    enemies.push(e);
    return e;
  }
  function makeElite(e) { e.elite = true; e.hp = e.maxHp = Math.round(e.maxHp * 3); e.r *= 1.15; e.h *= 1.18; }

  function addItem(kind, x, y, sub) {
    if (kind === 'ammo' && !sub) {
      const owned = P.owned.map(w => WEAPONS[w].ammo).filter(Boolean);
      sub = owned.length ? pick(owned) : 'shells';
    }
    items.push({ kind, sub, x, y, t: rand(0, 6), vx: 0, vy: 0 });
  }
  function rollRarity(min = 0) {
    const pool = RARITY.slice(min); let r = Math.random() * pool.reduce((s, x) => s + x.w, 0);
    for (const x of pool) if ((r -= x.w) <= 0) return x.id;
    return pool[0].id;
  }

  /* =====================================================================
     PLAYER
     ===================================================================== */
  function newPlayer() {
    return { x: 0, y: 0, a: 0, pitch: 0, hp: 100, maxHp: 100, armor: 0, maxArmor: 100, vx: 0, vy: 0, bob: 0, dashT: 0, dashCd: 0, invuln: 0,
      owned: ['blaster'], weapon: 'blaster', pools: { shells: 12, bullets: 0, cells: 0, rockets: 0 }, mag: { shotgun: 6, minigun: 90, rail: 5, launcher: 4 },
      mods: {}, modList: [], key: false, kills: 0, shots: 0, hits: 0, stepT: 0 };
  }
  const mod = id => P.mods[id] || 0;
  const magCap = w => Math.round(WEAPONS[w].mag * (1 + mod('mag')));
  const W8 = {}; // state of the weapon in hand
  function resetWeaponState() {
    Object.assign(W8, { state: 'idle', t: 0, cd: 0, recoil: 0, flash: 0, heat: 0, over: false, spin: 0, spinA: 0, charge: 0, pump: 0, reload: 0, reloadDur: 0, lower: 0, switchTo: null, beam: 0, beamTick: 0, cellAcc: 0, spreadHeat: 0 });
  }
  resetWeaponState();
  function snapshot() { return JSON.parse(JSON.stringify({ hp: P.hp, maxHp: P.maxHp, armor: P.armor, maxArmor: P.maxArmor, owned: P.owned, weapon: P.weapon, pools: P.pools, mag: P.mag, mods: P.mods, modList: P.modList })); }

  /* =====================================================================
     WORLD: collisions, line of sight and rays
     ===================================================================== */
  const cellAt = (x, y) => (x < 0 || y < 0 || x >= L.N || y >= L.N) ? 1 : L.map[(y | 0) * L.N + (x | 0)];
  const solid = (x, y) => cellAt(x, y) !== 0;
  function moveBody(o, dx, dy, r) {
    if (!solid(o.x + dx + Math.sign(dx) * r, o.y) && !solid(o.x + dx + Math.sign(dx) * r, o.y + r * .7) && !solid(o.x + dx + Math.sign(dx) * r, o.y - r * .7)) o.x += dx;
    if (!solid(o.x, o.y + dy + Math.sign(dy) * r) && !solid(o.x + r * .7, o.y + dy + Math.sign(dy) * r) && !solid(o.x - r * .7, o.y + dy + Math.sign(dy) * r)) o.y += dy;
  }
  function cast(ox, oy, a, max = 40) {
    const dx = Math.cos(a), dy = Math.sin(a);
    let mx = ox | 0, my = oy | 0;
    const ddx = Math.abs(1 / dx), ddy = Math.abs(1 / dy);
    let sx, sy, sdx, sdy;
    if (dx < 0) { sx = -1; sdx = (ox - mx) * ddx; } else { sx = 1; sdx = (mx + 1 - ox) * ddx; }
    if (dy < 0) { sy = -1; sdy = (oy - my) * ddy; } else { sy = 1; sdy = (my + 1 - oy) * ddy; }
    let side = 0, cell = 0, d = 0;
    for (let i = 0; i < 128; i++) {
      if (sdx < sdy) { sdx += ddx; mx += sx; side = 0; } else { sdy += ddy; my += sy; side = 1; }
      cell = cellAt(mx, my);
      if (cell) break;
    }
    d = side === 0 ? sdx - ddx : sdy - ddy;
    return { d: Math.min(max, d), side, cell, mx, my };
  }
  function los(ax, ay, bx, by) {
    const d = Math.hypot(bx - ax, by - ay), a = Math.atan2(by - ay, bx - ax);
    return cast(ax, ay, a, d + 1).d >= d - .05;
  }

  /* =====================================================================
     RENDER 3D
     ===================================================================== */
  function fogK(d) { const f = Math.min(1, d / T.theme.fogDist); return f * f * (3 - 2 * f); }

  function render3D() {
    const px = P.x, py = P.y, dirX = Math.cos(P.a), dirY = Math.sin(P.a);
    const planeX = -dirY * FOVK, planeY = dirX * FOVK;
    const horizon = (RH / 2 + P.pitch * RH) | 0;
    const [fr, fg, fb] = T.fog, light = 1 + lightBoost;
    const fogPix = 0xff000000 | (fb << 16) | (fg << 8) | fr;
    const fogDist = T.theme.fogDist;
    const N = L.N, map = L.map;
    const exitX = L.exitCell ? L.exitCell.x : -1, exitY = L.exitCell ? L.exitCell.y : -1;
    const rdx0 = dirX - planeX, rdy0 = dirY - planeY, rdx1 = dirX + planeX, rdy1 = dirY + planeY;
    const posZ = RH * .5;
    // Floor and ceiling
    for (let y = 0; y < RH; y++) {
      const p = y - horizon; let idx = y * RW;
      if (p > -1 && p < 1) { buf.fill(fogPix, idx, idx + RW); continue; }
      const isFloor = p > 0, rowDist = posZ / Math.abs(p);
      if (rowDist > fogDist) { buf.fill(fogPix, idx, idx + RW); continue; }
      const f = fogK(rowDist), k = (1 - f) * light * (isFloor ? 1 : .85);
      const stepX = rowDist * (rdx1 - rdx0) / RW, stepY = rowDist * (rdy1 - rdy0) / RW;
      let fx = px + rowDist * rdx0, fy = py + rowDist * rdy0;
      const tex = isFloor ? T.floor : T.ceil, tp = tex.px, te = tex.em, xp = T.exit.px, xe = T.exit.em;
      for (let x = 0; x < RW; x++, idx++) {
        const cx = fx | 0, cy = fy | 0;
        const ti = ((((fy - cy) * TS) & TM) << TSH) | (((fx - cx) * TS) & TM);
        fx += stepX; fy += stepY;
        let c, e;
        if (isFloor && cx === exitX && cy === exitY) { c = xp[ti]; e = xe[ti]; } else { c = tp[ti]; e = te[ti]; }
        let kk = k, fa = f;
        if (e) { const ee = e * .0039; kk = k + (1 - k) * ee * 1.1; fa = f * (1 - ee); }
        let r = (c & 255) * kk + fr * fa, g = (c >> 8 & 255) * kk + fg * fa, b = (c >> 16 & 255) * kk + fb * fa;
        buf[idx] = 0xff000000 | ((b > 255 ? 255 : b) << 16) | ((g > 255 ? 255 : g) << 8) | (r > 255 ? 255 : r);
      }
    }
    // Walls
    for (let x = 0; x < RW; x++) {
      const camX = 2 * x / RW - 1, rx = dirX + planeX * camX, ry = dirY + planeY * camX;
      let mx = px | 0, my = py | 0;
      const ddx = Math.abs(1 / rx), ddy = Math.abs(1 / ry);
      let sx, sy, sdx, sdy;
      if (rx < 0) { sx = -1; sdx = (px - mx) * ddx; } else { sx = 1; sdx = (mx + 1 - px) * ddx; }
      if (ry < 0) { sy = -1; sdy = (py - my) * ddy; } else { sy = 1; sdy = (my + 1 - py) * ddy; }
      let side = 0, cell = 0;
      for (let i = 0; i < 64; i++) {
        if (sdx < sdy) { sdx += ddx; mx += sx; side = 0; } else { sdy += ddy; my += sy; side = 1; }
        cell = (mx < 0 || my < 0 || mx >= N || my >= N) ? 1 : map[my * N + mx];
        if (cell) break;
      }
      const dist = Math.max(.05, side === 0 ? sdx - ddx : sdy - ddy);
      zbuf[x] = dist;
      if (dist > fogDist) continue;
      const lineH = RH / dist, top = horizon - lineH / 2;
      let wallX = side === 0 ? py + dist * ry : px + dist * rx; wallX -= Math.floor(wallX);
      let tx = (wallX * TS) | 0; if ((side === 0 && rx > 0) || (side === 1 && ry < 0)) tx = TS - 1 - tx;
      const tex = T.walls[cell] || T.walls[1], tp = tex.px, te = tex.em;
      const f = fogK(dist), k = (1 - f) * light * (side ? .76 : 1);
      const y0 = Math.max(0, top | 0), y1 = Math.min(RH, (top + lineH) | 0), step = TS / lineH;
      let ty = (y0 - top) * step, idx = y0 * RW + x;
      for (let y = y0; y < y1; y++, idx += RW, ty += step) {
        const ti = ((ty & TM) << TSH) | tx, c = tp[ti], e = te[ti];
        let kk = k, fa = f;
        if (e) { const ee = e * .0039; kk = k + (1 - k) * ee * 1.15; fa = f * (1 - ee); }
        let r = (c & 255) * kk + fr * fa, g = (c >> 8 & 255) * kk + fg * fa, b = (c >> 16 & 255) * kk + fb * fa;
        buf[idx] = 0xff000000 | ((b > 255 ? 255 : b) << 16) | ((g > 255 ? 255 : g) << 8) | (r > 255 ? 255 : r);
      }
    }
    // Sprites sorted from far to near
    const invDet = 1 / (planeX * dirY - dirX * planeY);
    const list = [];
    const push = (x, y, tex, h, zc, opt) => {
      const sx = x - px, sy = y - py, tX = invDet * (dirY * sx - dirX * sy), tY = invDet * (-planeY * sx + planeX * sy);
      if (tY < .12 || tY > fogDist + 1) return;
      list.push({ tX, tY, tex, h, zc, opt });
    };
    for (const e of enemies) {
      const fr2 = enemyFrame(e), def = e.def;
      const hh = e.h, zc = -.5 + hh / 2 + (e.z || 0) + (e.boss ? 0 : 0);
      if (e.elite && !e.dead) push(e.x, e.y, glowTex('#ffd166'), hh * 1.4, zc, { add: true, a: .35 });
      push(e.x, e.y, fr2, hh * (e.boss ? 1.15 : 1.12), zc, { tint: e.dead ? 0 : Math.min(.35, e.pain * .6) });
    }
    for (const it of items) {
      const bob = Math.sin(it.t * 3) * .05, tex = itemTex(it);
      const col = itemGlow(it);
      if (col) push(it.x, it.y, glowTex(col), .9, -.3 + bob, { add: true, a: .5 });
      push(it.x, it.y, tex, it.kind === 'chest' ? .55 : it.kind === 'weapon' ? .4 : .42, -.32 + bob, {});
    }
    for (const p of projectiles) push(p.x, p.y, glowTex(p.color), p.size, p.z, { add: true, a: 1 });
    for (const r of rings) for (let i = 0; i < 28; i++) { const a = i / 28 * TAU; push(r.x + Math.cos(a) * r.r, r.y + Math.sin(a) * r.r, glowTex(r.color), .5, -.42, { add: true, a: .9 }); }
    for (const p of particles) push(p.x, p.y, p.tex, p.size, p.z, { add: p.add, a: Math.min(1, p.life / p.max * 1.5) });
    list.sort((a, b) => b.tY - a.tY);
    const w2 = RW / 2;
    for (const s of list) {
      const tex = s.tex; if (!tex) continue;
      const tY = s.tY, screenX = w2 * (1 + s.tX / tY);
      const hp = Math.abs(RH * s.h / tY), wp = hp * tex.w / tex.h;
      const cy = horizon - s.zc * RH / tY;
      const x0 = Math.max(0, (screenX - wp / 2) | 0), x1 = Math.min(RW, (screenX + wp / 2) | 0);
      const y0 = Math.max(0, (cy - hp / 2) | 0), y1 = Math.min(RH, (cy + hp / 2) | 0);
      if (x0 >= x1 || y0 >= y1) continue;
      const f = fogK(tY), k = (1 - f) * light, o = s.opt, add = o.add, am = o.a ?? 1, tint = o.tint || 0;
      const sxStep = tex.w / wp, syStep = tex.h / hp, left = screenX - wp / 2, topY = cy - hp / 2, tp = tex.px, tw = tex.w;
      for (let x = x0; x < x1; x++) {
        if (zbuf[x] < tY) continue;
        const txx = Math.min(tw - 1, ((x - left) * sxStep) | 0), th1 = tex.h - 1;
        let tyy = (y0 - topY) * syStep, idx = y0 * RW + x;
        for (let y = y0; y < y1; y++, idx += RW, tyy += syStep) {
          const c = tp[Math.min(th1, tyy | 0) * tw + txx], a = c >>> 24;
          if (add) {
            if (a < 8) continue;
            const m = a / 255 * am * (1 - f * .6), d = buf[idx];
            const r = (d & 255) + (c & 255) * m, g = (d >> 8 & 255) + (c >> 8 & 255) * m, b = (d >> 16 & 255) + (c >> 16 & 255) * m;
            buf[idx] = 0xff000000 | ((b > 255 ? 255 : b) << 16) | ((g > 255 ? 255 : g) << 8) | (r > 255 ? 255 : r);
          } else {
            if (a < 128) continue;
            let r = (c & 255) * k + fr * f, g = (c >> 8 & 255) * k + fg * f, b = (c >> 16 & 255) * k + fb * f;
            if (tint) { r += (255 - r) * tint; g += (255 - g) * tint * .7; b += (255 - b) * tint * .7; }
            buf[idx] = 0xff000000 | ((b > 255 ? 255 : b) << 16) | ((g > 255 ? 255 : g) << 8) | (r > 255 ? 255 : r);
          }
        }
      }
    }
    vctx.putImageData(img, 0, 0);
  }

  function enemyFrame(e) { const S = SPR[e.type]; return enemyFrameOf(e, S) || S.w0; } // if a state has no frame, fall back to the idle one
  function enemyFrameOf(e, S) {
    if (e.dead) return S['d' + Math.min(3, Math.floor(e.deadT / .14))];
    if (e.pain > .3 && !e.boss) return S.p;
    if (e.anim === 'a') return e.windup > 0 ? S.a0 : S.a1;
    return S['w' + (Math.floor(e.walk) & 3)];
  }
  function itemTex(it) {
    if (it.kind === 'ammo') return ITEM_SPR[it.sub];
    if (it.kind === 'weapon') return WEAPON_ICON[it.sub];
    return ITEM_SPR[it.kind] || ITEM_SPR.module;
  }
  function itemGlow(it) {
    if (it.kind === 'module' || it.kind === 'chest') return RARITY.find(r => r.id === it.sub)?.color;
    if (it.kind === 'key') return '#ffd166';
    if (it.kind === 'weapon') return WEAPONS[it.sub].color;
    return null;
  }

  /* =====================================================================
     LEVELS
     ===================================================================== */
  function loadLevel(idx) {
    L = genLevel(idx);
    T = buildTextures(L.info.theme);
    enemies = []; projectiles = []; items = []; particles = []; rings = []; beams = []; toasts = []; dmgDirs = [];
    P.x = L.startPos.x; P.y = L.startPos.y; P.key = false; P.kills = 0; P.shots = 0; P.hits = 0;
    // Face the most open corridor
    let bestA = 0, bestD = 0; for (let i = 0; i < 16; i++) { const a = i / 16 * TAU, d = cast(P.x, P.y, a).d; if (d > bestD) { bestD = d; bestA = a; } } P.a = bestA; P.pitch = 0;
    populate();
    L.totalEnemies = enemies.length; L.time = 0; L.explored = new Uint8Array(L.N * L.N); L.lootGot = [];
    L.flow = new Int16Array(L.N * L.N); L.flowT = 0;
    run.snap = snapshot();
    resetWeaponState();
    newCracks();
    banner = null;
  }

  /* =====================================================================
     LOOP
     ===================================================================== */
  let last = performance.now(), frameAvg = 16, slowFor = 0;
  function frame(now) {
    const dt = Math.min(.05, (now - last) / 1000 || 0);
    last = now;
    pollPad();
    if (mode === 'play') {
      update(dt);
      frameAvg += ((dt * 1000) - frameAvg) * .05;
      // If the machine can't keep up ~40 fps, quality is lowered automatically.
      if (frameAvg > 26 && settings.quality !== 'low') { slowFor += dt; if (slowFor > 3) { settings.quality = { ultra: 'high', high: 'medium' }[settings.quality] || 'low'; setRes(settings.quality); slowFor = 0; frameAvg = 16; toast('QUALITY ADJUSTED', `Switched to ${QNAMES[settings.quality].toLowerCase()} quality for smoother play`, '#9aa3a8'); } } else slowFor = 0;
    }
    draw(now / 1000, dt);
    requestAnimationFrame(frame);
  }

  function update(dt) {
    time += dt; L.time += dt;
    flash = Math.max(0, flash - dt * 3); hurtFlash = Math.max(0, hurtFlash - dt * 2); shake = Math.max(0, shake - dt * 10);
    hitMark = Math.max(0, hitMark - dt); critMark = Math.max(0, critMark - dt); lightBoost = Math.max(0, lightBoost - dt * 6);
    updatePlayer(dt);
    updateWeapon(dt);
    L.flowT -= dt; if (L.flowT <= 0) { computeFlow(); L.flowT = .3; }
    for (const e of enemies) updateEnemy(e, dt);
    enemies = enemies.filter(e => !(e.dead && e.type === 'kamikaze'));
    updateProjectiles(dt);
    updateRings(dt);
    updateItems(dt);
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vz -= p.g * dt; if (p.z < -.5) { p.z = -.5; p.vz *= -.3; p.vx *= .6; p.vy *= .6; } p.life -= dt; }
    particles = particles.filter(p => p.life > 0);
    if (particles.length > 700) particles.splice(0, particles.length - 700);
    for (const t of toasts) t.t -= dt; toasts = toasts.filter(t => t.t > 0);
    for (const d of dmgDirs) d.t -= dt; dmgDirs = dmgDirs.filter(d => d.t > 0);
    if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
    // Explored cells (minimap)
    const r = 4; for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) { const cx = (P.x | 0) + x, cy = (P.y | 0) + y; if (cx >= 0 && cy >= 0 && cx < L.N && cy < L.N) L.explored[cy * L.N + cx] = 1; }
    // Keycard door
    if (L.door && L.map[L.door.y * L.N + L.door.x] === 3 && Math.hypot(P.x - L.door.x - .5, P.y - L.door.y - .5) < 1.7) {
      if (P.key) {
        L.map[L.door.y * L.N + L.door.x] = 0; sfx('door');
        burst(L.door.x + .5, L.door.y + .5, 0, 26, '#ffd166', 3, .8, true);
        toast('ACCESS GRANTED', 'The exit room is open', '#ffd166');
      } else if (!L.doorHint || time - L.doorHint > 4) { L.doorHint = time; toast('DOOR LOCKED', 'You need the keycard: a golden guardian has it', '#ff4f4f'); sfx('deny'); }
    }
    // Exit
    if (L.exitCell && (P.x | 0) === L.exitCell.x && (P.y | 0) === L.exitCell.y) levelComplete();
  }

  function updatePlayer(dt) {
    const p = P;
    // Look with keyboard / controller
    if (keys.ArrowLeft) p.a -= dt * 2.4; if (keys.ArrowRight) p.a += dt * 2.4;
    p.a += pad.lx * dt * 3.2 * settings.sens; p.pitch = clamp(p.pitch + pad.ly * dt * .9 * settings.sens, -.28, .28);
    if (keys.ArrowUp) p.pitch = clamp(p.pitch + dt * .6, -.28, .28); if (keys.ArrowDown) p.pitch = clamp(p.pitch - dt * .6, -.28, .28);
    let f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) - pad.my, s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + pad.mx;
    const m = Math.hypot(f, s); if (m > 1) { f /= m; s /= m; }
    const sprint = keys.ShiftLeft || keys.ShiftRight || padHeld(10) ? 1.45 : 1;
    const speed = 3.3 * sprint * (1 + mod('speed'));
    const tx = (Math.cos(p.a) * f + Math.cos(p.a + Math.PI / 2) * s) * speed, ty = (Math.sin(p.a) * f + Math.sin(p.a + Math.PI / 2) * s) * speed;
    p.dashT -= dt; p.dashCd -= dt; p.invuln -= dt;
    // Easy mode: health regenerates up to 60% after 4 s without taking damage.
    if (diff().regen && time - (run.lastHurt || -99) > 4 && p.hp < p.maxHp * .6) p.hp = Math.min(p.maxHp * .6, p.hp + dt * 6);
    if (p.dashT > 0) { /* keep the dash velocity */ } else { const k = Math.min(1, dt * 12); p.vx += (tx - p.vx) * k; p.vy += (ty - p.vy) * k; }
    moveBody(p, p.vx * dt, p.vy * dt, .24);
    const moving = Math.hypot(p.vx, p.vy);
    p.bob += moving * dt * 2.2;
    p.stepT -= moving * dt; if (p.stepT <= 0 && moving > .5) { p.stepT = 1.15; sfx('step'); }
  }
  function dash() {
    const p = P; if (mode !== 'play' || p.dashCd > 0) return;
    let f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) - pad.my, s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + pad.mx;
    if (!f && !s) f = 1;
    const a = p.a + Math.atan2(s, f);
    p.vx = Math.cos(a) * 11; p.vy = Math.sin(a) * 11; p.dashT = .16; p.dashCd = 1.1; p.invuln = Math.max(p.invuln, .25);
    sfx('dash'); lightBoost = Math.max(lightBoost, .1);
  }

  /* ---------------- Weapons ---------------- */
  const reloadMul = () => 1 / (1 + mod('reload'));
  const rateMul = () => 1 / (1 + mod('rate'));
  function triggerHeld() { return mouseDown || keys.Space || pad.fire; }
  function selectWeapon(id) {
    if (!P.owned.includes(id) || (P.weapon === id && !W8.switchTo) || W8.state === 'switch') return;
    W8.state = 'switch'; W8.t = 0; W8.switchTo = id; W8.charge = 0; W8.beam = 0; stopLoops(); sfx('switch');
  }
  function cycleWeapon(dir) {
    const own = ORDER.filter(w => P.owned.includes(w)); if (own.length < 2) return;
    const i = own.indexOf(W8.switchTo || P.weapon); selectWeapon(own[(i + dir + own.length) % own.length]);
  }
  function startReload() {
    const w = P.weapon, d = WEAPONS[w];
    if (!d.ammo || d.slot === 6 || W8.state !== 'idle' || P.mag[w] >= magCap(w) || P.pools[d.ammo] <= 0) return;
    W8.state = 'reload'; W8.t = 0;
    W8.reloadDur = (w === 'shotgun' ? d.shell : d.reload) * reloadMul();
    sfx(w === 'shotgun' ? 'shellIn' : 'reloadOut');
  }

  function updateWeapon(dt) {
    const w = P.weapon, d = WEAPONS[w], trig = triggerHeld();
    W8.cd -= dt; W8.recoil = Math.max(0, W8.recoil - dt * 6); W8.flash = Math.max(0, W8.flash - dt * 12); W8.pump = Math.max(0, W8.pump - dt * 2.4);
    W8.heat = Math.max(0, W8.heat - dt * (W8.over ? .45 : .6)); if (W8.over && W8.heat < .3) W8.over = false;
    W8.spreadHeat = Math.max(0, W8.spreadHeat - dt * 1.5);
    if (W8.state === 'switch') {
      W8.t += dt;
      W8.lower = W8.t < .18 ? W8.t / .18 : Math.max(0, 1 - (W8.t - .18) / .2);
      if (W8.t >= .18 && W8.switchTo) { P.weapon = W8.switchTo; W8.switchTo = null; W8.spin = 0; }
      if (W8.t >= .38) { W8.state = 'idle'; W8.lower = 0; }
      return;
    }
    if (W8.state === 'reload') {
      W8.t += dt;
      if (w === 'shotgun') {
        if (W8.t >= W8.reloadDur) {
          W8.t = 0; P.mag.shotgun++; P.pools.shells--; sfx('shellIn');
          if (P.mag.shotgun >= magCap(w) || P.pools.shells <= 0 || (trig && P.mag.shotgun > 0)) { W8.state = 'idle'; W8.pump = 1; sfx('pump'); }
        }
      } else if (W8.t >= W8.reloadDur) {
        const need = magCap(w) - P.mag[w], n = Math.min(need, P.pools[d.ammo]);
        P.mag[w] += n; P.pools[d.ammo] -= n; W8.state = 'idle'; sfx('reloadIn');
      }
      return;
    }
    // Minigun: the barrels spin up before it fires
    if (w === 'minigun') { W8.spin = clamp(W8.spin + (trig ? dt / (d.spinup * rateMul()) : -dt * 1.2), 0, 1); W8.spinA += W8.spin * dt * 40; spinLoop(W8.spin); }
    else spinLoop(0);
    if (w === 'rail') {
      if (trig && P.mag.rail > 0 && W8.cd <= 0) { W8.charge = Math.min(1, W8.charge + dt / d.charge); chargeLoop(W8.charge); if (W8.charge >= 1) fireRail(); }
      else { W8.charge = Math.max(0, W8.charge - dt * 2); chargeLoop(0); }
    } else chargeLoop(0);
    if (w === 'tesla') {
      if (trig && P.pools.cells > 0) { W8.beam = 1; W8.beamTick -= dt; W8.cellAcc += dt; if (W8.cellAcc >= d.perCell) { W8.cellAcc = 0; P.pools.cells--; } if (W8.beamTick <= 0) { W8.beamTick = .09; teslaTick(); } teslaLoop(true); }
      else { W8.beam = 0; teslaLoop(false); if (trig && W8.cd <= 0) { W8.cd = .4; sfx('empty'); } }
      return;
    } else teslaLoop(false);
    if (!trig || W8.cd > 0) return;
    if (w === 'blaster') {
      if (W8.over) { if (W8.cd <= 0) { W8.cd = .25; sfx('empty'); } return; }
      W8.cd = d.rate * rateMul(); W8.heat += .1; if (W8.heat >= 1) { W8.over = true; W8.heat = 1; sfx('overheat'); toast('OVERHEATED!', 'Let the blaster cool or switch weapons', '#ff4f4f'); }
      newShot(); fireProjectile('plasma', d.dmg); kick(.5, .25); sfx('blaster');
    } else if (w === 'minigun') {
      if (W8.spin < 1) return;
      if (P.mag.minigun <= 0) { autoReload(); return; }
      W8.cd = d.rate * rateMul(); P.mag.minigun--;
      W8.spreadHeat = Math.min(1, W8.spreadHeat + .05);
      newShot(); hitscan(P.a + rand(-1, 1) * (.02 + W8.spreadHeat * .05), d.dmg, false, .1); kick(.25, .18); sfx('minigun');
    } else if (w === 'shotgun') {
      if (P.mag.shotgun <= 0) { autoReload(); return; }
      W8.cd = d.rate * rateMul(); P.mag.shotgun--; W8.pump = 0;
      newShot(); for (let i = 0; i < d.pellets; i++) hitscan(P.a + rand(-d.spread, d.spread), d.dmg, false, .35, i > 0);
      kick(1, .45); sfx('shotgun'); setTimeout(() => { W8.pump = 1; sfx('pump'); }, 280);
      shake = Math.max(shake, .6);
    } else if (w === 'launcher') {
      if (P.mag.launcher <= 0) { autoReload(); return; }
      W8.cd = d.rate * rateMul(); P.mag.launcher--;
      newShot(); fireProjectile('rocket', d.dmg, { splash: d.splash * (1 + mod('splash')) }); kick(.9, .35); sfx('rocket');
    }
    if (W8.state === 'idle' && d.ammo && P.mag[w] === 0) autoReload();
  }
  function autoReload() { if (W8.cd <= 0) { sfx('empty'); W8.cd = .3; } startReload(); }
  // Each shot gets a number, so accuracy counts one hit per shot even though the shotgun fires 9 pellets.
  let shotSeq = 0, lastHitShot = -1;
  function newShot() { P.shots++; shotSeq++; }
  function kick(r, l) { W8.recoil = Math.min(1.2, W8.recoil + r); W8.flash = 1; lightBoost = Math.max(lightBoost, l); noise(9); }

  function critRoll(dmg) { const crit = Math.random() < mod('crit'); return { dmg: dmg * (1 + mod('dmg')) * (crit ? 2.5 : 1), crit }; }
  function hitscan(a, base, pierce, knock, silentHit) {
    const wall = cast(P.x, P.y, a);
    const dx = Math.cos(a), dy = Math.sin(a), hits = [];
    for (const e of enemies) {
      if (e.dead) continue;
      const rx = e.x - P.x, ry = e.y - P.y, along = rx * dx + ry * dy;
      if (along <= 0 || along > wall.d) continue;
      const perp = Math.abs(rx * dy - ry * dx);
      if (perp < e.r * 1.1) hits.push({ e, along });
    }
    hits.sort((p, q) => p.along - q.along);
    const targets = pierce ? hits : hits.slice(0, 1);
    for (const h of targets) {
      const { dmg, crit } = critRoll(base);
      damageEnemy(h.e, dmg, crit, a, knock, shotSeq);
      burst(P.x + dx * h.along, P.y + dy * h.along, h.e.z - .1, 4, '#ffd9a0', 2, .3, true);
    }
    if (!targets.length) {
      const hx = P.x + dx * (wall.d - .02), hy = P.y + dy * (wall.d - .02);
      if (!silentHit || Math.random() < .3) burst(hx, hy, rand(-.2, .2), 3, '#ffd9a0', 1.5, .25, true);
    }
    return { wall, hits: targets };
  }
  function fireRail() {
    const d = WEAPONS.rail; W8.charge = 0; W8.cd = d.rate * rateMul(); P.mag.rail--;
    newShot(); const res = hitscan(P.a, d.dmg, true, .6);
    const len = res.wall.d;
    for (let s = .5; s < len; s += .35) particles.push({ x: P.x + Math.cos(P.a) * s, y: P.y + Math.sin(P.a) * s, z: -.08, vx: 0, vy: 0, vz: rand(-.05, .05), g: 0, life: .5, max: .5, tex: glowTex('#7ad8ff'), size: .22, add: true });
    kick(1.2, .6); sfx('rail'); shake = Math.max(shake, .8);
    if (P.mag.rail === 0) autoReload();
  }
  function teslaTick() {
    newShot();
    const d = WEAPONS.tesla; let from = { x: P.x, y: P.y }, hit = new Set(); const pts = [];
    for (let i = 0; i < d.chains; i++) {
      let best = null, bd = (i === 0 ? d.range : 4) ** 2;
      for (const e of enemies) {
        if (e.dead || hit.has(e)) continue;
        const dd = (e.x - from.x) ** 2 + (e.y - from.y) ** 2;
        if (dd > bd) continue;
        if (i === 0 && Math.abs(angDiff(P.a, Math.atan2(e.y - P.y, e.x - P.x))) > .45) continue;
        if (!los(from.x, from.y, e.x, e.y)) continue;
        bd = dd; best = e;
      }
      if (!best) break;
      hit.add(best); pts.push(best);
      const { dmg, crit } = critRoll(d.dmg * (i ? .7 : 1));
      damageEnemy(best, dmg, crit, Math.atan2(best.y - from.y, best.x - from.x), .05, shotSeq);
      for (let s = 0; s < 1; s += .2) particles.push({ x: from.x + (best.x - from.x) * s + rand(-.1, .1), y: from.y + (best.y - from.y) * s + rand(-.1, .1), z: rand(-.15, .05), vx: 0, vy: 0, vz: 0, g: 0, life: .12, max: .12, tex: glowTex('#d0b0ff'), size: .2, add: true });
      from = best;
    }
    W8.teslaPts = pts; W8.flash = .6; lightBoost = Math.max(lightBoost, .15); if (pts.length) noise(6);
  }
  function fireProjectile(kind, dmg, extra = {}) {
    const d = PROJ[kind], a = P.a;
    projectiles.push({ kind, owner: 'p', x: P.x + Math.cos(a) * .35, y: P.y + Math.sin(a) * .35, z: -.08, vx: Math.cos(a) * d.speed, vy: Math.sin(a) * d.speed, r: d.r, size: d.size, color: d.color, dmg, life: 3, sid: shotSeq, ...extra });
  }

  /* ---------------- Enemies ---------------- */
  function computeFlow() {
    const N = L.N, flow = L.flow; flow.fill(-1);
    const sx = P.x | 0, sy = P.y | 0, q = new Int32Array(N * N); let h = 0, t = 0;
    flow[sy * N + sx] = 0; q[t++] = sy * N + sx;
    while (h < t) {
      const c = q[h++], x = c % N, y = (c / N) | 0, d = flow[c];
      if (d > 60) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, ni = ny * N + nx;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N || flow[ni] >= 0 || L.map[ni] !== 0) continue;
        flow[ni] = d + 1; q[t++] = ni;
      }
    }
  }
  function flowDir(e) {
    const N = L.N, x = e.x | 0, y = e.y | 0; let best = null, bd = L.flow[y * N + x];
    if (bd < 0) bd = 9999;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const v = L.flow[(y + dy) * N + x + dx];
      if (v >= 0 && v < bd) { bd = v; best = [x + dx + .5, y + dy + .5]; }
    }
    return best ? Math.atan2(best[1] - e.y, best[0] - e.x) : Math.atan2(P.y - e.y, P.x - e.x);
  }
  function noise(r) { for (const e of enemies) if (!e.dead && !e.alert && Math.hypot(e.x - P.x, e.y - P.y) < r && L.flow[(e.y | 0) * L.N + (e.x | 0)] >= 0 && L.flow[(e.y | 0) * L.N + (e.x | 0)] < r * 1.5) alertEnemy(e); }
  function alertEnemy(e) {
    if (e.alert || e.dead) return;
    e.alert = true; e.state = 'chase'; e.idle = false;
    if (e.boss) { banner = { title: e.def.name.toUpperCase(), sub: 'Sector boss', t: 3, color: e.def.color }; sfx('bossRoar'); }
    else sfx('alert', e);
    for (const o of enemies) if (!o.alert && !o.dead && !o.boss && Math.hypot(o.x - e.x, o.y - e.y) < 3.5) { o.alert = true; o.state = 'chase'; }
  }

  function updateEnemy(e, dt) {
    e.pain = Math.max(0, e.pain - dt * 5);
    if (e.dead) { e.deadT += dt; return; }
    const dx = P.x - e.x, dy = P.y - e.y, dist = Math.hypot(dx, dy), toP = Math.atan2(dy, dx);
    e.seeT = (e.seeT || 0) - dt;
    if (e.seeT <= 0) { e.seeT = .2; e.seen = dist < 16 && los(e.x, e.y, P.x, P.y); }
    if (!e.alert) {
      if (e.seen && dist < (e.boss ? 9 : 13)) alertEnemy(e);
      e.walk += dt * .5;
      return;
    }
    if (e.boss) { updateBoss(e, dt, dist, toP); return; }
    const d = e.def;
    e.cd -= dt;
    // Attack wind-up (gives the player time to react)
    if (e.windup > 0) {
      e.windup -= dt; e.anim = 'a';
      if (e.windup <= 0) enemyAttack(e, dist, toP);
      return;
    }
    if (e.burst > 0) {
      e.burstT -= dt; e.anim = 'a';
      if (e.burstT <= 0) { e.burst--; e.burstT = .14; enemyShoot(e, toP + rand(-.06, .06)); }
      if (e.burst <= 0) e.anim = 'w';
      return;
    }
    if (e.charge > 0) {
      e.charge -= dt; e.anim = 'w'; e.walk += dt * 14;
      const before = { x: e.x, y: e.y };
      moveBody(e, Math.cos(e.chargeA) * 7.5 * dt, Math.sin(e.chargeA) * 7.5 * dt, e.r);
      if (Math.hypot(P.x - e.x, P.y - e.y) < e.r + .45 && !e.chargeHit) { e.chargeHit = true; hurtPlayer(d.dmg * 1.4 * dmgMul() * (e.elite ? 1.3 : 1), e.x, e.y); shake = 1; }
      if (Math.hypot(e.x - before.x, e.y - before.y) < .02) { e.charge = 0; e.stun = .9; sfx('clank'); shake = Math.max(shake, .4); }
      return;
    }
    if (e.stun > 0) { e.stun -= dt; e.anim = 'p'; return; }
    e.anim = 'w';
    // Movement
    let move = 0, moveA = toP;
    if (d.speed) {
      if (d.ranged && e.seen) {
        const [near, far] = d.keep;
        if (dist > far) move = 1; else if (dist < near) { move = 1; moveA = toP + Math.PI; }
        else { move = .55; moveA = toP + (e.strafe ||= (Math.random() < .5 ? 1 : -1)) * Math.PI / 2; if (Math.random() < dt * .4) e.strafe *= -1; }
      } else { move = dist > (d.melee ? e.r + .35 : 1) ? 1 : 0; if (!e.seen) moveA = flowDir(e); }
      if (!e.seen && d.ranged) moveA = flowDir(e), move = 1;
    }
    if (move) {
      const sp = e.speed * move * (e.elite ? 1.08 : 1);
      moveBody(e, Math.cos(moveA) * sp * dt, Math.sin(moveA) * sp * dt, e.r);
      e.walk += dt * sp * 2.6;
    }
    // Keep enemies apart
    for (const o of enemies) if (o !== e && !o.dead && !o.boss) { const ox = e.x - o.x, oy = e.y - o.y, od = Math.hypot(ox, oy); if (od > 0 && od < e.r + o.r) moveBody(e, ox / od * .02, oy / od * .02, e.r); }
    // Attacks
    if (d.kamikaze) {
      if (dist < 1.4 && !e.fuse) { e.fuse = .65; sfx('beep', e); }
      if (e.fuse) { e.fuse -= dt; e.anim = 'a'; e.windup = 0; if (e.fuse <= 0) killEnemy(e); } // killEnemy triggers the explosion
      return;
    }
    if (e.cd > 0 || !e.seen) return;
    if (d.melee && dist < e.r + .7) { e.windup = e.type === 'spider' ? .25 : .45; e.cd = rand(...d.cd); sfx('windup', e); }
    else if (d.charger && dist > 2.5 && dist < 7 && Math.random() < .5) { e.windup = .6; e.cd = rand(2.5, 3.5); e.chargePrep = true; sfx('roar', e); }
    else if (d.ranged && dist < d.range) { e.windup = e.type === 'soldier' ? .55 : .45; e.cd = rand(...d.cd) * (e.elite ? .7 : 1); sfx('windup', e); }
    else if (d.summoner && e.summoned < 6 && Math.random() < .3) { e.cd = 4; for (let i = 0; i < 2; i++) { spawnEnemy('spider', e.x + rand(-.5, .5), e.y + rand(-.5, .5)).alert = true; e.summoned++; } burst(e.x, e.y, 0, 20, '#c86bff', 2, .6, true); sfx('summon', e); }
  }
  function enemyAttack(e, dist, toP) {
    const d = e.def;
    if (e.chargePrep) { e.chargePrep = false; e.charge = 1.1; e.chargeA = toP; e.chargeHit = false; return; }
    if (d.melee) { if (dist < e.r + .9) hurtPlayer(d.dmg * dmgMul() * (e.elite ? 1.3 : 1), e.x, e.y); sfx('melee', e); e.anim = 'a'; return; }
    if (d.burst) { e.burst = d.burst; e.burstT = 0; return; }
    enemyShoot(e, toP);
    if (e.summoner) { /* the Conduit shoots as well */ }
  }
  function enemyShoot(e, a) {
    const d = e.def, pd = PROJ[d.proj];
    const n = e.type === 'turret' ? 1 : 1;
    for (let i = 0; i < n; i++) projectiles.push({ kind: d.proj, owner: 'e', x: e.x + Math.cos(a) * e.r, y: e.y + Math.sin(a) * e.r, z: (e.z || 0) - .5 + e.h * .62, vx: Math.cos(a) * pd.speed, vy: Math.sin(a) * pd.speed, r: pd.r, size: pd.size, color: pd.color, dmg: d.dmg * dmgMul() * (e.elite ? 1.3 : 1), life: 5, homing: pd.homing, splash: pd.splash });
    sfx(d.proj === 'bolt' ? 'eBolt' : 'eOrb', e);
  }

  /* ---------------- Bosses ---------------- */
  function bossShoot(e, kind, a, speedMul = 1, zOff = 0) {
    const pd = PROJ[kind];
    projectiles.push({ kind, owner: 'e', x: e.x + Math.cos(a) * e.r, y: e.y + Math.sin(a) * e.r, z: -.5 + e.h * .55 + zOff + (e.z || 0), vx: Math.cos(a) * pd.speed * speedMul, vy: Math.sin(a) * pd.speed * speedMul, r: pd.r, size: pd.size * 1.2, color: pd.color, dmg: 12 * dmgMul(), life: 6, homing: pd.homing, splash: pd.splash });
  }
  function updateBoss(e, dt, dist, toP) {
    const id = e.type, ph = e.hp < e.maxHp * .5 ? 2 : 1, tempo = ph === 2 ? .7 : 1;
    if (ph === 2 && e.phase === 1) { e.phase = 2; toast(`${e.def.name.toUpperCase()} · PHASE 2`, 'It is enraged', e.def.color); sfx('bossRoar'); burst(e.x, e.y, 0, 40, e.def.color, 4, 1, true); }
    e.cd -= dt;
    if (e.charge > 0) {
      e.charge -= dt; e.walk += dt * 12;
      moveBody(e, Math.cos(e.chargeA) * 8 * dt, Math.sin(e.chargeA) * 8 * dt, e.r);
      if (dist < e.r + .5 && !e.chargeHit) { e.chargeHit = true; hurtPlayer(28 * dmgMul(), e.x, e.y); shake = 1.2; }
      return;
    }
    if (e.windup > 0) { e.windup -= dt; e.anim = 'a'; if (e.windup <= 0) bossAttack(e, ph, toP, dist); return; }
    e.anim = 'w';
    // Moves towards the player while keeping some distance
    const want = id === 'mind' ? 5 : id === 'queen' ? 2 : 3.2;
    if (dist > want) { const a = e.seen ? toP : flowDir(e); moveBody(e, Math.cos(a) * e.speed * dt, Math.sin(a) * e.speed * dt, e.r); e.walk += dt * e.speed * 2; }
    if (id === 'mind') e.z = .45 + Math.sin(time * 2) * .12;
    if (e.cd <= 0 && e.seen) { e.windup = .7 * tempo; e.cd = 2.4 * tempo; sfx('windup', e); }
  }
  function bossAttack(e, ph, toP, dist) {
    const id = e.type, n = e.atkN++ % 3;
    if (id === 'colossus') {
      if (n === 0 || n === 2) { for (let i = -2; i <= 2; i++) bossShoot(e, 'rocketE', toP + i * .14, 1, .4); if (ph === 2) for (let i = -1; i <= 1; i++) bossShoot(e, 'rocketE', toP + i * .3 + .07, .8, .4); sfx('rocket'); }
      else { rings.push({ x: e.x, y: e.y, r: .5, speed: 4.2, max: 13, color: '#ff8a3d', dmg: 22 * dmgMul(), hit: false }); if (ph === 2) setTimeout(() => !e.dead && rings.push({ x: e.x, y: e.y, r: .5, speed: 4.2, max: 13, color: '#ff8a3d', dmg: 22 * dmgMul(), hit: false }), 700); sfx('stomp'); shake = Math.max(shake, .9); }
    } else if (id === 'queen') {
      if (n === 0) { for (let i = -3; i <= 3; i++) bossShoot(e, 'acid', toP + i * .13); sfx('eOrb', e); }
      else if (n === 1) { e.charge = .9; e.chargeA = toP; e.chargeHit = false; sfx('roar', e); }
      else { for (let i = 0; i < (ph === 2 ? 6 : 4); i++) spawnEnemy('spider', e.x + rand(-1, 1), e.y + rand(-1, 1)).alert = true; burst(e.x, e.y, 0, 30, '#d06aff', 3, .8, true); sfx('summon', e); }
    } else if (id === 'mind') {
      if (n === 0) { const k = ph === 2 ? 24 : 16; for (let i = 0; i < k; i++) setTimeout(() => !e.dead && bossShoot(e, 'shard', e.spin = (e.spin || 0) + .55), i * 60); sfx('eOrb', e); }
      else if (n === 1) { for (let i = -2; i <= 2; i++) bossShoot(e, 'shard', toP + i * .08, 1.4); }
      else { blinkBoss(e); if (ph === 2) for (let i = 0; i < 2; i++) spawnEnemy('drone', e.x + rand(-1, 1), e.y + rand(-1, 1)).alert = true; }
    } else if (id === 'forge') {
      const k = e.atkN % 4;
      if (k === 0) { for (let i = -3; i <= 3; i++) bossShoot(e, 'rocketE', toP + i * .12, 1, .3); sfx('rocket'); }
      else if (k === 1) { rings.push({ x: e.x, y: e.y, r: .5, speed: 4.6, max: 14, color: '#ff3a1a', dmg: 26 * dmgMul(), hit: false }); sfx('stomp'); shake = Math.max(shake, 1); }
      else if (k === 2) { const c = ph === 2 ? 30 : 20; for (let i = 0; i < c; i++) bossShoot(e, 'orb', i / c * TAU + time, .9); sfx('eOrb', e); }
      else { spawnEnemy(ph === 2 ? 'brute' : 'kamikaze', e.x + 1, e.y).alert = true; spawnEnemy('kamikaze', e.x - 1, e.y).alert = true; sfx('summon', e); }
    }
  }
  function blinkBoss(e) {
    for (let i = 0; i < 30; i++) {
      const r = L.exitRoom, x = rand(r.x + 1.5, r.x + r.w - 1.5), y = rand(r.y + 1.5, r.y + r.h - 1.5);
      if (!solid(x, y) && Math.hypot(x - P.x, y - P.y) > 4) { burst(e.x, e.y, 0, 20, '#7ad8ff', 3, .6, true); e.x = x; e.y = y; burst(x, y, 0, 20, '#7ad8ff', 3, .6, true); sfx('blink'); return; }
    }
  }

  /* ---------------- Damage ---------------- */
  function damageEnemy(e, dmg, crit, a, knock, sid = null) {
    if (e.dead) return;
    e.hp -= dmg; e.pain = e.boss ? .25 : .55;
    if (sid !== null && sid !== lastHitShot) { lastHitShot = sid; P.hits++; }
    if (!e.alert) alertEnemy(e);
    hitMark = .18; if (crit) critMark = .35;
    if (!e.boss && e.def.speed) moveBody(e, Math.cos(a) * knock, Math.sin(a) * knock, e.r);
    if (e.windup > 0 && !e.boss && Math.random() < .35) e.windup += .2; // brief stagger
    burst(e.x, e.y, e.z - .5 + e.h * .55, crit ? 8 : 4, crit ? '#ffd166' : '#ff9a5a', 2.2, .35, true);
    sfx(crit ? 'crit' : 'hit');
    if (e.hp <= 0) killEnemy(e);
  }
  function killEnemy(e) {
    e.dead = true; e.deadT = 0; e.windup = 0; e.burst = 0; e.charge = 0;
    P.kills++; run.kills++;
    run.score += Math.round((e.boss ? 5000 : e.def.score) * (1 + L.idx * .15) * (e.elite ? 3 : 1));
    if (mod('leech')) P.hp = Math.min(P.maxHp, P.hp + mod('leech'));
    burst(e.x, e.y, e.z - .3, e.boss ? 70 : 18, e.boss ? e.def.color : '#ff9a3d', e.boss ? 5 : 3, e.boss ? 1.4 : .8, true);
    burst(e.x, e.y, e.z - .3, e.boss ? 30 : 8, '#3a3a40', 2.5, 1.4, false);
    sfx(e.boss ? 'bossDie' : 'die', e);
    if (e.type === 'kamikaze') explode(e.x, e.y, 2.2, e.def.dmg * dmgMul(), true, e);
    // Loot
    if (e.key) { addItem('key', e.x, e.y); toast('KEYCARD DROPPED', 'Grab it to open the exit door', '#ffd166'); }
    if (e.boss) {
      addItem('chest', e.x, e.y, rollRarity(2));
      L.exitCell = { x: e.x | 0, y: e.y | 0 };
      if (L.map[L.exitCell.y * L.N + L.exitCell.x] !== 0) L.exitCell = { x: L.startPos.x | 0, y: L.startPos.y | 0 };
      // Move the exit to a nearby free cell so it doesn't cover the chest
      for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) { const x = (e.x | 0) + dx, y = (e.y | 0) + dy; if (!solid(x + .5, y + .5)) { L.exitCell = { x, y }; break; } }
      banner = { title: `${e.def.name.toUpperCase()} DEFEATED`, sub: 'Open the chest and take the exit portal', t: 4, color: e.def.color };
      sfx('fanfare');
    } else if (e.elite) addItem('module', e.x, e.y, rollRarity(1));
    else {
      const r = Math.random();
      if (r < .03 + L.idx * .002) addItem('module', e.x, e.y, rollRarity(0));
      else if (r < .3) addItem('ammo', e.x + rand(-.2, .2), e.y + rand(-.2, .2));
      else if (r < .4) addItem(P.hp < P.maxHp * .5 ? 'health' : 'armor', e.x, e.y);
    }
  }
  function explode(x, y, R, dmg, hurtsPlayer, src, sid = null) {
    rings.push({ x, y, r: .2, speed: 14, max: R, color: '#ff8a3d', dmg: 0, hit: true, fx: true });
    burst(x, y, -.2, 40, '#ffb35a', 4, .7, true); burst(x, y, -.2, 14, '#3a3a40', 3, 1.2, false);
    lightBoost = Math.max(lightBoost, .5); sfx('explosion', src || { x, y });
    const d = Math.hypot(P.x - x, P.y - y);
    if (d < R) shake = Math.max(shake, 1.2 * (1 - d / R));
    for (const e of enemies) {
      if (e.dead || e === src) continue;
      const de = Math.hypot(e.x - x, e.y - y); if (de < R + e.r) damageEnemy(e, dmg * (1 - de / (R + e.r)) * (e.boss ? .6 : 1), false, Math.atan2(e.y - y, e.x - x), .4, sid);
    }
    if (hurtsPlayer && d < R) hurtPlayer(dmg * (1 - d / R) * (src && src.owner === 'p' ? .3 : 1), x, y);
  }
  function hurtPlayer(dmg, sx, sy) {
    if (mode !== 'play' || P.invuln > 0) return;
    const absorbed = Math.min(P.armor, dmg * .6);
    P.armor -= absorbed; P.hp -= dmg - absorbed;
    hurtFlash = Math.min(1, hurtFlash + dmg / 40); shake = Math.max(shake, .5);
    dmgDirs.push({ a: Math.atan2(sy - P.y, sx - P.x), t: 1.2 });
    run.lastHurt = time;
    sfx(absorbed > dmg * .3 ? 'armorHit' : 'hurt');
    if (P.hp <= 0) die();
  }

  function updateProjectiles(dt) {
    for (const p of projectiles) {
      if (p.homing) { const want = Math.atan2(P.y - p.y, P.x - p.x), cur = Math.atan2(p.vy, p.vx), sp = Math.hypot(p.vx, p.vy), na = cur + clamp(angDiff(cur, want), -p.homing * dt, p.homing * dt); p.vx = Math.cos(na) * sp; p.vy = Math.sin(na) * sp; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      if (Math.random() < .5) particles.push({ x: p.x, y: p.y, z: p.z, vx: 0, vy: 0, vz: 0, g: 0, life: .2, max: .2, tex: glowTex(p.color), size: p.size * .5, add: true });
      let hit = solid(p.x, p.y) || p.life <= 0;
      if (!hit && p.owner === 'p') { for (const e of enemies) if (!e.dead && Math.hypot(e.x - p.x, e.y - p.y) < e.r + p.r) { hit = true; if (!p.splash) { const { dmg, crit } = critRoll(p.dmg); damageEnemy(e, dmg, crit, Math.atan2(p.vy, p.vx), .15, p.sid); } break; } }
      if (!hit && p.owner === 'e' && Math.hypot(P.x - p.x, P.y - p.y) < .3 + p.r) { hit = true; if (!p.splash) hurtPlayer(p.dmg, p.x - p.vx, p.y - p.vy); }
      if (hit) {
        p.dead = true;
        if (p.splash) { const back = .15; explode(p.x - p.vx / Math.hypot(p.vx, p.vy) * back, p.y - p.vy / Math.hypot(p.vx, p.vy) * back, p.splash, p.owner === 'p' ? critRoll(p.dmg).dmg : p.dmg, true, p, p.owner === 'p' ? p.sid : null); }
        else burst(p.x - p.vx * .01, p.y - p.vy * .01, p.z, 6, p.color, 2, .3, true);
      }
    }
    projectiles = projectiles.filter(p => !p.dead);
  }
  function updateRings(dt) {
    for (const r of rings) {
      r.r += r.speed * dt;
      if (!r.hit && !r.fx) { const d = Math.hypot(P.x - r.x, P.y - r.y); if (Math.abs(d - r.r) < .35 && P.dashT <= 0) { r.hit = true; hurtPlayer(r.dmg, r.x, r.y); } }
    }
    rings = rings.filter(r => r.r < r.max);
  }

  /* ---------------- Loot ---------------- */
  function updateItems(dt) {
    for (const it of items) {
      it.t += dt;
      const d = Math.hypot(P.x - it.x, P.y - it.y);
      if (d < .55) tryPickup(it);
      else if (d < 1.4 && (it.kind === 'ammo' || it.kind === 'module' || it.kind === 'key')) { it.x += (P.x - it.x) * dt * 3; it.y += (P.y - it.y) * dt * 3; }
    }
    items = items.filter(it => !it.taken);
  }
  function tryPickup(it) {
    const p = P;
    switch (it.kind) {
      case 'ammo': { const k = it.sub; if (p.pools[k] >= POOL_MAX[k]) return; p.pools[k] = Math.min(POOL_MAX[k], p.pools[k] + AMMO_PICK[k]); toast(`+${AMMO_PICK[k]} ${ammoName(k)}`, '', '#e0c080', 1.4); sfx('ammo'); break; }
      case 'health': if (p.hp >= p.maxHp) return; p.hp = Math.min(p.maxHp, p.hp + 25); toast('+25 HEALTH', '', '#ff6a6a', 1.4); sfx('health'); break;
      case 'armor': if (p.armor >= p.maxArmor) return; p.armor = Math.min(p.maxArmor, p.armor + 25); toast('+25 ARMOUR', '', '#6fc8ff', 1.4); sfx('armor'); break;
      case 'key': p.key = true; toast('KEYCARD', 'Head for the exit door', '#ffd166'); sfx('key'); break;
      case 'weapon': {
        const w = it.sub; if (!p.owned.includes(w)) { p.owned.push(w); L.lootGot.push({ name: WEAPONS[w].name, color: WEAPONS[w].color }); }
        const d = WEAPONS[w]; if (d.ammo) p.pools[d.ammo] = Math.min(POOL_MAX[d.ammo], p.pools[d.ammo] + AMMO_PICK[d.ammo] * 2);
        if (d.mag) p.mag[w] = magCap(w);
        toast(`NEW WEAPON: ${d.name.toUpperCase()}`, `${d.desc} · key ${d.slot}`, d.color, 4); sfx('weapon'); selectWeapon(w); break;
      }
      case 'module': grantModule(it.sub); break;
      case 'chest': openChest(it); break;
    }
    it.taken = true;
  }
  const ammoName = k => ({ shells: 'shells', bullets: 'rounds', cells: 'cells', rockets: 'rockets' }[k]);
  function grantModule(rarId) {
    const rar = RARITY.findIndex(r => r.id === rarId), m = pick(MODS), v = m.vals[rar];
    P.mods[m.id] = (P.mods[m.id] || 0) + v;
    if (m.id === 'armorMax') { P.maxArmor += v; P.armor = Math.min(P.maxArmor, P.armor + v); }
    if (m.id === 'hpMax') { P.maxHp += v; P.hp += v; }
    P.modList.push({ id: m.id, rar });
    const R = RARITY[rar];
    L.lootGot.push({ name: `${m.name} (${R.name.toLowerCase()})`, color: R.color });
    toast(`${R.name.toUpperCase()} · ${m.name.toUpperCase()}`, m.fmt(v), R.color, 3.5);
    sfx(rar >= 2 ? 'rare' : 'module');
  }
  function openChest(it) {
    const rar = RARITY.findIndex(r => r.id === it.sub);
    toast('CHEST OPENED', `${RARITY[rar].name} loot`, RARITY[rar].color);
    sfx('chest');
    burst(it.x, it.y, -.3, 30, RARITY[rar].color, 3, .8, true);
    const n = 1 + Math.floor(rar / 2) + (L.boss ? 1 : 0);
    for (let i = 0; i < n; i++) items.push({ kind: 'module', sub: rollRarity(Math.max(0, rar - 1)), x: it.x + rand(-.6, .6), y: it.y + rand(-.6, .6), t: 0 });
    const missing = ORDER.filter(w => !P.owned.includes(w));
    if (L.boss && missing.length) items.push({ kind: 'weapon', sub: missing[0], x: it.x + .6, y: it.y, t: 0 });
    items.push({ kind: 'ammo', sub: null, x: it.x - .5, y: it.y + .3, t: 0 }); items[items.length - 1].sub = pick(P.owned.map(w => WEAPONS[w].ammo).filter(Boolean).concat(['shells']));
    if (L.boss) items.push({ kind: 'health', x: it.x, y: it.y - .6, t: 0 }, { kind: 'armor', x: it.x - .6, y: it.y - .4, t: 0 });
  }

  /* ---------------- Particles ---------------- */
  function burst(x, y, z, n, color, speed, life, add) {
    const tex = add ? glowTex(color) : DARK_TEX;
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(.2, 1) * speed;
      particles.push({ x, y, z, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rand(-.5, 1.5) * speed * .5, g: add ? 1.5 : 6, life: rand(.4, 1) * life, max: life, tex, size: add ? rand(.08, .2) : rand(.05, .12), add });
    }
  }
  const DARK_TEX = spriteFrom(8, g => { g.fillStyle = '#2a2a2e'; g.fillRect(1, 1, 6, 6); });

  /* =====================================================================
     DRAWING: scene + weapon + HUD
     ===================================================================== */
  function draw(t, dt) {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    if (!L) { menuBackdrop(t); return; }
    render3D();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    const sh = shake * 6;
    ctx.drawImage(view, rand(-sh, sh) - sh, rand(-sh, sh) - sh, W + sh * 2, H + sh * 2);
    // Muzzle light and vignette
    if (lightBoost > .05) { const g = ctx.createRadialGradient(W / 2, H * .85, 10, W / 2, H * .7, W * .6); g.addColorStop(0, `rgba(255,200,140,${lightBoost * .25})`); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
    ctx.drawImage(VIGNETTE, 0, 0, W, H);
    const inGame = mode === 'play' || mode === 'pause' || mode === 'dead' || mode === 'end';
    if (inGame) drawWeaponView(t);
    // View through the helmet: glass, cracks, projected HUD and visor frame
    if (!VISOR || VISOR.width !== Math.round(W * scale)) buildVisor();
    ctx.drawImage(GLASS, 0, 0, W, H);
    drawCracks();
    if (hurtFlash > 0) { const g = ctx.createRadialGradient(W / 2, H / 2, H * .2, W / 2, H / 2, W * .7); g.addColorStop(0, 'rgba(255,0,0,0)'); g.addColorStop(1, `rgba(200,0,0,${hurtFlash * .55})`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
    if (inGame) drawHud(t);
    ctx.drawImage(VISOR, 0, 0, W, H);
  }

  /* ---------------- Helmet: visor frame, glass and cracks ---------------- */
  let VISOR = null, GLASS = null, CRACKS = [];
  const visorPath = () => { const p = new Path2D(); p.roundRect(28, 24, W - 56, H - 40, [180, 180, 200, 200]); return p; };
  function buildVisor() {
    const s = scale, cw = Math.round(W * s), chh = Math.round(H * s), open = visorPath();
    const c = document.createElement('canvas'); c.width = cw; c.height = chh;
    const g = c.getContext('2d'); g.scale(s, s);
    const hg = g.createRadialGradient(W / 2, H / 2, H * .45, W / 2, H / 2, W * .72); hg.addColorStop(0, '#1d2127'); hg.addColorStop(1, '#040506');
    g.fillStyle = hg; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'destination-out'; g.fill(open); g.globalCompositeOperation = 'source-over';
    g.save(); g.clip(open); g.shadowColor = 'rgba(0,0,0,.95)'; g.shadowBlur = 50; g.strokeStyle = '#000'; g.lineWidth = 30; g.stroke(open); g.restore();
    g.strokeStyle = '#2b3037'; g.lineWidth = 8; g.stroke(open);
    g.strokeStyle = 'rgba(170,200,220,.4)'; g.lineWidth = 1.5; g.stroke(open);
    for (const [x, y] of [[70, 58], [W - 70, 58], [74, H - 50], [W - 74, H - 50]]) { g.fillStyle = '#2c3138'; g.beginPath(); g.arc(x, y, 6, 0, TAU); g.fill(); g.fillStyle = '#0c0e10'; g.fillRect(x - 4, y - 1, 8, 2); }
    g.fillStyle = '#46f0d0'; g.beginPath(); g.arc(W / 2 - 46, 12, 3, 0, TAU); g.fill();
    g.fillStyle = '#ff5a3c'; g.beginPath(); g.arc(W / 2 + 46, 12, 3, 0, TAU); g.fill();
    VISOR = c;
    const c2 = document.createElement('canvas'); c2.width = cw; c2.height = chh;
    const q = c2.getContext('2d'); q.scale(s, s); q.save(); q.clip(open);
    const tg = q.createRadialGradient(W / 2, H / 2, H * .35, W / 2, H / 2, W * .6); tg.addColorStop(0, 'rgba(120,220,255,0)'); tg.addColorStop(1, 'rgba(120,220,255,.11)');
    q.fillStyle = tg; q.fillRect(0, 0, W, H);
    q.fillStyle = 'rgba(255,255,255,.045)';
    q.beginPath(); q.moveTo(W * .1, 0); q.lineTo(W * .19, 0); q.lineTo(W * .03, H * .5); q.lineTo(0, H * .42); q.fill();
    q.beginPath(); q.moveTo(W * .23, 0); q.lineTo(W * .255, 0); q.lineTo(W * .075, H * .52); q.lineTo(W * .055, H * .52); q.fill();
    q.fillStyle = 'rgba(180,240,255,.022)'; for (let y = 0; y < H; y += 3) q.fillRect(0, y, W, 1);
    q.restore();
    GLASS = c2;
  }
  // Glass cracks: they appear once health drops below half.
  function newCracks() {
    CRACKS = [];
    for (let i = 0; i < 5; i++) {
      const pts = [[rand(W * .15, W * .85), rand(H * .15, H * .8)]];
      for (let k = 0; k < 7; k++) { const [x, y] = pts[pts.length - 1]; pts.push([x + rand(-70, 70), y + rand(-50, 50)]); }
      CRACKS.push(pts);
    }
  }
  function drawCracks() {
    if (!P || !CRACKS.length) return;
    const k = clamp((.5 - P.hp / P.maxHp) * 2.4, 0, .85);
    if (k <= 0) return;
    const n = Math.ceil(k * CRACKS.length);
    ctx.save(); ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const pts = CRACKS[i];
      ctx.strokeStyle = `rgba(230,245,255,${k * .55})`; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(...pts[0]); for (const p of pts.slice(1)) ctx.lineTo(...p); ctx.stroke();
      ctx.strokeStyle = `rgba(0,0,0,${k * .35})`; ctx.lineWidth = 3; ctx.stroke();
      ctx.strokeStyle = `rgba(230,245,255,${k * .4})`; ctx.lineWidth = 1;
      for (let j = 1; j < pts.length; j += 2) { ctx.beginPath(); ctx.moveTo(...pts[j]); ctx.lineTo(pts[j][0] + (j % 3 - 1) * 30, pts[j][1] + 24); ctx.stroke(); }
    }
    ctx.restore();
  }
  const VIGNETTE = (() => { const c = document.createElement('canvas'); c.width = 640; c.height = 360; const g = c.getContext('2d'), gr = g.createRadialGradient(320, 180, 100, 320, 180, 400); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.6)'); g.fillStyle = gr; g.fillRect(0, 0, 640, 360); return c; })();
  function menuBackdrop(t) {
    const g = ctx.createRadialGradient(W / 2, H * .6, 20, W / 2, H / 2, W * .8);
    g.addColorStop(0, '#3a1a10'); g.addColorStop(1, '#05060a'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 60; i++) { const x = (i * 137 + t * 20 * (1 + i % 3)) % W, y = H - ((i * 53 + t * 40 * (1 + i % 2)) % H); ctx.fillStyle = `rgba(255,${120 + i % 80},60,.5)`; ctx.fillRect(x, y, 2, 2); }
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------------- First-person weapon (in perspective) ----------------
     Each weapon is built along an axis running from the hand (near, bottom right)
     to the muzzle (far, next to the crosshair). Parts are placed at
     t = 0…1 along the axis and taper with distance. */
  function muzzle(x, y, s, col) {
    if (W8.flash <= 0) return;
    const r = s * (.6 + W8.flash * .6) / 1.7; ctx.save(); ctx.globalCompositeOperation = 'lighter'; // drawn already scaled with the weapon
    const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(.3, rgba(col, .8)); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.translate(x, y); ctx.rotate(rand(0, TAU)); ctx.fillStyle = rgba(col, .6);
    for (let i = 0; i < 5; i++) { ctx.rotate(TAU / 5); ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(r * 1.3, 0); ctx.lineTo(0, 4); ctx.fill(); }
    ctx.restore();
  }
  function mkAxis(N, F) {
    const dx = F[0] - N[0], dy = F[1] - N[1], len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
    let tx = -uy, ty = ux; if (ty > 0) { tx = -tx; ty = -ty; } // normal pointing towards the top of the weapon
    return { N, F, ux, uy, tx, ty, ang: Math.atan2(dy, dx), at: (t, off = 0) => [N[0] + dx * t + tx * off, N[1] + dy * t + ty * off] };
  }
  const lerp = (a, b, k) => a + (b - a) * k;
  // Part between t0 and t1. cols = [light, mid, dark]; flat = prism (hard edges), otherwise a cylinder.
  function part(ax, t0, t1, r0, r1, cols, o = {}) {
    const off0 = o.off0 || 0, off1 = o.off1 ?? off0;
    const [x0, y0] = ax.at(t0, off0), [x1, y1] = ax.at(t1, off1), { tx, ty } = ax;
    ctx.beginPath();
    ctx.moveTo(x0 + tx * r0, y0 + ty * r0); ctx.lineTo(x1 + tx * r1, y1 + ty * r1);
    ctx.lineTo(x1 - tx * r1, y1 - ty * r1); ctx.lineTo(x0 - tx * r0, y0 - ty * r0); ctx.closePath();
    const g = ctx.createLinearGradient(x0 + tx * r0, y0 + ty * r0, x0 - tx * r0, y0 - ty * r0);
    if (o.flat) { g.addColorStop(0, cols[0]); g.addColorStop(.2, cols[0]); g.addColorStop(.23, cols[1]); g.addColorStop(.72, cols[1]); g.addColorStop(.75, cols[2]); g.addColorStop(1, cols[2]); }
    else { g.addColorStop(0, cols[1]); g.addColorStop(.18, cols[0]); g.addColorStop(.32, cols[1]); g.addColorStop(1, cols[2]); }
    ctx.fillStyle = g; ctx.fill();
    if (o.edge !== false) { ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1.2; ctx.stroke(); }
    if (o.cap) {
      ctx.fillStyle = o.cap; ctx.beginPath(); ctx.ellipse(x1, y1, r1 * .42, r1, ax.ang, 0, TAU); ctx.fill();
      if (o.hole) { ctx.fillStyle = o.hole; ctx.beginPath(); ctx.ellipse(x1, y1, r1 * .26, r1 * .62, ax.ang, 0, TAU); ctx.fill(); }
    }
    return [x1, y1];
  }
  function ring(ax, t, r, color, w = 3, off = 0) { const [x, y] = ax.at(t, off); ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath(); ctx.ellipse(x, y, r * .42, r, ax.ang, 0, TAU); ctx.stroke(); }
  function bandLine(ax, t, rTop, rBot, color, w = 2, off = 0) { const [x, y] = ax.at(t, off); ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x + ax.tx * rTop, y + ax.ty * rTop); ctx.lineTo(x - ax.tx * rBot, y - ax.ty * rBot); ctx.stroke(); }

  // Tactical glove gripping a part; rot orients the fingers around it.
  function glove(x, y, s, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
    const g = ctx.createLinearGradient(-34, -30, 34, 30); g.addColorStop(0, '#565c52'); g.addColorStop(1, '#15170f');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 4, 36, 28, 0, 0, TAU); ctx.fill();
    for (let i = 0; i < 4; i++) {
      const fg = ctx.createLinearGradient(0, -36, 0, 0); fg.addColorStop(0, '#4c5148'); fg.addColorStop(1, '#262920');
      ctx.fillStyle = fg; ctx.beginPath(); ctx.roundRect(-31 + i * 15.5, -34, 13.5, 32, 6.5); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.fillRect(-29 + i * 15.5, -32, 8, 3);
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(-31 + i * 15.5, -16, 13.5, 2);
    }
    ctx.fillStyle = '#1e2119'; ctx.beginPath(); ctx.roundRect(-30, -6, 60, 15, 6); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fillRect(-27, -5, 54, 2);
    ctx.fillStyle = '#41463d'; ctx.beginPath(); ctx.ellipse(30, 14, 10, 19, -.7, 0, TAU); ctx.fill();
    ctx.restore();
  }
  // Armoured forearm from the edge of the screen to the hand.
  function sleeve(x0, y0, x1, y1, w0, w1) {
    const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
    const g = ctx.createLinearGradient(x0 + nx * w0, y0 + ny * w0, x0 - nx * w0, y0 - ny * w0);
    g.addColorStop(0, '#47505b'); g.addColorStop(.45, '#232a33'); g.addColorStop(1, '#0b0d11');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x0 + nx * w0, y0 + ny * w0); ctx.lineTo(x1 + nx * w1, y1 + ny * w1); ctx.lineTo(x1 - nx * w1, y1 - ny * w1); ctx.lineTo(x0 - nx * w0, y0 - ny * w0); ctx.fill();
    // Armour plate and suit colour stripe
    const k0 = .35, k1 = .7, a = (k, s) => [x0 + dx * k + nx * lerp(w0, w1, k) * s, y0 + dy * k + ny * lerp(w0, w1, k) * s];
    const pg = ctx.createLinearGradient(...a(k0, 1), ...a(k0, -.2)); pg.addColorStop(0, '#5d6873'); pg.addColorStop(1, '#2a3038');
    ctx.fillStyle = pg; ctx.beginPath(); ctx.moveTo(...a(k0, .95)); ctx.lineTo(...a(k1, .9)); ctx.lineTo(...a(k1, -.3)); ctx.lineTo(...a(k0, -.35)); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.strokeStyle = '#f07a5a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(...a(k0 + .03, .7)); ctx.lineTo(...a(k1 - .03, .66)); ctx.stroke();
    ctx.fillStyle = '#121519'; ctx.beginPath(); ctx.moveTo(...a(.92, 1.05)); ctx.lineTo(x1 + nx * w1 * 1.05, y1 + ny * w1 * 1.05); ctx.lineTo(x1 - nx * w1 * 1.05, y1 - ny * w1 * 1.05); ctx.lineTo(...a(.92, -1.05)); ctx.fill();
  }

  const MET = ['#a3aebb', '#4a5361', '#14181e'], DRK = ['#5d6773', '#262c35', '#0a0c10'], WOOD = ['#b07a4c', '#69442a', '#26170c'];
  const OLIVE = ['#a4b072', '#5c6c34', '#1c2410'], WHITE = ['#f2f5f8', '#a9b4c1', '#39434f'], PURP = ['#9a88c4', '#40305e', '#130b24'];
  let lastAim = 0, sway = 0;
  const VIEW = {
    blaster: { n: [.655, .98], f: [.56, .69], kick: 42, draw: viewBlaster },
    shotgun: { n: [.73, 1.03], f: [.548, .62], kick: 60, draw: viewShotgun },
    minigun: { n: [.71, 1.01], f: [.555, .66], kick: 12, draw: viewMinigun },
    rail: { n: [.72, 1.02], f: [.546, .61], kick: 64, draw: viewRail },
    launcher: { n: [.75, 1.0], f: [.558, .64], kick: 46, draw: viewLauncher },
    tesla: { n: [.71, 1.01], f: [.553, .64], kick: 10, draw: viewTesla }
  };
  function drawWeaponView(t) {
    const w = P.weapon, moving = Math.min(1, Math.hypot(P.vx, P.vy) / 4);
    const da = angDiff(lastAim, P.a); lastAim = P.a; sway += (clamp(da * 60, -1, 1) * 26 - sway) * .15;
    const bx = Math.sin(P.bob * 1.6) * 16 * moving + sway, by = Math.abs(Math.cos(P.bob * 1.6)) * 14 * moving;
    let rk = 0;
    if (W8.state === 'reload') rk = w === 'shotgun' ? .5 : Math.sin(clamp(W8.t / W8.reloadDur, 0, 1) * Math.PI);
    const drop = W8.lower * 440 + rk * 90, rec = W8.recoil, cfg = VIEW[w];
    const N = [W * cfg.n[0] + bx + rec * 16, H * cfg.n[1] + by + drop + rec * 24];
    const F = [W * cfg.f[0] + bx * .55 + rec * 8 + rk * 150, H * cfg.f[1] + by * .55 + drop - rec * cfg.kick + rk * 70];
    // The weapon is drawn at scale VS from the hand: the axis is shortened in proportion so that
    // the muzzle still sits next to the crosshair, but the weapon takes up much more space.
    const Fl = [N[0] + (F[0] - N[0]) / VS * 1.04, N[1] + (F[1] - N[1]) / VS * 1.04];
    const ax = mkAxis(N, Fl);
    ctx.save();
    ctx.translate(N[0], N[1]); ctx.scale(VS, VS); ctx.translate(-N[0], -N[1]);
    viewOrigin = N;
    cfg.draw(ax, t, rk);
    ctx.restore();
  }
  const VS = 2.1;
  let viewOrigin = [0, 0];
  // Converts a screen point into the weapon's scaled space (for the tesla arcs).
  const toView = (x, y) => [viewOrigin[0] + (x - viewOrigin[0]) / VS, viewOrigin[1] + (y - viewOrigin[1]) / VS];
  // Standard arms: right hand on the grip, left hand supporting the front.
  function arms(ax, tR, offR, tL, offL, sR = 1.3, sL = 1.1) {
    const r = ax.at(tR, offR), l = ax.at(tL, offL);
    sleeve(W * .98, H + 70, r[0] + 30, r[1] + 26, 110, 52);
    sleeve(W * .36, H + 90, l[0] - 10, l[1] + 22, 100, 46);
    return { r, l, gripR: () => glove(r[0], r[1], sR, ax.ang + 1.45), gripL: () => glove(l[0], l[1], sL, ax.ang + 1.9) };
  }

  function viewBlaster(ax, t) {
    const A = arms(ax, .1, -40, .24, -36, 1.25, 1.05);
    const gp = ax.at(.08, -14), ga = mkAxis(gp, [gp[0] + 46, gp[1] + 120]);
    A.gripL();
    part(ga, 0, 1, 24, 30, DRK, { flat: true });
    for (let i = 1; i < 5; i++) bandLine(ga, i * .2, 24, 26, 'rgba(0,0,0,.4)', 2);
    A.gripR();
    part(ax, 0, .74, 34, 16, DRK, { flat: true, off0: -10, off1: -5 });
    const sb = W8.recoil * .07; // the slide kicks back when firing
    part(ax, -.04 - sb, .84 - sb, 40, 19, MET, { flat: true, off0: 10, off1: 5 });
    for (let i = 0; i < 4; i++) {
      const tt = .34 + i * .1 - sb, r = lerp(40, 19, tt), heat = W8.heat;
      bandLine(ax, tt, r * .9 + 8, -r * .1 - 6, `rgb(${70 + heat * 185},${210 - heat * 160},${255 - heat * 230})`, 3.5, 6);
    }
    const tip = part(ax, .82, 1, 17, 12, DRK, { cap: '#0a0c10', hole: rgba('#46e0ff', .9) });
    ring(ax, .9, 15, rgba('#46e0ff', .85), 3);
    if (W8.over) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (let i = 0; i < 6; i++) { const [x, y] = ax.at(rand(.35, .7), rand(30, 70)); ctx.fillStyle = `rgba(220,220,230,${rand(.05, .15)})`; ctx.beginPath(); ctx.arc(x, y - rand(0, 30), rand(8, 20), 0, TAU); ctx.fill(); } ctx.restore(); }
    muzzle(tip[0], tip[1], 70, '#46e0ff');
  }

  function viewShotgun(ax, t) {
    const pumpT = W8.pump > 0 ? Math.sin((1 - W8.pump) * Math.PI) * .12 : 0;
    const reloading = W8.state === 'reload', rp = reloading ? Math.sin(clamp(W8.t / W8.reloadDur, 0, 1) * Math.PI) : 0;
    const A = arms(ax, .05, -42, reloading ? lerp(.56, .26, rp) : .57 - pumpT, reloading ? lerp(-30, -6, rp) : -30, 1.35, 1.1);
    part(ax, -.1, .3, 66, 42, DRK, { flat: true });
    bandLine(ax, .16, 40, -20, 'rgba(0,0,0,.5)', 3); // ejection port
    A.gripR();
    part(ax, .3, .93, 17, 8, ['#8c96a2', '#3c4450', '#121519'], { off0: -20, off1: -9, cap: '#20242a' });
    const tip = part(ax, .28, 1, 22, 10, MET, { off0: 15, off1: 6, cap: '#1a1d22', hole: '#050506' });
    part(ax, .47 - pumpT, .66 - pumpT, 30, 20, WOOD, { flat: true, off0: -10, off1: -6 });
    for (let i = 1; i < 6; i++) bandLine(ax, .47 - pumpT + i * .03, lerp(30, 20, i / 6) - 4, lerp(30, 20, i / 6), 'rgba(0,0,0,.35)', 2, -10);
    const [bx, by] = ax.at(.99, 18); ctx.fillStyle = '#e8e2d0'; ctx.beginPath(); ctx.arc(bx, by, 3, 0, TAU); ctx.fill();
    // Shell ejected when pumping
    if (W8.pump > .15 && W8.pump < .85) { const k = 1 - W8.pump, [sx, sy] = ax.at(.17, 50); ctx.save(); ctx.translate(sx + k * 160, sy - k * 120 + k * k * 160); ctx.rotate(k * 9); ctx.fillStyle = '#c0392b'; ctx.fillRect(-7, -16, 14, 24); ctx.fillStyle = '#d4a020'; ctx.fillRect(-7, 6, 14, 7); ctx.restore(); }
    if (reloading) { const [hx, hy] = A.l; ctx.save(); ctx.translate(hx + 10, hy - 30); ctx.rotate(ax.ang + 1.6); ctx.fillStyle = '#c0392b'; ctx.fillRect(-8, -22, 16, 30); ctx.fillStyle = '#d4a020'; ctx.fillRect(-8, 6, 16, 9); ctx.restore(); }
    A.gripL();
    muzzle(tip[0], tip[1], 110, '#ffb35a');
  }

  function viewMinigun(ax, t) {
    const A = arms(ax, .02, -66, .44, -62, 1.4, 1.2);
    part(ax, .04, .3, 38, 28, OLIVE, { flat: true, off0: -96, off1: -74 }); // ammo box
    for (let i = 0; i < 7; i++) { const k = (i / 7 + (W8.spinA * .02) % (1 / 7)); const [x, y] = ax.at(lerp(.26, .34, k), lerp(-66, -40, k)); ctx.fillStyle = '#d4a020'; ctx.fillRect(x - 5, y - 9, 10, 16); ctx.fillStyle = '#7a5a10'; ctx.fillRect(x - 5, y + 3, 10, 3); }
    part(ax, -.12, .38, 88, 58, DRK, { flat: true });
    for (let i = 1; i < 5; i++) bandLine(ax, -.06 + i * .08, 70, 20, 'rgba(255,255,255,.07)', 3, 10);
    part(ax, .12, .3, 7, 6, DRK, { off0: 74, off1: 56 }); // carry handle
    A.gripR();
    const barrels = [];
    for (let i = 0; i < 6; i++) { const a = W8.spinA + i * TAU / 6; barrels.push({ a, depth: Math.sin(a) }); }
    barrels.sort((p, q) => p.depth - q.depth);
    for (const b of barrels) {
      const c = b.depth > 0 ? ['#b3bdc9', '#5a6470', '#1a1e24'] : ['#6a737e', '#30363e', '#0e1014'];
      part(ax, .36, 1, 10, 4.8, c, { off0: Math.cos(b.a) * 34, off1: Math.cos(b.a) * 14, cap: '#0b0c0e' });
    }
    ring(ax, .56, lerp(48, 20, .56) * .9, '#22272e', 8); ring(ax, .94, 20, '#22272e', 6);
    if (W8.spreadHeat > .05) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const [x, y] = ax.at(.92); const g = ctx.createRadialGradient(x, y, 0, x, y, 40); g.addColorStop(0, `rgba(255,120,40,${W8.spreadHeat * .6})`); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 40, 0, TAU); ctx.fill(); ctx.restore(); }
    if (W8.spin > 0 && W8.spin < 1) { const [x, y] = ax.at(.2, 90); ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(x - 60, y, 120, 6); ctx.fillStyle = '#ffd166'; ctx.fillRect(x - 60, y, 120 * W8.spin, 6); }
    A.gripL();
    const tip = ax.at(1.01); muzzle(tip[0], tip[1], 90, '#ffd166');
  }

  function viewRail(ax, t) {
    const c = W8.charge;
    const A = arms(ax, .04, -44, .5, -40, 1.35, 1.1);
    part(ax, -.1, .44, 62, 34, WHITE, { flat: true });
    part(ax, -.06, .42, 6, 3.5, ['#9fe4ff', '#3a9ad0', '#123048'], { off0: -2, off1: -2, edge: false });
    A.gripR();
    part(ax, .1, .42, 17, 12, DRK, { off0: 72, off1: 47, cap: '#0a0e14', hole: '#3a9ad0' }); // telescopic sight
    const [lx, ly] = ax.at(.1, 72); ctx.fillStyle = rgba('#9fe4ff', .7); ctx.beginPath(); ctx.ellipse(lx, ly, 6, 13, ax.ang, 0, TAU); ctx.fill();
    part(ax, .38, 1, 9, 4, MET, { flat: true, off0: 28, off1: 10 });
    part(ax, .38, 1, 9, 4, MET, { flat: true, off0: -28, off1: -10 });
    for (let i = 0; i < 8; i++) { const tt = .45 + i * .07, on = c * 8 > i; ring(ax, tt, lerp(34, 13, tt), on ? '#7ad8ff' : '#1d2b39', 4); }
    if (c > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const [x, y] = ax.at(.75); const g = ctx.createRadialGradient(x, y, 0, x, y, 80 * c); g.addColorStop(0, `rgba(190,240,255,${c * .7})`); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 80 * c, 0, TAU); ctx.fill(); ctx.restore(); }
    A.gripL();
    const tip = ax.at(1.01); muzzle(tip[0], tip[1], 120, '#7ad8ff');
  }

  function viewLauncher(ax, t, rk) {
    const A = arms(ax, .08, -76, .5, -60, 1.4, 1.2);
    const tube = part(ax, -.18, 1, 98, 40, OLIVE, { cap: '#20261a', hole: '#050604' });
    ring(ax, .32, lerp(98, 40, .41), '#2a3218', 9); ring(ax, .72, lerp(98, 40, .76), '#2a3218', 9);
    ring(ax, .93, 42, '#e0b830', 5);
    part(ax, .5, .6, 4, 3, DRK, { off0: 74, off1: 58, flat: true }); // flip-up sight
    const [sx, sy] = ax.at(.6, 66); ctx.strokeStyle = '#1a1e12'; ctx.lineWidth = 3; ctx.strokeRect(sx - 12, sy - 22, 24, 22);
    if (P.mag.launcher > 0 && W8.cd < .35) { const [x, y] = tube; const extra = W8.state === 'reload' ? (1 - rk) * 60 : 0; ctx.fillStyle = '#c84a2a'; ctx.beginPath(); ctx.ellipse(x - ax.ux * extra, y - ax.uy * extra, 13, 26, ax.ang, 0, TAU); ctx.fill(); ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.ellipse(x - ax.ux * extra, y - ax.uy * extra, 5, 10, ax.ang, 0, TAU); ctx.fill(); }
    A.gripR(); A.gripL();
    muzzle(tube[0], tube[1], 130, '#ff8a3d');
  }

  function viewTesla(ax, t) {
    const A = arms(ax, .04, -44, .44, -42, 1.35, 1.1);
    part(ax, -.1, .56, 64, 34, PURP, { flat: true });
    A.gripR();
    const firing = W8.beam > 0;
    for (const [tt, r] of [[.58, 34], [.68, 30], [.78, 25]]) { ring(ax, tt, r, '#c88a3a', 7); if (firing) ring(ax, tt, r, rgba('#e0c8ff', .5 + Math.random() * .4), 2); }
    part(ax, .78, 1, 5, 2.5, MET, { off0: 20, off1: 3 }); part(ax, .78, 1, 5, 2.5, MET, { off0: -20, off1: -3 });
    const tip = ax.at(1.02);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(tip[0], tip[1], 0, tip[0], tip[1], firing ? 60 : 22); g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(.4, 'rgba(185,140,255,.7)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(tip[0], tip[1], firing ? 60 : 22, 0, TAU); ctx.fill();
    if (firing) {
      ctx.strokeStyle = 'rgba(210,180,255,.9)'; ctx.lineWidth = 2.5;
      const [cx, cy] = toView(W / 2, H / 2);
      ctx.lineWidth = 1.4;
      for (let k = 0; k < 3; k++) { ctx.beginPath(); let x = tip[0], y = tip[1]; ctx.moveTo(x, y); for (let i = 1; i <= 9; i++) { x = lerp(tip[0], cx, i / 9) + rand(-12, 12); y = lerp(tip[1], cy, i / 9) + rand(-12, 12); ctx.lineTo(x, y); } ctx.stroke(); }
    }
    ctx.restore();
    A.gripL();
  }

  /* ---------------- HUD ---------------- */
  const FONT = '"Chakra Petch", sans-serif';
  // Panels projected onto the helmet visor: translucent cyan glass with marked corners.
  function panel(x, y, w, h, r = 12) {
    ctx.fillStyle = 'rgba(12,40,52,.32)'; ctx.strokeStyle = 'rgba(140,230,255,.3)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); ctx.stroke();
    const k = 12; ctx.strokeStyle = 'rgba(160,240,255,.85)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y + k); ctx.lineTo(x, y); ctx.lineTo(x + k, y); ctx.moveTo(x + w - k, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - k); ctx.stroke();
  }
  function bar(x, y, w, h, v, c1, c2) { ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.beginPath(); ctx.roundRect(x, y, w, h, h / 2); ctx.fill(); if (v <= 0) return; const g = ctx.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, c1); g.addColorStop(1, c2); ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(x, y, Math.max(h, w * clamp(v, 0, 1)), h, h / 2); ctx.fill(); }
  function drawHud(t) {
    ctx.save(); ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(120,230,255,.55)'; ctx.shadowBlur = 7; // holographic glow
    // Dynamic crosshair
    const sp = 10 + W8.recoil * 18 + (P.weapon === 'shotgun' ? 18 : 0) + (P.weapon === 'minigun' ? W8.spreadHeat * 20 : 0);
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(W / 2 - sp - 8, H / 2); ctx.lineTo(W / 2 - sp, H / 2); ctx.moveTo(W / 2 + sp, H / 2); ctx.lineTo(W / 2 + sp + 8, H / 2); ctx.moveTo(W / 2, H / 2 - sp - 8); ctx.lineTo(W / 2, H / 2 - sp); ctx.moveTo(W / 2, H / 2 + sp); ctx.lineTo(W / 2, H / 2 + sp + 8); ctx.stroke();
    if (hitMark > 0) { ctx.strokeStyle = critMark > 0 ? '#ffd166' : '#fff'; ctx.lineWidth = critMark > 0 ? 3 : 2; const k = 7, o = 5; ctx.beginPath(); for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ctx.moveTo(W / 2 + sx * o, H / 2 + sy * o); ctx.lineTo(W / 2 + sx * (o + k), H / 2 + sy * (o + k)); } ctx.stroke(); }
    if (P.weapon === 'rail' && W8.charge > 0) { ctx.strokeStyle = '#7ad8ff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(W / 2, H / 2, 26, -Math.PI / 2, -Math.PI / 2 + W8.charge * TAU); ctx.stroke(); }
    // Damage direction indicators
    for (const d of dmgDirs) { const rel = angDiff(P.a, d.a); ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(rel + Math.PI / 2); ctx.strokeStyle = `rgba(255,60,40,${d.t * .7})`; ctx.lineWidth = 10; ctx.beginPath(); ctx.arc(0, 0, 170, -Math.PI / 2 - .3, -Math.PI / 2 + .3); ctx.stroke(); ctx.restore(); }
    // Health and armour (bottom left, inside the visor)
    ctx.save(); ctx.translate(96, -28);
    panel(20, H - 98, 320, 78);
    ctx.font = `700 36px ${FONT}`; ctx.fillStyle = P.hp < 30 ? '#ff5a5a' : '#f4f1ea'; ctx.fillText(Math.ceil(Math.max(0, P.hp)), 36, H - 92);
    ctx.font = `600 10px ${FONT}`; ctx.fillStyle = '#9aa3a8'; ctx.fillText('HEALTH', 112, H - 86); ctx.fillText('ARMOUR', 112, H - 52);
    bar(112, H - 72, 210, 9, P.hp / P.maxHp, '#ff4f4f', '#ff9a7a');
    bar(112, H - 38, 210, 9, P.armor / P.maxArmor, '#3a8aff', '#7ad8ff');
    ctx.font = `600 12px ${FONT}`; ctx.fillStyle = '#7ad8ff'; ctx.fillText(Math.ceil(P.armor), 36, H - 48);
    // Modules
    const ml = P.modList.slice(-12);
    ml.forEach((m, i) => { ctx.fillStyle = RARITY[m.rar].color; ctx.beginPath(); ctx.roundRect(20 + i * 22, H - 124, 18, 18, 4); ctx.fill(); ctx.fillStyle = '#0a0b10'; ctx.font = `700 9px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(MODS.find(x => x.id === m.id).name[0], 29 + i * 22, H - 120); ctx.textAlign = 'left'; });
    ctx.restore();
    // Ammo
    const d = WEAPONS[P.weapon];
    ctx.save(); ctx.translate(-96, -28);
    panel(W - 340, H - 98, 320, 78);
    ctx.textAlign = 'right'; ctx.font = `700 14px ${FONT}`; ctx.fillStyle = d.color; ctx.fillText(d.name.toUpperCase(), W - 36, H - 90);
    ctx.font = `700 34px ${FONT}`; ctx.fillStyle = '#f4f1ea';
    if (P.weapon === 'blaster') { ctx.fillText('∞', W - 36, H - 70); bar(W - 324, H - 40, 200, 9, W8.heat, W8.over ? '#ff3a1a' : '#46e0ff', W8.over ? '#ffb35a' : '#ff8a5a'); ctx.font = `600 10px ${FONT}`; ctx.fillStyle = '#9aa3a8'; ctx.textAlign = 'left'; ctx.fillText(W8.over ? 'OVERHEATED' : 'HEAT', W - 324, H - 56); }
    else if (P.weapon === 'tesla') { ctx.fillText(P.pools.cells, W - 36, H - 70); ctx.font = `600 10px ${FONT}`; ctx.fillStyle = '#9aa3a8'; ctx.fillText('CELLS', W - 36, H - 34); }
    else { ctx.fillText(`${P.mag[P.weapon]}`, W - 110, H - 70); ctx.font = `600 18px ${FONT}`; ctx.fillStyle = '#9aa3a8'; ctx.fillText(`/ ${P.pools[d.ammo]}`, W - 36, H - 58); if (W8.state === 'reload') { ctx.fillStyle = '#ffd166'; ctx.font = `600 11px ${FONT}`; ctx.fillText('RELOADING…', W - 36, H - 34); } else if (P.mag[P.weapon] === 0) { ctx.fillStyle = '#ff5a5a'; ctx.font = `600 11px ${FONT}`; ctx.fillText(P.pools[d.ammo] ? 'PRESS R' : 'NO AMMO', W - 36, H - 34); } }
    ctx.textAlign = 'left';
    ctx.restore();
    // Weapon slots
    ORDER.forEach((w, i) => {
      const x = W / 2 - 165 + i * 56, y = H - 70, own = P.owned.includes(w), cur = P.weapon === w;
      ctx.globalAlpha = own ? 1 : .25;
      ctx.fillStyle = cur ? rgba(WEAPONS[w].color, .25) : 'rgba(8,9,14,.55)'; ctx.strokeStyle = cur ? WEAPONS[w].color : 'rgba(255,255,255,.12)';
      ctx.beginPath(); ctx.roundRect(x, y, 50, 30, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = own ? WEAPONS[w].color : '#888'; ctx.font = `700 12px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(i + 1, x + 25, y + 8);
      ctx.textAlign = 'left';
    });
    ctx.globalAlpha = 1;
    // Sector and objective
    ctx.save(); ctx.translate(92, 30);
    panel(20, 20, 360, 64);
    ctx.font = `700 15px ${FONT}`; ctx.fillStyle = '#f07a5a'; ctx.fillText(`SECTOR ${String(L.idx + 1).padStart(2, '0')} · ${T.theme.name.toUpperCase()}`, 36, 30);
    const boss = enemies.find(e => e.boss && !e.dead);
    const doorShut = L.door && L.map[L.door.y * L.N + L.door.x] === 3;
    const obj = L.boss ? (boss ? 'Defeat the sector boss' : 'Go through the exit portal') : P.key ? (doorShut ? 'Open the exit door' : 'Reach the exit portal') : 'Find the keycard (golden guardian)';
    ctx.font = `500 12px ${FONT}`; ctx.fillStyle = '#e8e2d6'; ctx.fillText(obj, 36, 52);
    ctx.fillStyle = '#9aa3a8'; ctx.font = `500 10px ${FONT}`; ctx.fillText(`Kills ${P.kills}/${L.totalEnemies} · ${run.score} pts${P.key ? ' · 🔑' : ''}`, 36, 68);
    ctx.restore();
    // Boss
    if (boss && boss.alert) {
      ctx.save(); ctx.translate(0, 26);
      bar(W / 2 - 300, 26, 600, 12, boss.hp / boss.maxHp, boss.def.color, '#ffffff');
      ctx.textAlign = 'center'; ctx.font = `700 13px ${FONT}`; ctx.fillStyle = boss.def.color; ctx.fillText(`${boss.def.name.toUpperCase()}${boss.phase === 2 ? ' · PHASE 2' : ''}`, W / 2, 44); ctx.textAlign = 'left';
      ctx.restore();
    }
    ctx.shadowBlur = 0; drawMinimap(); ctx.shadowBlur = 7;
    // Toasts
    toasts.slice(0, 5).forEach((tt, i) => {
      const y = 130 + i * 50, w = 330, x = 112;
      ctx.globalAlpha = Math.min(1, tt.t * 2);
      panel(x, y, w, tt.sub ? 42 : 28, 9); ctx.fillStyle = tt.color; ctx.fillRect(x, y + 6, 3, (tt.sub ? 42 : 28) - 12);
      ctx.font = `700 13px ${FONT}`; ctx.fillText(tt.title, x + 14, y + 7);
      if (tt.sub) { ctx.font = `500 10px ${FONT}`; ctx.fillStyle = '#d6d0c6'; ctx.fillText(tt.sub.slice(0, 54), x + 14, y + 25); }
    });
    ctx.globalAlpha = 1;
    if (banner) {
      const a = clamp(Math.min(banner.t, 3.2 - banner.t * 0) * 1.5, 0, 1);
      ctx.globalAlpha = a; ctx.textAlign = 'center';
      ctx.font = `700 48px ${FONT}`; ctx.fillStyle = banner.color; ctx.fillText(banner.title, W / 2, H * .24);
      ctx.font = `500 14px ${FONT}`; ctx.fillStyle = '#eee'; ctx.fillText(banner.sub, W / 2, H * .24 + 58);
      ctx.globalAlpha = 1; ctx.textAlign = 'left';
    }
    if (P.dashCd > 0) { ctx.strokeStyle = 'rgba(122,216,255,.6)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(W / 2, H / 2, 40, Math.PI * .75, Math.PI * .75 + (1 - P.dashCd / 1.1) * Math.PI * 1.5); ctx.stroke(); }
    ctx.restore();
  }
  function drawMinimap() {
    const S = 180, x0 = W - S - 108, y0 = 52, N = L.N, k = S / N;
    panel(x0 - 6, y0 - 6, S + 12, S + 12, 12);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (!L.explored[y * N + x]) continue;
      const c = L.map[y * N + x];
      ctx.fillStyle = c === 0 ? 'rgba(220,210,190,.18)' : c === 3 ? '#ff5a3c' : 'rgba(240,122,90,.55)';
      if (c === 0 || c === 3 || hasFloorNb(x, y)) ctx.fillRect(x0 + x * k, y0 + y * k, k + .5, k + .5);
    }
    if (L.exitCell && L.explored[L.exitCell.y * N + L.exitCell.x]) { ctx.fillStyle = '#46f0d0'; ctx.fillRect(x0 + L.exitCell.x * k - 1, y0 + L.exitCell.y * k - 1, k + 2, k + 2); }
    for (const e of enemies) if (!e.dead && e.seen) { ctx.fillStyle = e.boss ? e.def.color : e.elite ? '#ffd166' : '#ff4f4f'; ctx.fillRect(x0 + e.x * k - 2, y0 + e.y * k - 2, e.boss ? 6 : 4, e.boss ? 6 : 4); }
    for (const it of items) if (it.kind === 'key' || it.kind === 'chest' || it.kind === 'weapon') { if (!L.explored[(it.y | 0) * N + (it.x | 0)]) continue; ctx.fillStyle = '#ffd166'; ctx.fillRect(x0 + it.x * k - 2, y0 + it.y * k - 2, 4, 4); }
    ctx.save(); ctx.translate(x0 + P.x * k, y0 + P.y * k); ctx.rotate(P.a);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -4); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fill(); ctx.restore();
  }
  const hasFloorNb = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => L.map[(y + dy) * L.N + x + dx] === 0);
  function toast(title, sub, color, t = 3) { toasts.unshift({ title, sub, color, t }); toasts.length = Math.min(toasts.length, 6); }

  /* =====================================================================
     GAME FLOW
     ===================================================================== */
  function newRun() {
    run = { kills: 0, score: 0, startTime: time, snap: null };
    P = newPlayer();
    enterLevel(0);
  }
  function enterLevel(idx) {
    loadLevel(idx);
    const info = L.info, th = THEMES[info.theme];
    $('#introEyebrow').textContent = `Sector ${String(idx + 1).padStart(2, '0')}${idx >= CAMPAIGN.length ? ' · endless mode' : ` of ${CAMPAIGN.length}`}`;
    $('#introTitle').textContent = th.name;
    $('#introText').textContent = info.boss ? `The ${BOSS[info.boss].name} awaits you in the arena. Defeat it to open the portal and claim its chest.`
      : `Find the golden guardian carrying the keycard, open the exit door and go through the portal. Enemy toughness: ${Math.round(hpMul() * 100)}%.`;
    mode = 'intro'; showOnly('#introScreen');
  }
  function beginLevel() {
    mode = 'play'; hideAll(); $('#screen').classList.add('playing');
    requestLock();
    banner = { title: THEMES[L.info.theme].name.toUpperCase(), sub: `Sector ${String(L.idx + 1).padStart(2, '0')}`, t: 2.6, color: '#f07a5a' };
    last = performance.now();
  }
  function levelComplete() {
    mode = 'end'; stopLoops(); exitLock();
    const acc = P.shots ? Math.round(P.hits / P.shots * 100) : 0;
    run.score += Math.round(2000 * (1 + L.idx * .2) * (P.kills / Math.max(1, L.totalEnemies)));
    const last12 = L.idx === CAMPAIGN.length - 1;
    $('#endEyebrow').textContent = last12 ? 'Campaign complete!' : 'Sector cleared';
    $('#endTitle').textContent = last12 ? 'The Forge has fallen' : THEMES[L.info.theme].name;
    $('#sTime').textContent = `${Math.floor(L.time / 60)}:${String(Math.floor(L.time % 60)).padStart(2, '0')}`;
    $('#sKills').textContent = `${P.kills}/${L.totalEnemies}`;
    $('#sAcc').textContent = `${acc}%`; $('#sScore').textContent = run.score;
    $('#endText').textContent = last12 ? 'You have survived all twelve sectors. Carry on in endless mode, which keeps getting harder.' : L.lootGot.length ? 'Loot collected in this sector:' : 'No special loot this time. Look out for chests and golden guardians.';
    $('#endLoot').innerHTML = L.lootGot.map(l => `<span style="color:${l.color}">${l.name}</span>`).join('');
    $('#endBtn').textContent = last12 ? 'Continue: endless mode ↗' : 'Next sector ↗';
    $('#endBtn').onclick = () => { P.hp = Math.min(P.maxHp, P.hp + 25); enterLevel(L.idx + 1); };
    $('#endMenuBtn').onclick = toMenu;
    const bestLvl = load('zona-mejor', 0); if (L.idx + 1 > bestLvl) save('zona-mejor', L.idx + 1);
    showOnly('#endScreen'); sfx('fanfare');
  }
  function die() {
    mode = 'dead'; stopLoops(); exitLock(); sfx('death');
    $('#endEyebrow').textContent = 'You have fallen';
    $('#endTitle').textContent = `Sector ${String(L.idx + 1).padStart(2, '0')} · ${THEMES[L.info.theme].name}`;
    $('#sTime').textContent = `${Math.floor(L.time / 60)}:${String(Math.floor(L.time % 60)).padStart(2, '0')}`;
    $('#sKills').textContent = `${P.kills}/${L.totalEnemies}`; $('#sAcc').textContent = `${P.shots ? Math.round(P.hits / P.shots * 100) : 0}%`; $('#sScore').textContent = run.score;
    $('#endText').textContent = 'Retry the sector with the gear you had when you entered.'; $('#endLoot').innerHTML = '';
    $('#endBtn').textContent = 'Retry sector ↻';
    $('#endBtn').onclick = () => { Object.assign(P, JSON.parse(JSON.stringify(run.snap))); P.vx = P.vy = 0; P.invuln = 0; P.dashCd = 0; enterLevel(L.idx); };
    $('#endMenuBtn').onclick = toMenu;
    setTimeout(() => { if (mode === 'dead') showOnly('#endScreen'); }, 1100);
  }
  function toMenu() { mode = 'menu'; L = null; stopLoops(); exitLock(); $('#screen').classList.remove('playing'); showOnly('#startScreen'); updateBest(); }
  function togglePause() {
    if (mode === 'play') { mode = 'pause'; stopLoops(); exitLock(); $('#screen').classList.remove('playing'); $('#pauseInfo').textContent = `Sector ${L.idx + 1} · ${P.kills}/${L.totalEnemies} kills · ${run.score} points`; showOnly('#pauseScreen'); }
    else if (mode === 'pause') { mode = 'play'; hideAll(); $('#screen').classList.add('playing'); requestLock(); last = performance.now(); }
  }
  const OVERLAYS = ['#startScreen', '#introScreen', '#pauseScreen', '#endScreen'];
  function showOnly(id) { for (const o of OVERLAYS) $(o).hidden = o !== id; }
  function hideAll() { for (const o of OVERLAYS) $(o).hidden = true; }
  function requestLock() { try { const r = canvas.requestPointerLock?.(); if (r && r.catch) r.catch(() => {}); } catch { /* no pointer lock */ } }
  function exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }
  function updateBest() { const b = load('zona-mejor', 0); $('#bestNote').textContent = b ? `Best progress: sector ${b} cleared` : ''; }

  /* ---------------- Menu: options ---------------- */
  function buildOptions() {
    $('#diffPick').innerHTML = Object.entries(DIFFS).map(([k, d]) => `<button class="chip" type="button" data-diff="${k}" aria-pressed="${settings.diff === k}">${d.name}<small>${d.note}</small></button>`).join('');
    $('#qualityPick').innerHTML = Object.keys(QUALITY).map(k => `<button class="chip" type="button" data-q="${k}" aria-pressed="${settings.quality === k}">${QNAMES[k]}<small>${QUALITY[k].join('×')}</small></button>`).join('');
    $('#sens').value = settings.sens; $('#sensOut').textContent = `×${(+settings.sens).toFixed(1)}`;
    $('#musicChip').setAttribute('aria-pressed', String(settings.music)); $('#musicChip').textContent = settings.music ? 'Music on' : 'Music off';
  }
  $('#startScreen').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.diff) settings.diff = b.dataset.diff;
    if (b.dataset.q) { settings.quality = b.dataset.q; setRes(settings.quality); }
    if (b.id === 'musicChip') settings.music = !settings.music;
    save('zona-ajustes', settings); buildOptions(); ensureAudio(); if (b.id !== 'startBtn') sfx('ui');
  });
  $('#sens').addEventListener('input', e => { settings.sens = +e.target.value; $('#sensOut').textContent = `×${settings.sens.toFixed(1)}`; save('zona-ajustes', settings); });
  $('#startBtn').addEventListener('click', () => { ensureAudio(); newRun(); });
  $('#introBtn').addEventListener('click', () => { ensureAudio(); beginLevel(); });
  $('#resumeBtn').addEventListener('click', togglePause);
  $('#menuBtn').addEventListener('click', toMenu);

  /* ---------------- Input ---------------- */
  let lockLostAt = 0;
  document.addEventListener('pointerlockchange', () => {
    const was = locked; locked = document.pointerLockElement === canvas;
    if (was && !locked && mode === 'play') { togglePause(); lockLostAt = performance.now(); }
  });
  document.addEventListener('mousemove', e => {
    if (mode !== 'play') return;
    if (locked) { P.a += e.movementX * .0022 * settings.sens; P.pitch = clamp(P.pitch - e.movementY * .0011 * settings.sens, -.28, .28); }
  });
  canvas.addEventListener('mousedown', e => { if (mode !== 'play') return; if (!locked) requestLock(); if (e.button === 0) mouseDown = true; if (e.button === 2) dash(); });
  window.addEventListener('mouseup', e => { if (e.button === 0) mouseDown = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('wheel', e => { if (mode === 'play') { cycleWeapon(e.deltaY > 0 ? 1 : -1); e.preventDefault(); } }, { passive: false });
  window.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (mode === 'play' && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'KeyN') { settings.music = !settings.music; save('zona-ajustes', settings); buildOptions(); toast(settings.music ? 'MUSIC ON' : 'MUSIC OFF', '', '#9aa3a8', 1.5); }
    if (mode === 'intro' && (e.code === 'Enter' || e.code === 'Space')) { beginLevel(); return; }
    // ESC also releases the mouse: if that release already paused, don't toggle again.
    if ((e.code === 'Escape' && performance.now() - lockLostAt > 300) || e.code === 'KeyP') { if (mode === 'play' || mode === 'pause') togglePause(); return; }
    if (e.code === 'Escape') return;
    if (mode !== 'play') return;
    if (e.code === 'KeyR') startReload();
    if (e.code === 'KeyQ') dash();
    if (e.code === 'Tab') cycleWeapon(1);
    const n = +e.key; if (n >= 1 && n <= 6) selectWeapon(ORDER[n - 1]);
  });
  window.addEventListener('keyup', e => { keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseDown = false; if (mode === 'play') togglePause(); });

  let gpad = null;
  const padHeld = i => Boolean(gpad && gpad.buttons[i]?.pressed);
  function pollPad() {
    pad = { mx: 0, my: 0, lx: 0, ly: 0, fire: false };
    if (!navigator.getGamepads) return;
    gpad = Array.from(navigator.getGamepads()).find(Boolean);
    if (!gpad) { padPrev = []; return; }
    const just = i => padHeld(i) && !padPrev[i], dz = v => Math.abs(v) < .18 ? 0 : v;
    pad.mx = dz(gpad.axes[0] || 0) + (padHeld(15) ? 1 : 0) - (padHeld(14) ? 1 : 0);
    pad.my = dz(gpad.axes[1] || 0) + (padHeld(13) ? 1 : 0) - (padHeld(12) ? 1 : 0);
    pad.lx = dz(gpad.axes[2] || 0); pad.ly = -dz(gpad.axes[3] || 0);
    pad.fire = (gpad.buttons[7]?.value || 0) > .3;
    if (mode === 'play') { if (just(0)) dash(); if (just(2)) startReload(); if (just(3) || just(5)) cycleWeapon(1); if (just(4)) cycleWeapon(-1); if (just(9)) togglePause(); }
    else if (mode === 'pause') { if (just(9) || just(0)) togglePause(); else if (just(1)) toMenu(); }
    else if (mode === 'intro' && (just(0) || just(9))) beginLevel();
    else if (mode === 'menu' && (just(0) || just(9))) { ensureAudio(); newRun(); }
    else if ((mode === 'end' || mode === 'dead') && !$('#endScreen').hidden && (just(0) || just(9))) $('#endBtn').click();
    padPrev = gpad.buttons.map(b => Boolean(b?.pressed));
  }

  /* =====================================================================
     AUDIO: sound effects and original "futuristic industrial metal" music
     ===================================================================== */
  let A = null;
  function ensureAudio() {
    const Ctor = window.AudioContext || window.webkitAudioContext; if (!Ctor) return;
    if (!A) {
      const ac = new Ctor();
      const master = ac.createGain(); master.gain.value = .7;
      const comp = ac.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 5; master.connect(comp); comp.connect(ac.destination);
      const music = ac.createGain(); music.gain.value = settings.music ? .42 : 0; music.connect(master);
      const fx = ac.createGain(); fx.gain.value = .8; fx.connect(master);
      // "Guitar" distortion
      const dist = ac.createWaveShaper(), curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 24) * .9; }
      dist.curve = curve; dist.oversample = '4x';
      const cab = ac.createBiquadFilter(); cab.type = 'lowpass'; cab.frequency.value = 3200; cab.Q.value = .8;
      const mid = ac.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 800; mid.gain.value = -5;
      const gtr = ac.createGain(); gtr.gain.value = .32;
      dist.connect(cab); cab.connect(mid); mid.connect(gtr); gtr.connect(music);
      const delay = ac.createDelay(1); delay.delayTime.value = .3; const fb = ac.createGain(); fb.gain.value = .3; const wet = ac.createGain(); wet.gain.value = .3;
      delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(music);
      const nb = ac.createBuffer(1, ac.sampleRate, ac.sampleRate), nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      A = { ac, master, music, fx, dist, delay, noise: nb, next: 0, step: 0, section: 'amb', loops: {} };
      setInterval(scheduleMusic, 25);
    }
    A.ac.resume().catch(() => {});
  }
  const hz = n => 440 * Math.pow(2, (n - 69) / 12);
  function tone(type, f, at, dur, vol, dest, o = {}) {
    const ac = A.ac, osc = ac.createOscillator(), g = ac.createGain();
    osc.type = type; osc.frequency.setValueAtTime(f, at); if (o.detune) osc.detune.value = o.detune;
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f * o.slide), at + dur);
    g.gain.setValueAtTime(.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + (o.attack || .004)); g.gain.exponentialRampToValueAtTime(.0001, at + dur);
    let node = osc; if (o.lp) { const fl = ac.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = o.lp; osc.connect(fl); node = fl; }
    node.connect(g); g.connect(dest); osc.start(at); osc.stop(at + dur + .05);
    return g;
  }
  function nz(at, dur, vol, f, type, dest, q = 1) {
    const ac = A.ac, s = ac.createBufferSource(), fl = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = A.noise; fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(.0001, at + dur);
    s.connect(fl); fl.connect(g); g.connect(dest); s.start(at, Math.random() * .5); s.stop(at + dur + .05);
  }
  // Simple positional audio for enemies
  function spatial(src) {
    if (!src || !P) return A.fx;
    const d = Math.hypot(src.x - P.x, src.y - P.y), rel = angDiff(P.a, Math.atan2(src.y - P.y, src.x - P.x));
    const g = A.ac.createGain(); g.gain.value = 1 / (1 + d * .28);
    const pan = A.ac.createStereoPanner ? A.ac.createStereoPanner() : null;
    if (pan) { pan.pan.value = clamp(Math.sin(rel), -1, 1) * .8; g.connect(pan); pan.connect(A.fx); } else g.connect(A.fx);
    setTimeout(() => { try { g.disconnect(); pan && pan.disconnect(); } catch { /* already disconnected */ } }, 3000);
    return g;
  }
  function sfx(name, src) {
    if (!A) return;
    const t = A.ac.currentTime, fx = A.fx;
    switch (name) {
      case 'blaster': tone('sawtooth', 1200, t, .12, .09, fx, { slide: .25, lp: 4000 }); tone('square', 600, t, .08, .05, fx, { slide: .3 }); break;
      case 'shotgun': nz(t, .35, .9, 1600, 'lowpass', fx); tone('sine', 110, t, .3, .6, fx, { slide: .35 }); nz(t + .02, .5, .25, 500, 'lowpass', fx); break;
      case 'pump': nz(t, .05, .3, 3000, 'highpass', fx); nz(t + .12, .05, .35, 2500, 'highpass', fx); break;
      case 'minigun': nz(t, .07, .35, 2200, 'bandpass', fx, .8); tone('square', 140, t, .06, .12, fx, { slide: .5 }); break;
      case 'rail': nz(t, .25, .7, 5000, 'highpass', fx); tone('sawtooth', 1800, t, .5, .2, fx, { slide: .1 }); tone('sine', 90, t, .6, .5, fx, { slide: .4 }); break;
      case 'rocket': nz(t, .6, .35, 900, 'bandpass', fx, 2); tone('sawtooth', 180, t, .4, .15, fx, { slide: .4, lp: 800 }); break;
      case 'explosion': { const d = spatial(src); nz(t, 1, 1, 700, 'lowpass', d); tone('sine', 70, t, .9, .9, d, { slide: .4 }); break; }
      case 'empty': tone('square', 1800, t, .03, .08, fx); break;
      case 'overheat': nz(t, .6, .3, 4000, 'highpass', fx); tone('sawtooth', 300, t, .5, .1, fx, { slide: .5 }); break;
      case 'reloadOut': nz(t, .05, .4, 2500, 'highpass', fx); tone('triangle', 400, t + .04, .08, .12, fx); break;
      case 'reloadIn': nz(t, .05, .45, 2000, 'highpass', fx); tone('triangle', 600, t, .06, .15, fx); nz(t + .1, .04, .3, 3000, 'highpass', fx); break;
      case 'shellIn': nz(t, .05, .3, 2400, 'highpass', fx); tone('triangle', 900, t, .04, .08, fx); break;
      case 'switch': nz(t, .06, .2, 3000, 'highpass', fx); tone('triangle', 500, t, .08, .08, fx, { slide: 1.5 }); break;
      case 'dash': nz(t, .25, .3, 1200, 'bandpass', fx, 1.5); break;
      case 'step': nz(t, .08, .08, 300, 'lowpass', fx); break;
      case 'hit': tone('square', 700, t, .04, .05, fx); break;
      case 'crit': tone('square', 1400, t, .08, .1, fx); tone('square', 2100, t + .04, .08, .07, fx); break;
      case 'hurt': tone('sawtooth', 160, t, .25, .3, fx, { slide: .6, lp: 900 }); nz(t, .2, .3, 800, 'lowpass', fx); break;
      case 'armorHit': tone('triangle', 1400, t, .2, .2, fx, { slide: .7 }); nz(t, .15, .25, 4000, 'highpass', fx); break;
      case 'alert': { const d = spatial(src); tone('sawtooth', 220, t, .4, .25, d, { slide: .5, lp: 1200 }); break; }
      case 'windup': { const d = spatial(src); tone('sine', 300, t, .4, .2, d, { slide: 2.2 }); break; }
      case 'eOrb': { const d = spatial(src); tone('sine', 500, t, .25, .25, d, { slide: .4 }); break; }
      case 'eBolt': { const d = spatial(src); tone('square', 900, t, .1, .14, d, { slide: .5 }); nz(t, .06, .2, 3000, 'highpass', d); break; }
      case 'melee': { const d = spatial(src); nz(t, .15, .5, 1200, 'lowpass', d); break; }
      case 'roar': { const d = spatial(src); tone('sawtooth', 90, t, .8, .4, d, { slide: .6, lp: 700 }); nz(t, .6, .2, 500, 'lowpass', d); break; }
      case 'beep': { const d = spatial(src); for (let i = 0; i < 5; i++) tone('sine', 1300, t + i * .12, .06, .3, d); break; }
      case 'summon': { const d = spatial(src); tone('sine', 200, t, .8, .3, d, { slide: 3 }); break; }
      case 'blink': tone('sine', 1600, t, .3, .2, fx, { slide: .2 }); break;
      case 'clank': tone('triangle', 300, t, .3, .3, fx, { slide: .5 }); nz(t, .2, .3, 2000, 'bandpass', fx); break;
      case 'stomp': nz(t, .7, .8, 300, 'lowpass', fx); tone('sine', 50, t, .8, .9, fx, { slide: .6 }); break;
      case 'die': { const d = spatial(src); tone('sawtooth', 300, t, .5, .2, d, { slide: .2, lp: 1500 }); nz(t, .4, .3, 1200, 'lowpass', d); break; }
      case 'bossRoar': tone('sawtooth', 70, t, 1.6, .5, fx, { slide: .7, lp: 900 }); tone('sawtooth', 73, t, 1.6, .4, fx, { slide: .7, lp: 900 }); nz(t, 1.2, .3, 400, 'lowpass', fx); break;
      case 'bossDie': nz(t, 2.5, 1, 600, 'lowpass', fx); tone('sine', 50, t, 2.5, 1, fx, { slide: .5 }); break;
      case 'ammo': nz(t, .05, .3, 3000, 'highpass', fx); tone('triangle', 700, t + .03, .06, .1, fx); break;
      case 'health': [660, 880].forEach((f, i) => tone('triangle', f, t + i * .07, .15, .15, fx)); break;
      case 'armor': tone('triangle', 900, t, .25, .2, fx, { slide: 1.3 }); break;
      case 'key': [880, 1175, 1568].forEach((f, i) => tone('triangle', f, t + i * .08, .2, .15, fx)); break;
      case 'weapon': [392, 523, 659, 784].forEach((f, i) => tone('square', f, t + i * .07, .2, .08, fx)); break;
      case 'module': [523, 784].forEach((f, i) => tone('triangle', f, t + i * .06, .2, .14, fx)); break;
      case 'rare': [523, 659, 784, 1046, 1318].forEach((f, i) => { tone('triangle', f, t + i * .07, .35, .14, fx); tone('sine', f * 2, t + i * .07, .3, .05, A.delay); }); break;
      case 'chest': nz(t, .3, .3, 1500, 'bandpass', fx); [392, 523, 659].forEach((f, i) => tone('triangle', f, t + .2 + i * .08, .3, .14, fx)); break;
      case 'door': tone('sawtooth', 80, t, 1, .3, fx, { slide: 1.6, lp: 500 }); nz(t, .9, .2, 1500, 'bandpass', fx); break;
      case 'deny': tone('square', 200, t, .15, .12, fx); tone('square', 160, t + .16, .2, .12, fx); break;
      case 'fanfare': [294, 370, 440, 587].forEach((f, i) => { tone('sawtooth', f, t + i * .12, .5, .1, fx, { lp: 2400 }); }); break;
      case 'death': tone('sawtooth', 200, t, 1.6, .3, fx, { slide: .25, lp: 1000 }); nz(t, 1.4, .3, 600, 'lowpass', fx); break;
      case 'ui': tone('sine', 880, t, .06, .05, fx); break;
    }
  }
  // Continuous loops: minigun spin, railgun charge and tesla hum
  function loopNode(id, type, f, vol, lp) {
    if (!A) return null;
    let n = A.loops[id];
    if (!n) {
      const o = A.ac.createOscillator(), g = A.ac.createGain(), fl = A.ac.createBiquadFilter();
      o.type = type; o.frequency.value = f; fl.type = 'lowpass'; fl.frequency.value = lp; g.gain.value = 0;
      o.connect(fl); fl.connect(g); g.connect(A.fx); o.start();
      n = A.loops[id] = { o, g };
    }
    return n;
  }
  function spinLoop(k) { const n = loopNode('spin', 'sawtooth', 60, 0, 900); if (!n) return; n.o.frequency.setTargetAtTime(40 + k * 220, A.ac.currentTime, .05); n.g.gain.setTargetAtTime(k > .02 ? .05 + k * .05 : 0, A.ac.currentTime, .05); }
  function chargeLoop(k) { const n = loopNode('charge', 'sine', 200, 0, 4000); if (!n) return; n.o.frequency.setTargetAtTime(200 + k * 1400, A.ac.currentTime, .03); n.g.gain.setTargetAtTime(k > .02 ? .06 + k * .08 : 0, A.ac.currentTime, .03); }
  function teslaLoop(on) { const n = loopNode('tesla', 'sawtooth', 110, 0, 2500); if (!n) return; n.o.frequency.setTargetAtTime(on ? 110 + Math.random() * 40 : 110, A.ac.currentTime, .02); n.g.gain.setTargetAtTime(on ? .08 : 0, A.ac.currentTime, .03); if (on && Math.random() < .3) nz(A.ac.currentTime, .05, .2, 5000, 'highpass', A.fx); }
  function stopLoops() { if (!A) return; for (const k in A.loops) A.loops[k].g.gain.setTargetAtTime(0, A.ac.currentTime, .03); }

  /* ---------------- Music ----------------
     Original riffs in low D (drop D tuning), double kick drum and synths.
     Three sections: exploration (dark ambience), combat and boss. */
  const R = null;
  const RIFF_COMBAT = [
    [0, 0, R, 0, 0, R, [3], R, 0, 0, R, 0, [6], R, [5], R],
    [0, 0, R, 0, 0, R, [8], R, 0, 0, R, 0, [7], R, [6], [5]],
    [0, R, 0, 0, [10], R, R, R, 0, R, 0, 0, [12], R, [11], R],
    [[3], R, R, R, [1], R, R, R, 0, 0, 0, 0, 0, 0, 0, 0]
  ];
  const RIFF_BOSS = [
    [0, 0, 0, 1, 0, 0, 0, [6], 0, 0, 0, 1, 0, 0, [5], R],
    [0, 0, 0, 1, 0, 0, 0, [8], 0, 0, [7], R, [6], R, [5], R],
    [[0], R, R, R, [-1], R, R, R, [-2], R, R, R, [-3], R, [1], R],
    [0, 1, 0, 1, 0, 3, 0, 3, 0, 5, 0, 5, [6], R, [7], R]
  ];
  function musicSection() {
    if (mode !== 'play' && mode !== 'pause') return 'amb';
    if (enemies.some(e => e.boss && e.alert && !e.dead)) return 'boss';
    const fight = enemies.some(e => e.alert && !e.dead && Math.hypot(e.x - P.x, e.y - P.y) < 14) || (run && time - (run.lastHurt || -99) < 4);
    return fight ? 'combat' : 'amb';
  }
  function scheduleMusic() {
    if (!A) return;
    A.music.gain.setTargetAtTime(settings.music && (mode === 'play' || mode === 'menu' || mode === 'intro') ? .42 : 0, A.ac.currentTime, .3);
    if (!settings.music || !(mode === 'play' || mode === 'menu' || mode === 'intro')) { A.next = 0; return; }
    const ac = A.ac;
    if (A.next < ac.currentTime) A.next = ac.currentTime + .05;
    while (A.next < ac.currentTime + .15) {
      const st = A.step, s = st % 16, bar = Math.floor(st / 16) % 4;
      if (s === 0) A.section = musicSection();
      const sec = A.section, bpm = sec === 'boss' ? 168 : sec === 'combat' ? 150 : 120, step16 = 60 / bpm / 4, at = A.next, mus = A.music;
      const root = 38; // low D
      if (sec === 'amb') {
        if (s === 0 && bar % 2 === 0) for (const n of [50, 53, 57]) for (const dt of [-10, 10]) tone('sawtooth', hz(n), at, step16 * 32, .016, mus, { attack: 1.2, detune: dt, lp: 700 });
        if (s === 0) tone('sine', hz(26), at, step16 * 16, .12, mus, { attack: .5 });
        if (s % 8 === 0) tone('sine', 55, at, .25, .3, mus, { slide: .5 });
        if (s % 4 === 2 && Math.random() < .5) tone('square', hz(pick([62, 65, 69, 74, 75])), at, .18, .02, A.delay);
      } else {
        const riff = sec === 'boss' ? RIFF_BOSS : RIFF_COMBAT, note = riff[bar][s];
        if (note !== R) {
          const chord = Array.isArray(note), n = root + (chord ? note[0] : note);
          let len = 1; if (chord) { while (s + len < 16 && riff[bar][s + len] === R) len++; }
          const dur = chord ? step16 * len : step16 * .55;
          const notes = chord ? [n, n + 7, n + 12] : [n, n + 12];
          for (const m of notes) for (const dt of [-12, 12]) tone('sawtooth', hz(m), at, dur, chord ? .09 : .11, A.dist, { lp: chord ? 6000 : 1100, detune: dt, attack: .003 });
          tone('sawtooth', hz(n - 12), at, dur, .12, mus, { lp: 400 });
        }
        // Drums
        const dbl = sec === 'boss' || (sec === 'combat' && bar >= 2);
        if (s % 4 === 0 || (dbl && s % 2 === 0) || (sec === 'boss' && s % 1 === 0 && bar === 1)) { tone('sine', 150, at, .16, .55, mus, { slide: .3 }); nz(at, .02, .15, 3000, 'highpass', mus); }
        if (s === 4 || s === 12) { nz(at, .18, .5, 1800, 'bandpass', mus, .8); tone('triangle', 200, at, .1, .2, mus, { slide: .6 }); }
        if (s % 2 === 1) nz(at, .03, .08, 8000, 'highpass', mus);
        if (s === 0 && bar === 0) nz(at, 1.2, .2, 6000, 'highpass', mus);
        if (bar === 3 && s >= 12) tone('sine', 220 - (s - 12) * 30, at, .15, .3, mus, { slide: .5 });
        // Futuristic synth
        if (bar >= 2 || sec === 'boss') { const arp = [0, 3, 7, 10, 12, 10, 7, 3][s % 8]; tone('square', hz(root + 24 + arp + (sec === 'boss' ? 1 : 0)), at, step16 * .7, .018, A.delay); }
        if (s === 0 && sec === 'boss') for (const m of [50, 53, 56]) tone('sawtooth', hz(m + 12), at, step16 * 16, .02, mus, { attack: .3, lp: 1500, detune: 8 });
      }
      A.next += step16; A.step++;
    }
  }

  /* ---------------- Start-up ---------------- */
  // Weapon icons for when they appear on the floor
  for (const w of ORDER) WEAPON_ICON[w] = spriteFrom(64, g => {
    const c = WEAPONS[w].color;
    glowDot(g, 32, 34, 28, c);
    g.fillStyle = '#1a1d22'; g.beginPath(); g.roundRect(10, 26, 44, 14, 4); g.fill();
    g.fillStyle = c; g.fillRect(14, 30, 30, 3); g.fillStyle = '#3a4048'; g.fillRect(16, 38, 8, 12);
  });
  buildOptions(); updateBest();
  window.addEventListener('pointerdown', () => ensureAudio(), { once: true });
  requestAnimationFrame(frame);
})();
