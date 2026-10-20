(() => {
  'use strict';
  // Neon Rush: an OutRun-style pseudo-3D racer (road built from projected segments)
  // with a customisation garage. Logic runs at 1280×720; the canvas matches the physical resolution.
  const W = 1280, H = 720, TAU = Math.PI * 2;
  const $ = s => document.querySelector(s);
  const canvas = $('#c'), ctx = canvas.getContext('2d');
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const easeIn = (a, b, p) => a + (b - a) * p * p;
  const easeInOut = (a, b, p) => a + (b - a) * (-Math.cos(p * Math.PI) / 2 + .5);
  const hex = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const mix = (a, b, t) => { const A = hex(a), B = hex(b); return `rgb(${A.map((v, i) => Math.round(lerp(v, B[i], t))).join(',')})`; };
  const shade = (c, k) => { const A = hex(c); return `rgb(${A.map(v => Math.round(clamp(k > 0 ? v + (255 - v) * k : v * (1 + k), 0, 255))).join(',')})`; };
  const rgba = (c, a) => { const A = hex(c); return `rgba(${A[0]},${A[1]},${A[2]},${a})`; };

  // ---------- Resolution ----------
  let scale = 1;
  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(640, Math.round(r.width * dpr)), h = Math.round(w * H / W);
    if (canvas.width !== w) { canvas.width = w; canvas.height = h; }
    scale = canvas.width / W;
  }
  window.addEventListener('resize', resize);

  // ---------- Road constants ----------
  const SEG = 200;            // length of one segment
  const RUMBLE = 3;           // segments per rumble-strip band
  const ROAD = 2000;          // half the road width
  const LANES = 3;
  const CAM_H = 1000;
  const FOV = 100;
  const DEPTH = 1 / Math.tan((FOV / 2) * Math.PI / 180);
  const DRAW = 280;           // visible segments
  const PLAYER_Z = CAM_H * DEPTH;
  const FOG = 5;
  const CAR_W = 560;          // car width in world units
  const BASE_MAX = SEG * 60;  // stock top speed (≈ 260 km/h, ≈ 163 mph)
  const ZONE_LEN = 2300;      // segments per stage

  // ---------- Garage: data ----------
  const PAINTS = [
    ['#e8394d', 'Racing red'], ['#ff8a3d', 'Orange'], ['#ffd23f', 'Yellow'], ['#3ddc97', 'Mint green'],
    ['#2fa7ff', 'Electric blue'], ['#6c5ce7', 'Violet'], ['#f4f4f6', 'Pearl white'], ['#2b2d38', 'Graphite'],
  ];
  const FINISHES = { gloss: 'Gloss', matte: 'Matte', pearl: 'Pearlescent' };
  const RIMS = { wire: 'Wire', turbine: 'Turbine', fiveSpoke: 'Five-spoke', mesh: 'Mesh' };
  const RIM_COLORS = { silver: '#c9ced8', black: '#2a2c33', gold: '#d9b25a', bronze: '#a8754a' };
  const SPOILERS = { none: 'None', ducktail: 'Ducktail', gt: 'GT wing', high: 'High wing' };
  const KITS = { stock: 'Stock', sport: 'Sport', extreme: 'Extreme' };
  const NEONS = { off: ['Off', null], mint: ['Mint', '#46f0d0'], pink: ['Pink', '#ff4fa3'], violet: ['Violet', '#9b6bff'], amber: ['Amber', '#ffb35a'] };
  const VINYLS = { none: 'None', stripes: 'Twin stripes', racing: 'Racing', twoTone: 'Two-tone' };
  const PERF = [
    { id: 'engine', name: 'Engine', note: 'Higher top speed and quicker acceleration' },
    { id: 'turbo', name: 'Nitro', note: 'Bigger tank and more boost' },
    { id: 'handling', name: 'Suspension', note: 'Sharper steering and less sliding' },
    { id: 'tyres', name: 'Tyres', note: 'More grip in corners and less drag off the tarmac' },
  ];
  const COST = [500, 1100, 2000, 3400];
  const SAVE = 'neon-rush-garaje'; // storage key kept from the original release so existing saves still load
  const defaults = () => ({ paint: '#e8394d', finish: 'gloss', rims: 'fiveSpoke', rimColor: 'silver', spoiler: 'ducktail', kit: 'stock', neon: 'off', vinyl: 'stripes', plate: 'NR-01', perf: { engine: 0, turbo: 0, handling: 0, tyres: 0 }, credits: 800, best: 0, music: true });
  // Saves from the Spanish release used Spanish option keys; map them to the current ones.
  const LEGACY = {
    finish: { brillo: 'gloss', mate: 'matte', perlado: 'pearl' },
    rims: { radios: 'wire', turbina: 'turbine', cinco: 'fiveSpoke', malla: 'mesh' },
    rimColor: { plata: 'silver', negro: 'black', oro: 'gold', bronce: 'bronze' },
    spoiler: { ninguno: 'none', pato: 'ducktail', alta: 'high' },
    kit: { serie: 'stock', extremo: 'extreme' },
    neon: { menta: 'mint', rosa: 'pink', violeta: 'violet', ambar: 'amber' },
    vinyl: { ninguno: 'none', franjas: 'stripes', bitono: 'twoTone' },
  };
  const LEGACY_PERF = { motor: 'engine', manejo: 'handling', gomas: 'tyres' };
  const OPTIONS = { finish: FINISHES, rims: RIMS, rimColor: RIM_COLORS, spoiler: SPOILERS, kit: KITS, neon: NEONS, vinyl: VINYLS };
  function loadCar(raw) {
    const d = defaults(), o = Object.assign(d, raw && typeof raw === 'object' ? raw : {});
    for (const [key, opts] of Object.entries(OPTIONS)) {
      const v = (LEGACY[key] && LEGACY[key][o[key]]) || o[key];
      o[key] = Object.prototype.hasOwnProperty.call(opts, v) ? v : defaults()[key];
    }
    if (!PAINTS.some(([c]) => c === o.paint)) o.paint = defaults().paint;
    if (typeof o.plate !== 'string') o.plate = defaults().plate;
    const perf = defaults().perf, old = o.perf && typeof o.perf === 'object' ? o.perf : {};
    for (const [k, v] of Object.entries(old)) {
      const id = LEGACY_PERF[k] || k;
      if (id in perf) perf[id] = clamp(Math.floor(Number(v)) || 0, 0, COST.length);
    }
    o.perf = perf;
    for (const k of ['credits', 'best']) o[k] = Math.max(0, Number(o[k]) || 0);
    o.music = o.music !== false;
    return o;
  }
  let car = defaults();
  try { car = loadCar(JSON.parse(localStorage.getItem(SAVE) || '{}')); } catch (e) { /* storage unavailable or corrupt */ }
  const save = () => { try { localStorage.setItem(SAVE, JSON.stringify(car)); } catch (e) { /* storage unavailable */ } };

  // ---------- Stage themes ----------
  // sky: top/bottom colours, sun, far/near: mountain ranges, grass/rumble/road: two tones each, lane, fog
  const THEMES = [
    { name: 'Sunset Coast', sky: ['#2c1d5c', '#ff9466'], sun: '#ffd27a', sunY: .62, far: '#7a3f78', near: '#4a2a5a', grass: ['#3f8a6a', '#378061'], rumble: ['#f4f0f6', '#d8394d'], road: ['#5a5568', '#55505f'], lane: '#f4ecdf', fog: '#e88a76', sprites: ['palm', 'palm', 'palm2', 'bush', 'board'], night: 0 },
    { name: 'Golden Desert', sky: ['#3d78c8', '#f6cf98'], sun: '#fff1c8', sunY: .25, far: '#c98d5c', near: '#a8673f', grass: ['#e3b77a', '#d9ab6c'], rumble: ['#f2efe6', '#d57a3a'], road: ['#6b6460', '#655e5a'], lane: '#fff6dc', fog: '#f1d2a4', sprites: ['cactus', 'cactus', 'rock', 'rock', 'board'], night: 0 },
    { name: 'Mountain Pass', sky: ['#4f86c6', '#dbe9f3'], sun: '#ffffff', sunY: .2, far: '#e9f1f8', near: '#5d7d8f', grass: ['#4f8a4c', '#477f44'], rumble: ['#f5f5f5', '#3a6fd8'], road: ['#5c6068', '#575a62'], lane: '#ffffff', fog: '#c9dbe7', sprites: ['pine', 'pine', 'pine', 'pineSnow', 'rock'], night: 0, peaks: true },
    { name: 'Midnight City', sky: ['#070a22', '#3a2a66'], sun: '#ffe9c4', sunY: .18, far: '#1a1838', near: '#14122c', grass: ['#24223a', '#201e34'], rumble: ['#cfc9ea', '#6a58c8'], road: ['#2f2d40', '#2b293b'], lane: '#cfc8ff', fog: '#2a2050', sprites: ['tower', 'tower2', 'lamp', 'lamp', 'neon'], night: 1, city: true },
    { name: 'Dawn Motorway', sky: ['#5a6fb8', '#ffc6a0'], sun: '#fff0d6', sunY: .72, far: '#8e7ab8', near: '#6a6a9a', grass: ['#7aa45a', '#709a52'], rumble: ['#f6f2ee', '#ff7a5a'], road: ['#5e5a66', '#59555f'], lane: '#fff3e2', fog: '#f0b8a0', sprites: ['tree', 'tree', 'turbine', 'house', 'board'], night: 0 },
  ];
  // ---------- Scenery sprites (pre-rendered vectors) ----------
  // Sprites are painted at double resolution so they stay crisp up close.
  function mk(w, h, fn, k = 2) { const c = document.createElement('canvas'); c.width = w * k; c.height = h * k; const g = c.getContext('2d'); g.scale(k, k); fn(g, w, h); return c; }
  function palm(g, w, h, lean) {
    g.lineCap = 'round';
    const bx = w / 2, top = [w / 2 + lean * w * .22, h * .2];
    const tg = g.createLinearGradient(bx - 20, 0, bx + 20, 0); tg.addColorStop(0, '#6b4a34'); tg.addColorStop(1, '#3d2a22');
    g.strokeStyle = tg; g.lineWidth = w * .07;
    g.beginPath(); g.moveTo(bx, h); g.quadraticCurveTo(bx + lean * w * .02, h * .55, top[0], top[1]); g.stroke();
    g.strokeStyle = '#2b1d18'; g.lineWidth = 2;
    for (let y = h * .95; y > h * .25; y -= h * .045) { const t = (h - y) / (h * .8), x = lerp(bx, top[0], t * t); g.beginPath(); g.moveTo(x - w * .03, y); g.lineTo(x + w * .03, y - 3); g.stroke(); }
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI / 2 + (i - 4) * .42 + (i % 2) * .1, L = w * (.42 + (i % 3) * .05);
      const ex = top[0] + Math.cos(a) * L, ey = top[1] + Math.sin(a) * L * .55 + L * .32;
      const fg = g.createLinearGradient(top[0], top[1], ex, ey); fg.addColorStop(0, '#2f7a4a'); fg.addColorStop(1, '#1f5638');
      g.fillStyle = fg; g.beginPath(); g.moveTo(top[0], top[1]);
      g.quadraticCurveTo(lerp(top[0], ex, .5) + Math.sin(a) * 18, lerp(top[1], ey, .5) - 30, ex, ey);
      g.quadraticCurveTo(lerp(top[0], ex, .5) - Math.sin(a) * 12, lerp(top[1], ey, .5) - 8, top[0], top[1] + 8); g.fill();
    }
    g.fillStyle = '#4a3226'; g.beginPath(); g.arc(top[0] - 6, top[1] + 10, 9, 0, TAU); g.arc(top[0] + 8, top[1] + 12, 8, 0, TAU); g.fill();
  }
  function pine(g, w, h, snow) {
    g.fillStyle = '#4a3428'; g.fillRect(w * .46, h * .82, w * .08, h * .18);
    for (let i = 0; i < 4; i++) {
      const y0 = h * (.05 + i * .2), y1 = h * (.38 + i * .16), hw = w * (.2 + i * .1);
      const gr = g.createLinearGradient(w / 2 - hw, 0, w / 2 + hw, 0); gr.addColorStop(0, '#2f6b43'); gr.addColorStop(1, '#1b4430');
      g.fillStyle = gr; g.beginPath(); g.moveTo(w / 2, y0); g.lineTo(w / 2 + hw, y1); g.lineTo(w / 2 - hw, y1); g.fill();
      if (snow) { g.fillStyle = '#f2f7fb'; g.beginPath(); g.moveTo(w / 2, y0); g.lineTo(w / 2 + hw * .45, lerp(y0, y1, .45)); g.lineTo(w / 2, lerp(y0, y1, .36)); g.lineTo(w / 2 - hw * .45, lerp(y0, y1, .45)); g.fill(); }
    }
  }
  function tree(g, w, h) {
    g.fillStyle = '#5a3d2c'; g.fillRect(w * .45, h * .55, w * .1, h * .45);
    const blobs = [[.5, .3, .3], [.3, .42, .22], [.7, .42, .22], [.5, .5, .25]];
    for (const [x, y, r] of blobs) { const gr = g.createRadialGradient(w * x - w * r * .3, h * y - w * r * .4, 2, w * x, h * y, w * r); gr.addColorStop(0, '#7fbf5a'); gr.addColorStop(1, '#3f7a3a'); g.fillStyle = gr; g.beginPath(); g.arc(w * x, h * y, w * r, 0, TAU); g.fill(); }
  }
  function board(g, w, h, txt, sub, c1, c2) {
    g.fillStyle = '#3a3440'; g.fillRect(w * .2, h * .55, w * .05, h * .45); g.fillRect(w * .75, h * .55, w * .05, h * .45);
    g.fillStyle = '#2a2530'; g.beginPath(); g.roundRect(0, 0, w, h * .6, 10); g.fill();
    const gr = g.createLinearGradient(0, 0, w, h * .6); gr.addColorStop(0, c1); gr.addColorStop(1, c2);
    g.fillStyle = gr; g.beginPath(); g.roundRect(8, 8, w - 16, h * .6 - 16, 6); g.fill();
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `700 ${h * .2}px 'Bebas Neue', Impact, sans-serif`; g.fillText(txt, w / 2, h * .25);
    g.font = `600 ${h * .07}px 'Rajdhani', sans-serif`; g.fillText(sub, w / 2, h * .44);
  }
  function tower(g, w, h, hue) {
    const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, `hsl(${hue},30%,16%)`); gr.addColorStop(1, `hsl(${hue},35%,9%)`);
    g.fillStyle = gr; g.fillRect(0, h * .06, w, h); g.fillRect(w * .3, 0, w * .4, h * .1);
    for (let y = h * .1; y < h - 20; y += 26) for (let x = 12; x < w - 18; x += 22) {
      if (Math.random() < .45) continue;
      g.fillStyle = Math.random() < .2 ? '#7fe8ff' : '#ffd99a'; g.globalAlpha = rand(.45, .95); g.fillRect(x, y, 12, 14);
    }
    g.globalAlpha = 1; g.fillStyle = '#ff4f6a'; g.beginPath(); g.arc(w / 2, 4, 4, 0, TAU); g.fill();
  }
  function lamp(g, w, h) {
    const glow = g.createRadialGradient(w * .78, h * .1, 2, w * .78, h * .1, w * .26); glow.addColorStop(0, 'rgba(255,230,170,.95)'); glow.addColorStop(1, 'rgba(255,200,120,0)');
    g.fillStyle = glow; g.fillRect(0, 0, w, h * .3);
    g.strokeStyle = '#4a4a5a'; g.lineWidth = w * .05; g.lineCap = 'round';
    g.beginPath(); g.moveTo(w * .3, h); g.lineTo(w * .3, h * .1); g.quadraticCurveTo(w * .3, h * .05, w * .7, h * .07); g.stroke();
    g.fillStyle = '#fff4d6'; g.beginPath(); g.ellipse(w * .76, h * .09, w * .09, w * .03, 0, 0, TAU); g.fill();
  }
  function neonSign(g, w, h) {
    g.fillStyle = '#3a3448'; g.fillRect(w * .47, h * .5, w * .06, h * .5);
    g.fillStyle = '#120d22'; g.beginPath(); g.roundRect(4, 4, w - 8, h * .5, 14); g.fill();
    g.strokeStyle = '#ff4fa3'; g.lineWidth = 5; g.shadowColor = '#ff4fa3'; g.shadowBlur = 18; g.beginPath(); g.roundRect(14, 14, w - 28, h * .5 - 20, 10); g.stroke();
    g.shadowColor = '#46f0d0'; g.fillStyle = '#bffcf0'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 ${h * .2}px 'Bebas Neue', Impact, sans-serif`;
    g.fillText(pick(['MOTEL', 'DINER 24H', 'NEON BAR', 'GARAGE']), w / 2, h * .27); g.shadowBlur = 0;
  }
  function cactus(g, w, h) {
    const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#5f9a52'); gr.addColorStop(1, '#3d6e3a'); g.fillStyle = gr;
    g.beginPath(); g.roundRect(w * .4, h * .05, w * .2, h * .95, w * .1); g.fill();
    g.beginPath(); g.roundRect(w * .1, h * .3, w * .16, h * .35, w * .08); g.fill(); g.fillRect(w * .1, h * .55, w * .35, w * .14);
    g.beginPath(); g.roundRect(w * .74, h * .2, w * .16, h * .3, w * .08); g.fill(); g.fillRect(w * .55, h * .42, w * .35, w * .14);
  }
  function rock(g, w, h, c) {
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, shade(c, .25)); gr.addColorStop(1, shade(c, -.35)); g.fillStyle = gr;
    g.beginPath(); g.moveTo(0, h); g.lineTo(w * .08, h * .45); g.lineTo(w * .35, h * .1); g.lineTo(w * .62, h * .2); g.lineTo(w * .9, h * .5); g.lineTo(w, h); g.fill();
  }
  function turbine(g, w, h) {
    g.fillStyle = '#eef0f4'; g.beginPath(); g.moveTo(w * .48, h * .2); g.lineTo(w * .52, h * .2); g.lineTo(w * .54, h); g.lineTo(w * .46, h); g.fill();
    const a0 = Math.random() * TAU; g.fillStyle = '#f7f8fb';
    for (let i = 0; i < 3; i++) { const a = a0 + i * TAU / 3; g.save(); g.translate(w / 2, h * .2); g.rotate(a); g.beginPath(); g.moveTo(-6, 0); g.lineTo(0, -w * .46); g.lineTo(8, 0); g.fill(); g.restore(); }
    g.fillStyle = '#d4d8e0'; g.beginPath(); g.arc(w / 2, h * .2, 8, 0, TAU); g.fill();
  }
  function house(g, w, h) {
    g.fillStyle = '#f1e2cf'; g.fillRect(w * .1, h * .45, w * .8, h * .55);
    g.fillStyle = '#b8513c'; g.beginPath(); g.moveTo(0, h * .48); g.lineTo(w / 2, h * .08); g.lineTo(w, h * .48); g.fill();
    g.fillStyle = '#6a8fb3'; g.fillRect(w * .2, h * .58, w * .18, h * .16); g.fillRect(w * .62, h * .58, w * .18, h * .16);
    g.fillStyle = '#6b4a34'; g.fillRect(w * .43, h * .66, w * .14, h * .34);
  }
  function bush(g, w, h) {
    for (const [x, y, r] of [[.3, .65, .3], [.62, .6, .32], [.5, .45, .28]]) { g.fillStyle = mix('#4f9a5e', '#2f6a42', y); g.beginPath(); g.arc(w * x, h * y, w * r, 0, TAU); g.fill(); }
  }
  function gate(g, w, h, label) {
    // Checkpoint gantry: two pillars and a banner; the centre is left transparent.
    const col = w * .045;
    for (const x of [0, w - col]) { const gr = g.createLinearGradient(x, 0, x + col, 0); gr.addColorStop(0, '#e9e6ef'); gr.addColorStop(1, '#a7a2b4'); g.fillStyle = gr; g.fillRect(x, h * .08, col, h * .92); }
    const bg = g.createLinearGradient(0, 0, 0, h * .2); bg.addColorStop(0, '#ff6f7d'); bg.addColorStop(1, '#c23a5a');
    g.fillStyle = bg; g.beginPath(); g.roundRect(0, 0, w, h * .2, 8); g.fill();
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 ${h * .14}px 'Bebas Neue', Impact, sans-serif`; g.fillText(label, w / 2, h * .105);
    g.fillStyle = 'rgba(255,255,255,.85)'; for (let x = 0; x < w; x += 40) g.fillRect(x, h * .2 - 6, 20, 6);
  }
  let SPR = {};
  function buildSprites() {
    const s = (img, w, solid = true) => ({ img, w, solid });
    SPR = {
      palm: s(mk(300, 420, (g, w, h) => palm(g, w, h, .6)), 1300),
      palm2: s(mk(300, 440, (g, w, h) => palm(g, w, h, -.5)), 1300),
      bush: s(mk(200, 120, bush), 700, false),
      cactus: s(mk(160, 240, cactus), 600),
      rock: s(mk(260, 160, (g, w, h) => rock(g, w, h, '#a8673f')), 1100),
      pine: s(mk(220, 420, (g, w, h) => pine(g, w, h, false)), 1100),
      pineSnow: s(mk(220, 420, (g, w, h) => pine(g, w, h, true)), 1100),
      tree: s(mk(260, 320, tree), 1300),
      turbine: s(mk(260, 620, turbine), 1800),
      house: s(mk(260, 220, house), 1700),
      lamp: s(mk(200, 520, lamp), 1000),
      tower: s(mk(240, 640, (g, w, h) => tower(g, w, h, 250)), 3200),
      tower2: s(mk(220, 520, (g, w, h) => tower(g, w, h, 210)), 2800),
      neon: s(mk(300, 300, neonSign), 1500),
      board: [
        s(mk(420, 300, (g, w, h) => board(g, w, h, 'NEON RUSH', 'THE ROAD IS YOURS', '#ff6f7d', '#8b4bd8')), 2000),
        s(mk(420, 300, (g, w, h) => board(g, w, h, 'PRIMER IMPULSO', 'PUT YOUR FOOT DOWN', '#173b57', '#f07a5a')), 2000),
        s(mk(420, 300, (g, w, h) => board(g, w, h, 'PETROL', 'NEXT EXIT 1 MILE', '#2fa7ff', '#3ddc97')), 2000),
      ],
      gate: s(mk(900, 520, (g, w, h) => gate(g, w, h, 'CHECKPOINT')), ROAD * 2.5, false),
      start: s(mk(900, 520, (g, w, h) => gate(g, w, h, 'START')), ROAD * 2.5, false),
    };
  }
  // ---------- Car: vector drawing ----------
  function paintGrad(g, o, y0, y1) {
    const p = o.paint, gr = g.createLinearGradient(0, y0, 0, y1);
    if (o.finish === 'matte') { gr.addColorStop(0, shade(p, .12)); gr.addColorStop(.5, p); gr.addColorStop(1, shade(p, -.3)); }
    else if (o.finish === 'pearl') { gr.addColorStop(0, mix(p, '#e6f2ff', .55)); gr.addColorStop(.35, mix(p, '#c7b8ff', .18)); gr.addColorStop(.7, p); gr.addColorStop(1, shade(p, -.45)); }
    else { gr.addColorStop(0, shade(p, .42)); gr.addColorStop(.32, shade(p, .08)); gr.addColorStop(.55, p); gr.addColorStop(1, shade(p, -.5)); }
    return gr;
  }
  const isLight = c => { const [r, g, b] = hex(c); return r * .3 + g * .59 + b * .11 > 150; };
  const stripeColor = o => isLight(o.paint) ? '#1d1d26' : '#f4f2ee';
  function glowAt(g, x, y, rx, ry, color, a) {
    g.save(); g.translate(x, y); g.scale(1, ry / rx);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx); gr.addColorStop(0, rgba(color, a)); gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, rx, 0, TAU); g.fill(); g.restore();
  }

  // Rear view. (cx, by) = centre on the ground; w = width in pixels.
  // st: { steer -1..1, brake, nitro, t, night }
  function drawCarRear(g, cx, by, w, o, st) {
    const u = w / 100, steer = st.steer || 0, ext = o.kit === 'extreme';
    g.save(); g.translate(cx, by); g.scale(u, u);
    g.fillStyle = 'rgba(0,0,0,.42)'; g.beginPath(); g.ellipse(0, -1, 58, 6, 0, 0, TAU); g.fill();
    const neon = NEONS[o.neon] && NEONS[o.neon][1];
    if (neon) glowAt(g, 0, -2, 78, 13, neon, .6);
    // Wheels (shift slightly when steering).
    for (const s of [-1, 1]) {
      const x = s * (ext ? 41 : 39) + steer * 1.5;
      g.fillStyle = '#121218'; g.beginPath(); g.roundRect(x - 9, -21, 18, 21, 4); g.fill();
      g.fillStyle = '#2a2a33'; for (let y = -19; y < -2; y += 4) g.fillRect(x - 7, y, 14, 1.4);
    }
    // Bodywork with body roll.
    g.translate(steer * 2.5, 0); g.transform(1, 0, -steer * .05, 1, 0, 0);
    g.translate(0, -Math.abs(steer) * .6 + Math.sin((st.t || 0) * 30) * .25);
    const body = () => { g.beginPath(); g.moveTo(-48, -13); g.lineTo(-50, -33); g.quadraticCurveTo(-49, -42, -42, -43); g.lineTo(42, -43); g.quadraticCurveTo(49, -42, 50, -33); g.lineTo(48, -13); g.quadraticCurveTo(47, -9, 41, -9); g.lineTo(-41, -9); g.quadraticCurveTo(-47, -9, -48, -13); g.closePath(); };
    const cabin = () => { g.beginPath(); g.moveTo(-41, -42); g.lineTo(-31, -60); g.quadraticCurveTo(-29, -63, -25, -63); g.lineTo(25, -63); g.quadraticCurveTo(29, -63, 31, -60); g.lineTo(41, -42); g.closePath(); };
    if (ext) { g.fillStyle = paintGrad(g, o, -40, -10); for (const s of [-1, 1]) { g.beginPath(); g.ellipse(s * 50, -24, 6, 13, 0, 0, TAU); g.fill(); } }
    g.fillStyle = paintGrad(g, o, -43, -9); body(); g.fill();
    g.fillStyle = paintGrad(g, o, -64, -40); cabin(); g.fill();
    g.fillStyle = 'rgba(0,0,0,.18)'; cabin(); g.fill();
    // Vinyl.
    const sc = stripeColor(o);
    if (o.vinyl !== 'none') {
      for (const part of [body, cabin]) {
        g.save(); part(); g.clip(); g.fillStyle = sc;
        if (o.vinyl === 'stripes') { g.fillRect(-11, -70, 6, 70); g.fillRect(5, -70, 6, 70); }
        else if (o.vinyl === 'racing') { g.fillRect(-8, -70, 16, 70); g.fillStyle = rgba(o.paint, 1); g.fillRect(-1, -70, 2, 70); }
        else if (o.vinyl === 'twoTone') { g.fillStyle = isLight(o.paint) ? '#2b2d38' : '#111117'; g.fillRect(-60, -21, 120, 15); }
        g.restore();
      }
    }
    // Rear window.
    const gl = g.createLinearGradient(0, -58, 0, -44); gl.addColorStop(0, '#0f1320'); gl.addColorStop(1, '#344058');
    g.fillStyle = gl; g.beginPath(); g.moveTo(-35, -44.5); g.lineTo(-27.5, -58.5); g.lineTo(27.5, -58.5); g.lineTo(35, -44.5); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.moveTo(-20, -58); g.lineTo(-8, -58); g.lineTo(-18, -45); g.lineTo(-30, -45); g.fill();
    g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = .8; g.beginPath(); g.moveTo(-42, -42); g.lineTo(42, -42); g.stroke();
    g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(-44, -41.5, 88, .9);
    // Wing mirrors.
    g.fillStyle = paintGrad(g, o, -52, -45); for (const s of [-1, 1]) { g.beginPath(); g.roundRect(s * 45 - 4, -51, 8, 5, 2); g.fill(); }
    // Tail lights.
    const lit = st.brake ? 1 : st.night ? .55 : .25;
    for (const s of [-1, 1]) {
      const lg = g.createLinearGradient(0, -38, 0, -31); lg.addColorStop(0, st.brake ? '#ff8a8a' : '#ff4a55'); lg.addColorStop(1, '#a3121f');
      g.fillStyle = lg; g.beginPath(); g.roundRect(s > 0 ? 22 : -46, -38.5, 24, 6.5, 2.5); g.fill();
      g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(s > 0 ? 25 : -43, -37.5, 18, 1);
      if (lit > .3) glowAt(g, s * 34, -35, 26 * lit + 8, 9, '#ff3344', .5 * lit);
    }
    g.fillStyle = rgba('#ff3344', .35 + lit * .4); g.fillRect(-22, -36, 44, 1.6);
    // Number plate.
    g.fillStyle = '#f3f0e6'; g.beginPath(); g.roundRect(-12, -29, 24, 8, 1.2); g.fill();
    g.strokeStyle = '#2a2a33'; g.lineWidth = .5; g.stroke();
    g.fillStyle = '#1c1c28'; g.font = "600 5.6px 'DM Mono', monospace"; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText((o.plate || '').slice(0, 7), 0, -24.8);
    // Bumper, diffuser and exhausts.
    g.fillStyle = '#18181f'; g.beginPath(); g.roundRect(-45, -15, 90, 6, 2); g.fill();
    if (o.kit !== 'stock') {
      g.fillStyle = '#0d0d12'; g.beginPath(); g.roundRect(ext ? -40 : -30, -12, ext ? 80 : 60, ext ? 6 : 4, 1.5); g.fill();
      g.fillStyle = '#2e2e38'; for (let x = (ext ? -34 : -24); x <= (ext ? 34 : 24); x += (ext ? 8.5 : 12)) g.fillRect(x - .6, -13, 1.2, ext ? 7 : 5);
      if (ext) { g.fillStyle = '#0d0d12'; g.fillRect(-52, -12, 8, 2); g.fillRect(44, -12, 8, 2); }
    }
    const pipes = o.kit === 'extreme' ? [-33, -26, 26, 33] : o.kit === 'sport' ? [-30, 30] : [-30];
    for (const x of pipes) {
      g.fillStyle = '#9aa0ab'; g.beginPath(); g.arc(x, -12, 2.8, 0, TAU); g.fill();
      g.fillStyle = '#121216'; g.beginPath(); g.arc(x, -12, 1.8, 0, TAU); g.fill();
      if (st.nitro) {
        const f = 7 + Math.random() * 5;
        glowAt(g, x, -12, f * 1.5, f, '#ff9a3c', .55); glowAt(g, x, -12, f * .8, f * .55, '#7fd8ff', .95);
      }
    }
    // Spoiler.
    g.fillStyle = paintGrad(g, o, -70, -42);
    if (o.spoiler === 'ducktail') { g.beginPath(); g.moveTo(-40, -43); g.quadraticCurveTo(0, -48.5, 40, -43); g.lineTo(40, -42); g.lineTo(-40, -42); g.fill(); }
    else if (o.spoiler === 'gt' || o.spoiler === 'high') {
      const top = o.spoiler === 'gt' ? -52 : -67;
      g.fillStyle = '#16161c'; g.fillRect(-24, top, 3, -42 - top); g.fillRect(21, top, 3, -42 - top);
      g.fillStyle = paintGrad(g, o, top - 3, top + 3); g.beginPath(); g.roundRect(-48, top - 3, 96, 4, 1.5); g.fill();
      g.fillStyle = '#16161c'; g.fillRect(-49, top - 6, 2.4, 9); g.fillRect(46.6, top - 6, 2.4, 9);
      g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(-46, top - 3, 92, .8);
    }
    g.restore();
  }

  function drawRim(g, x, y, r, style, color, rot) {
    g.save(); g.translate(x, y); g.rotate(rot);
    g.fillStyle = '#b52a2a'; g.beginPath(); g.arc(0, 0, r * .78, -2.4 - rot, -1.2 - rot); g.lineTo(0, 0); g.fill();
    const rg = g.createRadialGradient(-r * .3, -r * .3, 1, 0, 0, r); rg.addColorStop(0, shade(color, .4)); rg.addColorStop(1, shade(color, -.35));
    g.strokeStyle = rg; g.fillStyle = rg; g.lineCap = 'round';
    g.lineWidth = r * .14; g.beginPath(); g.arc(0, 0, r * .92, 0, TAU); g.stroke();
    if (style === 'wire') { g.lineWidth = r * .06; for (let i = 0; i < 16; i++) { const a = i * TAU / 16; g.beginPath(); g.moveTo(Math.cos(a) * r * .2, Math.sin(a) * r * .2); g.lineTo(Math.cos(a + .25) * r * .88, Math.sin(a + .25) * r * .88); g.stroke(); } }
    else if (style === 'turbine') { g.lineWidth = r * .1; for (let i = 0; i < 9; i++) { const a = i * TAU / 9; g.beginPath(); g.moveTo(Math.cos(a) * r * .22, Math.sin(a) * r * .22); g.quadraticCurveTo(Math.cos(a + .5) * r * .6, Math.sin(a + .5) * r * .6, Math.cos(a + .9) * r * .86, Math.sin(a + .9) * r * .86); g.stroke(); } }
    else if (style === 'fiveSpoke') { for (let i = 0; i < 5; i++) { const a = i * TAU / 5; g.beginPath(); g.moveTo(Math.cos(a - .2) * r * .25, Math.sin(a - .2) * r * .25); g.lineTo(Math.cos(a - .13) * r * .88, Math.sin(a - .13) * r * .88); g.lineTo(Math.cos(a + .13) * r * .88, Math.sin(a + .13) * r * .88); g.lineTo(Math.cos(a + .2) * r * .25, Math.sin(a + .2) * r * .25); g.fill(); } }
    else { g.lineWidth = r * .07; for (let i = 0; i < 10; i++) { const a = i * TAU / 10; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * r * .88, Math.sin(a) * r * .88); g.stroke(); g.beginPath(); g.moveTo(Math.cos(a) * r * .55, Math.sin(a) * r * .55); g.lineTo(Math.cos(a + TAU / 10) * r * .55, Math.sin(a + TAU / 10) * r * .55); g.stroke(); } }
    g.fillStyle = shade(color, -.2); g.beginPath(); g.arc(0, 0, r * .24, 0, TAU); g.fill();
    g.fillStyle = '#20222a'; g.beginPath(); g.arc(0, 0, r * .1, 0, TAU); g.fill();
    g.restore();
  }

  // Side view (garage). (cx, by) = centre on the ground; L = length in pixels.
  function drawCarSide(g, cx, by, L, o, rot) {
    const u = L / 200, ext = o.kit === 'extreme';
    g.save(); g.translate(cx, by); g.scale(u, u);
    g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.ellipse(0, 0, 105, 5, 0, 0, TAU); g.fill();
    const neon = NEONS[o.neon] && NEONS[o.neon][1];
    if (neon) glowAt(g, 0, -3, 110, 12, neon, .65);
    const body = () => {
      g.beginPath(); g.moveTo(-97, -12); g.lineTo(-84, -12); g.arc(-62, -17, 21, Math.PI, TAU); g.lineTo(41, -12); g.arc(62, -17, 21, Math.PI, TAU);
      g.lineTo(97, -12); g.lineTo(100, -23); g.quadraticCurveTo(98, -32, 86, -35); g.lineTo(40, -42); g.quadraticCurveTo(20, -58, 4, -60);
      g.lineTo(-34, -59); g.quadraticCurveTo(-50, -55, -64, -42); g.lineTo(-90, -39); g.quadraticCurveTo(-99, -36, -99, -27); g.closePath();
    };
    if (ext) { g.fillStyle = paintGrad(g, o, -40, -10); for (const x of [-62, 62]) { g.beginPath(); g.arc(x, -17, 25, Math.PI, TAU); g.fill(); } }
    g.fillStyle = paintGrad(g, o, -60, -12); body(); g.fill();
    g.save(); body(); g.clip();
    const sc = stripeColor(o);
    if (o.vinyl === 'stripes') { g.fillStyle = sc; g.fillRect(-100, -31, 200, 2.4); g.fillRect(-100, -27, 200, 2.4); }
    else if (o.vinyl === 'racing') { g.fillStyle = sc; g.fillRect(-100, -34, 200, 8); g.beginPath(); g.arc(-8, -24, 9, 0, TAU); g.fill(); g.fillStyle = o.paint; g.font = "700 10px 'Bebas Neue', Impact, sans-serif"; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('27', -8, -23.5); }
    else if (o.vinyl === 'twoTone') { g.fillStyle = isLight(o.paint) ? '#2b2d38' : '#111117'; g.fillRect(-100, -24, 200, 14); }
    g.fillStyle = 'rgba(255,255,255,.16)'; g.fillRect(-100, -38, 200, 1.2);
    g.restore();
    // Windows.
    const gl = g.createLinearGradient(0, -58, 0, -42); gl.addColorStop(0, '#11172a'); gl.addColorStop(1, '#3b4a66');
    g.fillStyle = gl; g.beginPath(); g.moveTo(-58, -43); g.quadraticCurveTo(-46, -53, -34, -56); g.lineTo(3, -57); g.quadraticCurveTo(18, -55, 33, -43); g.closePath(); g.fill();
    g.fillStyle = paintGrad(g, o, -58, -42); g.fillRect(-16, -57, 3, 15);
    g.fillStyle = 'rgba(255,255,255,.14)'; g.beginPath(); g.moveTo(-6, -56); g.lineTo(6, -56); g.lineTo(-6, -44); g.lineTo(-18, -44); g.fill();
    g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = .7; g.beginPath(); g.moveTo(-14, -42); g.lineTo(-14, -14); g.moveTo(34, -42); g.quadraticCurveTo(38, -28, 36, -14); g.stroke();
    g.fillStyle = '#16161c'; g.fillRect(24, -36, 7, 1.6);
    // Headlights and tail lights.
    g.fillStyle = '#fff3cf'; g.beginPath(); g.moveTo(86, -34); g.lineTo(98, -30); g.lineTo(97, -27); g.lineTo(84, -30); g.fill();
    g.fillStyle = '#e8303f'; g.beginPath(); g.roundRect(-99.5, -35, 7, 6, 1.5); g.fill();
    // Body kit.
    if (o.kit !== 'stock') {
      g.fillStyle = '#121218'; g.beginPath(); g.roundRect(-40, -15, 80, ext ? 5 : 3.5, 1.5); g.fill();
      g.beginPath(); g.moveTo(84, -12); g.lineTo(101, -12); g.lineTo(103, -9); g.lineTo(86, -9.5); g.fill();
      if (ext) { g.beginPath(); g.moveTo(-98, -12); g.lineTo(-84, -12); g.lineTo(-86, -8); g.lineTo(-101, -8); g.fill(); g.fillStyle = 'rgba(255,255,255,.2)'; for (const x of [-26, -6, 14]) g.fillRect(x, -36, 9, 1.5); }
    }
    // Spoiler.
    if (o.spoiler === 'ducktail') { g.fillStyle = paintGrad(g, o, -44, -38); g.beginPath(); g.moveTo(-92, -39); g.quadraticCurveTo(-98, -45, -100, -44); g.lineTo(-99, -38); g.fill(); }
    else if (o.spoiler !== 'none') {
      const top = o.spoiler === 'gt' ? -49 : -62;
      g.fillStyle = '#16161c'; g.beginPath(); g.moveTo(-84, -39); g.lineTo(-80, -39); g.lineTo(-86, top); g.lineTo(-89, top); g.fill();
      g.fillStyle = paintGrad(g, o, top - 4, top + 2); g.beginPath(); g.moveTo(-100, top - 1); g.quadraticCurveTo(-88, top - 6, -74, top - 2); g.lineTo(-74, top); g.lineTo(-100, top + 1.5); g.fill();
      g.fillStyle = '#16161c'; g.beginPath(); g.roundRect(-101, top - 6, 2.5, 9, 1); g.fill();
    }
    // Wheels.
    for (const x of [-62, 62]) {
      g.fillStyle = '#15151b'; g.beginPath(); g.arc(x, -17, 17, 0, TAU); g.fill();
      g.strokeStyle = '#2a2a33'; g.lineWidth = 1; g.beginPath(); g.arc(x, -17, 15.5, 0, TAU); g.stroke();
      drawRim(g, x, -17, 12, o.rims, RIM_COLORS[o.rimColor] || '#c9ced8', rot);
    }
    g.restore();
  }

  // Traffic: pre-rendered stock cars and vans.
  let TRAFFIC = [];
  function drawVan(g, w, h, color) {
    const u = w / 100; g.save(); g.translate(w / 2, h); g.scale(u, u);
    g.fillStyle = 'rgba(0,0,0,.4)'; g.beginPath(); g.ellipse(0, -1, 56, 6, 0, 0, TAU); g.fill();
    g.fillStyle = '#121218'; g.fillRect(-46, -20, 16, 20); g.fillRect(30, -20, 16, 20);
    const gr = g.createLinearGradient(0, -100, 0, -10); gr.addColorStop(0, shade(color, .3)); gr.addColorStop(1, shade(color, -.35));
    g.fillStyle = gr; g.beginPath(); g.roundRect(-49, -98, 98, 86, 6); g.fill();
    g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, -94); g.lineTo(0, -16); g.stroke();
    g.fillStyle = '#1b2232'; g.fillRect(-40, -88, 34, 20); g.fillRect(6, -88, 34, 20);
    g.fillStyle = '#d32a36'; g.fillRect(-48, -40, 7, 14); g.fillRect(41, -40, 7, 14);
    g.fillStyle = '#f3f0e6'; g.fillRect(-12, -26, 24, 8);
    g.fillStyle = '#18181f'; g.fillRect(-49, -16, 98, 6);
    g.restore();
  }
  function buildTraffic() {
    const cols = ['#d9dde4', '#2d3a55', '#8a1f2b', '#3e6b52', '#f2c14e', '#5a5f6b', '#1f6fb2', '#efe9df'];
    TRAFFIC = [];
    for (let i = 0; i < 8; i++) {
      const o = { paint: cols[i], finish: 'gloss', spoiler: i % 4 === 1 ? 'ducktail' : 'none', kit: 'stock', neon: 'off', vinyl: 'none', plate: ['4821 KLM', '0937 BHT', '6610 DRV', '2255 GTF'][i % 4] };
      TRAFFIC.push({ img: mk(320, 230, (g, w, h) => drawCarRear(g, w / 2, h - 4, w * .86, o, { steer: 0, night: false })), w: CAR_W * 1.16, car: true });
    }
    for (const c of ['#f4f4f4', '#2f7fd1', '#e0a43a']) TRAFFIC.push({ img: mk(300, 320, (g, w, h) => drawVan(g, w, h - 2, c)), w: CAR_W * 1.2, car: true, van: true });
  }
  // ---------- Track ----------
  // Profile of each stage: curve strength (min, max), hills and chance of a straight.
  const PROFILE = [
    { c: [2, 4], hill: 18, straight: .3 },
    { c: [1, 3], hill: 36, straight: .45 },
    { c: [3.5, 6], hill: 55, straight: .12 },
    { c: [2, 5], hill: 8, straight: .25 },
    { c: [2, 4.5], hill: 30, straight: .25 },
  ];
  let segments = [], trackLen = 0, zoneStart = [], cars = [];
  const lastY = () => segments.length ? segments[segments.length - 1].p2.world.y : 0;
  function addSeg(curve, y, zone) {
    const n = segments.length;
    segments.push({ i: n, zone, curve, sprites: [], cars: [], dark: Math.floor(n / RUMBLE) % 2,
      p1: { world: { y: lastY(), z: n * SEG }, camera: {}, screen: {} },
      p2: { world: { y, z: (n + 1) * SEG }, camera: {}, screen: {} } });
  }
  function addRoad(enter, hold, leave, curve, hill, zone) {
    const sy = lastY(), ey = sy + hill * SEG, total = enter + hold + leave;
    for (let n = 0; n < enter; n++) addSeg(easeIn(0, curve, n / enter), easeInOut(sy, ey, n / total), zone);
    for (let n = 0; n < hold; n++) addSeg(curve, easeInOut(sy, ey, (enter + n) / total), zone);
    for (let n = 0; n < leave; n++) addSeg(easeInOut(curve, 0, n / leave), easeInOut(sy, ey, (enter + hold + n) / total), zone);
  }
  function addSprite(n, src, offset) { if (segments[n]) segments[n].sprites.push({ src, offset }); }
  function sideOffset(src, side, extra) { return side * (1.18 + src.w / (2 * ROAD) + extra); }

  function buildTrack() {
    segments = []; zoneStart = [];
    for (let z = 0; z < THEMES.length; z++) {
      const P = PROFILE[z], start = segments.length;
      zoneStart.push(start);
      addRoad(10, 40, 10, 0, -lastY() / SEG * .4, z);
      while (segments.length - start < ZONE_LEN - 160) {
        const len = [Math.floor(rand(25, 55)), Math.floor(rand(30, 110)), Math.floor(rand(25, 55))];
        const curve = Math.random() < P.straight ? 0 : (Math.random() < .5 ? -1 : 1) * rand(P.c[0], P.c[1]);
        const hill = clamp(rand(-P.hill, P.hill) - lastY() / SEG * .45, -P.hill, P.hill);
        addRoad(len[0], len[1], len[2], curve, hill, z);
        // S-bends are typical of the city and the mountains.
        if ((z === 2 || z === 3) && curve && Math.random() < .4) addRoad(25, 40, 25, -curve * .9, 0, z);
      }
      addRoad(40, 60, 40, 0, z === THEMES.length - 1 ? -lastY() / SEG : -lastY() / SEG * .5, z);
    }
    trackLen = segments.length * SEG;
    decorate();
    spawnTraffic(70);
  }

  function decorate() {
    for (let z = 0; z < THEMES.length; z++) {
      const T = THEMES[z], a = zoneStart[z], b = z + 1 < zoneStart.length ? zoneStart[z + 1] : segments.length;
      addSprite(a + 6, z === 0 ? SPR.start : SPR.gate, 0);
      for (let n = a + 14; n < b - 4; n++) {
        if (T.city) {
          if (n % 12 === 0) { addSprite(n, SPR.lamp, -1.32); addSprite(n + 6, SPR.lamp, 1.32); }
          if (n % 5 === 0) { const t = pick([SPR.tower, SPR.tower2]); addSprite(n, t, sideOffset(t, -1, rand(1.2, 2.6))); }
          if (n % 5 === 2) { const t = pick([SPR.tower, SPR.tower2]); addSprite(n, t, sideOffset(t, 1, rand(1.2, 2.6))); }
          if (n % 70 === 30) addSprite(n, SPR.neon, sideOffset(SPR.neon, pick([-1, 1]), .7));
          continue;
        }
        const every = z === 2 ? 3 : z === 1 ? 7 : 4;
        if (n % every) continue;
        for (const side of [-1, 1]) {
          if (Math.random() < (z === 1 ? .55 : .35)) continue;
          let name = pick(T.sprites), src = SPR[name];
          if (name === 'board') { if (Math.random() < .75) { name = T.sprites[0]; src = SPR[name]; } else src = pick(SPR.board); }
          addSprite(n, src, sideOffset(src, side, name === 'board' ? .05 : rand(0, z === 2 ? 2.2 : 1.6)));
        }
        if (z === 0 && n % 9 === 0) addSprite(n, SPR.bush, sideOffset(SPR.bush, pick([-1, 1]), rand(-.1, .4)));
      }
    }
  }

  const LANE_X = [-2 / 3, 0, 2 / 3];
  function findSeg(z) { return segments[Math.floor(z / SEG) % segments.length]; }
  function wrap(v, max) { while (v >= max) v -= max; while (v < 0) v += max; return v; }
  function spawnTraffic(n) {
    for (const s of segments) s.cars.length = 0;
    cars = [];
    for (let i = 0; i < n; i++) addCar(rand(SEG * 140, trackLen - SEG * 20));
  }
  function addCar(z) {
    const lane = Math.floor(Math.random() * LANES), spr = pick(TRAFFIC);
    const c = { z, lane, offset: LANE_X[lane], target: LANE_X[lane], speed: BASE_MAX * (spr.van ? rand(.32, .48) : rand(.38, .66)), spr, passed: false, near: false, timer: rand(3, 9) };
    c.seg = findSeg(c.z); c.seg.cars.push(c); cars.push(c);
  }
  // ---------- Race state ----------
  let state = 'menu', run = null, time = 0;
  const keys = Object.create(null), touch = Object.create(null);
  let pad = null, padPrev = [];
  const particles = [];
  function stats() {
    const p = car.perf, max = BASE_MAX * (1 + .06 * p.engine);
    return {
      max, accel: max / 4.6 * (1 + .1 * p.engine), brake: -max * 1.1, decel: -max / 5,
      offDecel: -max / 2 * (1 - .13 * p.tyres), offLimit: max / 4,
      centrifugal: .3 * (1 - .1 * p.tyres), steer: 2.1 * (1 + .1 * p.handling),
      nitroDur: 3.2 * (1 + .22 * p.turbo), boost: 1.2 + .035 * p.turbo,
    };
  }
  const kmh = sp => Math.round(sp / BASE_MAX * 262); // used for scoring
  const mph = sp => Math.round(sp / BASE_MAX * 262 * 0.621371); // display only
  function newRun() {
    buildTrack();
    run = { position: 0, speed: 0, x: 0, time: 52, score: 0, dist: 0, stage: 0, lap: 0, zone: 0, passes: 0, nears: 0, combo: 0, comboT: 0,
      nitro: 1, nitroOn: false, msgs: [], shake: 0, flash: 0, steer: 0, skid: 0, out: false, endT: 0, start: 2.6, crashes: 0 };
    particles.length = 0;
  }
  function msg(text, color = '#ffffff', big = false) { run.msgs.push({ text, color, big, t: 0 }); if (run.msgs.length > 4) run.msgs.shift(); }
  function overlap(x1, w1, x2, w2, pct = 1) { const h = pct / 2; return !((x1 + w1 * h) < (x2 - w2 * h) || (x1 - w1 * h) > (x2 + w2 * h)); }

  function readInput() {
    let steer = 0, gas = 0, brk = 0, nitro = false;
    if (keys.ArrowLeft || keys.KeyA || touch.left) steer -= 1;
    if (keys.ArrowRight || keys.KeyD || touch.right) steer += 1;
    if (keys.ArrowUp || keys.KeyW || touch.gas) gas = 1;
    if (keys.ArrowDown || keys.KeyS || touch.brake) brk = 1;
    if (keys.ShiftLeft || keys.ShiftRight || keys.Space || touch.nitro) nitro = true;
    if (pad) {
      const ax = pad.axes[0] || 0;
      if (Math.abs(ax) > .15) steer = clamp(steer + Math.sign(ax) * (Math.abs(ax) - .15) / .85, -1, 1);
      if (pad.buttons[14] && pad.buttons[14].pressed) steer = -1;
      if (pad.buttons[15] && pad.buttons[15].pressed) steer = 1;
      gas = Math.max(gas, pad.buttons[7] ? pad.buttons[7].value : 0);
      brk = Math.max(brk, pad.buttons[6] ? pad.buttons[6].value : 0);
      if (pad.buttons[0] && pad.buttons[0].pressed) nitro = true;
    }
    return { steer, gas, brk, nitro };
  }

  function update(dt) {
    const S = stats(), R = run;
    const inp = readInput();
    if (R.start > 0) { R.start -= dt; inp.gas = R.start < .6 ? inp.gas : 0; inp.nitro = false; }
    if (R.out) { inp.gas = 0; inp.nitro = false; }
    const pSeg = findSeg(R.position + PLAYER_Z);
    const sp = R.speed / S.max;
    // Steering and centrifugal force.
    const dx = dt * S.steer * Math.min(1, sp * 1.4);
    R.steer += (inp.steer - R.steer) * Math.min(1, dt * 9);
    R.x += R.steer * dx;
    R.x -= dx * sp * pSeg.curve * S.centrifugal;
    // Nitro.
    R.nitroOn = inp.nitro && R.nitro > 0 && inp.gas > 0 && R.speed > S.max * .2;
    if (R.nitroOn) R.nitro = Math.max(0, R.nitro - dt / S.nitroDur);
    else R.nitro = Math.min(1, R.nitro + dt * .015);
    const top = S.max * (R.nitroOn ? S.boost : 1);
    // Acceleration, braking and drag.
    if (inp.gas > 0 && R.speed < top) R.speed += S.accel * inp.gas * dt * (R.nitroOn ? 1.7 : 1) * (1 - .55 * R.speed / top);
    if (R.speed > top) R.speed += S.decel * dt * 1.4;
    if (inp.brk > 0) R.speed += S.brake * inp.brk * dt;
    else if (inp.gas <= 0) R.speed += S.decel * dt;
    const off = Math.abs(R.x) > 1.02;
    if (off && R.speed > S.offLimit) R.speed += S.offDecel * dt;
    // Collisions with scenery (only off the tarmac).
    if (Math.abs(R.x) > 1.1) {
      for (const s of pSeg.sprites) {
        if (!s.src.solid) continue;
        if (overlap(R.x, CAR_W / ROAD, s.offset, s.src.w / ROAD * .55)) { crash(S, pSeg.p1.world.z - PLAYER_Z, S.max / 6); break; }
      }
    }
    // Collisions with traffic.
    for (const seg of [pSeg, segments[(pSeg.i + 1) % segments.length]]) {
      for (const c of seg.cars) {
        const cw = c.spr.w / ROAD * .78;
        const dz = wrap(c.z - (R.position + PLAYER_Z), trackLen);
        if (dz < SEG * 1.2 && R.speed > c.speed && overlap(R.x, CAR_W / ROAD, c.offset, cw, .82)) {
          crash(S, c.z - PLAYER_Z - SEG * .3, c.speed * (c.speed / R.speed) * .85);
          c.passed = true;
        }
      }
    }
    R.x = clamp(R.x, -2.4, 2.4);
    R.speed = clamp(R.speed, 0, top * 1.25);
    R.position = wrap(R.position + dt * R.speed, trackLen);
    updateCars(dt);
    skyOff -= pSeg.curve * R.speed * dt / SEG * .0012;
    // Score and distance.
    R.dist += R.speed * dt * .006;
    if (R.start <= 0 && !R.out) R.score += dt * kmh(R.speed) * .45 * (R.nitroOn ? 1.5 : 1);
    R.comboT -= dt; if (R.comboT <= 0) R.combo = 0;
    // Time.
    if (R.start <= 0 && !R.out) {
      R.time -= dt;
      if (R.time <= 0) { R.time = 0; R.out = true; msg('OUT OF TIME', '#ff6f7d', true); sfx('timeout'); }
    }
    if (R.out) { R.endT += dt; if (R.speed < 300 || R.endT > 6) endRun(); }
    // Checkpoints (stage change).
    const z = findSeg(R.position + PLAYER_Z).zone;
    if (z !== R.zone) {
      R.zone = z; R.stage++;
      if (z === 0) { R.lap++; R.score += 5000; msg(`LAP ${R.lap + 1} · +5000`, '#ffd27a', true); for (let i = 0; i < 18; i++) addCar(wrap(R.position + rand(SEG * 160, trackLen - SEG * 40), trackLen)); }
      const bonus = Math.max(26, 46 - R.stage * 2 - R.lap * 4);
      if (!R.out) { R.time += bonus; msg(`CHECKPOINT ✓ +${bonus} SEC`, '#46f0d0', true); }
      msg(THEMES[z].name.toUpperCase(), '#ffffff');
      R.flash = 1; R.score += 1000; sfx('checkpoint');
    }
    // Effects.
    R.shake = Math.max(0, R.shake - dt * 3); R.flash = Math.max(0, R.flash - dt * 1.4);
    for (const m of R.msgs) m.t += dt;
    R.msgs = R.msgs.filter(m => m.t < 2.6);
    const slide = Math.abs(R.steer) * sp > .85 && Math.abs(pSeg.curve) > 3;
    R.skid = slide ? Math.min(1, R.skid + dt * 4) : Math.max(0, R.skid - dt * 4);
    if (off && R.speed > S.max * .2 && Math.random() < .7) puff(THEMES[pSeg.zone].grass[0], 1);
    if (R.skid > .5 && Math.random() < .3) puff('#d9d4e6', 1.15);
    updateParticles(dt);
    audioTick(S);
  }

  function crash(S, z, speed) {
    const R = run;
    if (R.speed > S.max * .3) { R.shake = Math.min(1, .4 + R.speed / S.max * .6); sfx('crash'); R.crashes++; }
    R.speed = speed; R.position = wrap(z, trackLen); R.combo = 0; R.comboT = 0;
    for (let i = 0; i < 10; i++) { const s = pick([-1, 1]); particles.push({ x: W / 2 + s * rand(170, 220), y: H - rand(40, 90), vx: s * rand(80, 300), vy: rand(-320, -80), life: 0, max: rand(.3, .6), r: rand(2, 4), color: '#ffd27a', spark: true }); }
  }

  function updateCars(dt) {
    const R = run, pz = R.position + PLAYER_Z;
    for (const c of cars) {
      c.timer -= dt;
      if (c.timer <= 0) { c.timer = rand(4, 10); if (Math.random() < .5) { c.lane = clamp(c.lane + pick([-1, 1]), 0, LANES - 1); c.target = LANE_X[c.lane]; } }
      c.offset += (c.target - c.offset) * Math.min(1, dt * 1.2);
      const old = c.seg;
      c.z = wrap(c.z + dt * c.speed, trackLen);
      c.seg = findSeg(c.z);
      if (old !== c.seg) { const k = old.cars.indexOf(c); if (k >= 0) old.cars.splice(k, 1); c.seg.cars.push(c); }
      // Overtakes: the car goes from being ahead of us to behind us.
      let d = c.z - pz; if (d > trackLen / 2) d -= trackLen; if (d < -trackLen / 2) d += trackLen;
      if (c.prev !== undefined && c.prev > 0 && d <= 0 && !c.passed) {
        R.passes++;
        const lat = Math.abs(c.offset - R.x);
        if (lat < .62) {
          R.combo++; R.comboT = 3; R.nears++;
          const pts = 250 * R.combo; R.score += pts; R.nitro = Math.min(1, R.nitro + .12);
          msg(`NEAR MISS! +${pts}${R.combo > 1 ? ' · x' + R.combo : ''}`, '#ffd27a'); sfx('near');
        } else R.score += 60;
      }
      if (d > SEG * 3) c.passed = false;
      c.prev = d;
    }
  }

  function puff(color, k) {
    for (const s of [-1, 1]) particles.push({ x: W / 2 + s * 120 * k + rand(-10, 10), y: H - 12, vx: s * rand(40, 120), vy: rand(-60, -20), life: 0, max: rand(.4, .7), r: rand(8, 14), color });
  }
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.spark) p.vy += 900 * dt; else { p.r += dt * 30; p.vx *= .97; }
      if (p.life > p.max) particles.splice(i, 1);
    }
  }
  // ---------- Background: parallax layers ----------
  const TILE_W = 1600, TILE_H = 420, TILE_K = TILE_W / W;
  const layerCache = new Map();
  function ridge(g, w, h, base, amps, color, seed, snow) {
    const ph = amps.map((_, i) => (Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453 % 1) * TAU);
    const yAt = x => base + amps.reduce((s, a, i) => s + a * Math.sin(TAU * (i + 1) * x / w * (i < 2 ? 1 : 2) + ph[i]), 0);
    g.fillStyle = color; g.beginPath(); g.moveTo(0, h);
    for (let x = 0; x <= w; x += 4) g.lineTo(x, yAt(x));
    g.lineTo(w, h); g.closePath(); g.fill();
    if (snow) {
      g.save(); g.clip(); g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.moveTo(0, 0);
      for (let x = 0; x <= w; x += 4) g.lineTo(x, Math.min(yAt(x) + 26, base - amps[0] * .2));
      g.lineTo(w, 0); g.fill(); g.restore();
    }
  }
  function layersFor(z) {
    if (layerCache.has(z)) return layerCache.get(z);
    const T = THEMES[z];
    const far = mk(TILE_W, TILE_H, (g, w, h) => {
      if (T.city) {
        for (let x = 0; x < w; x += rand(30, 60)) {
          const bw = rand(28, 70), bh = rand(60, 230);
          g.fillStyle = mix(T.far, T.sky[1], rand(0, .25)); g.fillRect(x, h - bh, bw, bh);
          for (let y = h - bh + 8; y < h - 6; y += 10) for (let xx = x + 4; xx < x + bw - 5; xx += 8) if (Math.random() < .22) { g.fillStyle = Math.random() < .3 ? '#7fe8ff' : '#ffd99a'; g.globalAlpha = .55; g.fillRect(xx, y, 3, 4); g.globalAlpha = 1; }
        }
      } else ridge(g, w, h, h * .55, [55, 30, 16, 8], T.far, z + 1, T.peaks);
    }, 1);
    const near = mk(TILE_W, TILE_H, (g, w, h) => {
      ridge(g, w, h, h * .8, [26, 14, 8, 5], T.near, z + 7, false);
      if (z === 0) { g.fillStyle = shade(T.near, -.2); for (let x = 30; x < w; x += rand(90, 200)) { g.save(); g.translate(x, h * .78); g.scale(.18, .18); palm(g, 300, 420, rand(-.5, .5)); g.restore(); } }
    }, 1);
    const stars = T.night ? Array.from({ length: 120 }, () => [Math.random(), Math.random() * .5, Math.random() * 1.4 + .3]) : null;
    const L = { far, near, stars };
    layerCache.set(z, L);
    return L;
  }
  let skyOff = 0;
  function drawSky(T, alpha, horizon) {
    const L = layersFor(THEMES.indexOf(T));
    ctx.globalAlpha = alpha;
    const sg = ctx.createLinearGradient(0, 0, 0, horizon + 20);
    sg.addColorStop(0, T.sky[0]); sg.addColorStop(1, T.sky[1]);
    ctx.fillStyle = sg; ctx.fillRect(0, 0, W, horizon + 40);
    if (L.stars) { ctx.fillStyle = '#ffffff'; for (const [x, y, r] of L.stars) { ctx.globalAlpha = alpha * (.4 + .4 * Math.sin(time * 2 + x * 40)); ctx.fillRect(((x - skyOff * .05) % 1 + 1) % 1 * W, y * H, r, r); } ctx.globalAlpha = alpha; }
    // Sun or moon.
    const sx = W * .5 + Math.sin(skyOff * .6) * W * .18, sy = horizon * T.sunY + 40;
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, T.night ? 160 : 300);
    glow.addColorStop(0, rgba(T.sun, T.night ? .35 : .55)); glow.addColorStop(1, rgba(T.sun, 0));
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, horizon + 40);
    ctx.fillStyle = T.sun; ctx.beginPath(); ctx.arc(sx, sy, T.night ? 30 : 62, 0, TAU); ctx.fill();
    if (T.night) { ctx.fillStyle = T.sky[0]; ctx.globalAlpha = alpha * .9; ctx.beginPath(); ctx.arc(sx + 12, sy - 8, 26, 0, TAU); ctx.fill(); ctx.globalAlpha = alpha; }
    // Mountains.
    for (const [img, k, y] of [[L.far, .25, horizon - TILE_H / TILE_K + 22], [L.near, .55, horizon - TILE_H / TILE_K + 30]]) {
      const tw = W, off = ((skyOff * k * tw) % tw + tw) % tw;
      for (let i = -1; i < 1; i++) ctx.drawImage(img, i * tw + off, y, tw, TILE_H / TILE_K + 1);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- Projection and road ----------
  function project(p, cx, cy, cz) {
    p.camera.x = (p.world.x || 0) - cx; p.camera.y = p.world.y - cy; p.camera.z = p.world.z - cz;
    const s = p.screen.scale = DEPTH / p.camera.z;
    p.screen.x = W / 2 + s * p.camera.x * W / 2;
    p.screen.y = Math.round((H / 2 - s * p.camera.y * H / 2) * scale) / scale;
    p.screen.w = s * ROAD * W / 2;
  }
  function quad(x1, y1, w1, x2, y2, w2, color) {
    ctx.fillStyle = color; ctx.beginPath();
    ctx.moveTo(x1 - w1, y1); ctx.lineTo(x1 + w1, y1); ctx.lineTo(x2 + w2, y2 - .5); ctx.lineTo(x2 - w2, y2 - .5); ctx.fill();
  }
  const fogAt = d => 1 / Math.pow(Math.E, d * d * FOG);
  function renderSegment(seg) {
    const T = THEMES[seg.zone], d = seg.dark, a = seg.p1.screen, b = seg.p2.screen;
    ctx.fillStyle = T.grass[d]; ctx.fillRect(0, b.y - .5, W, a.y - b.y + .5);
    const r1 = a.w / 7, r2 = b.w / 7;
    quad(a.x - a.w - r1 / 2, a.y, r1 / 2, b.x - b.w - r2 / 2, b.y, r2 / 2, T.rumble[d]);
    quad(a.x + a.w + r1 / 2, a.y, r1 / 2, b.x + b.w + r2 / 2, b.y, r2 / 2, T.rumble[d]);
    quad(a.x, a.y, a.w, b.x, b.y, b.w, T.road[d]);
    // Solid edge lines and dashed lane markings.
    const e1 = a.w * .035, e2 = b.w * .035;
    quad(a.x - a.w * .93, a.y, e1 / 2, b.x - b.w * .93, b.y, e2 / 2, T.lane);
    quad(a.x + a.w * .93, a.y, e1 / 2, b.x + b.w * .93, b.y, e2 / 2, T.lane);
    if (!d) for (let l = 1; l < LANES; l++) {
      const k = -1 + 2 * l / LANES;
      quad(a.x + a.w * k, a.y, e1 * .45, b.x + b.w * k, b.y, e2 * .45, T.lane);
    }
    if (seg.fog < 1) { ctx.globalAlpha = 1 - seg.fog; ctx.fillStyle = T.fog; ctx.fillRect(0, b.y, W, a.y - b.y); ctx.globalAlpha = 1; }
  }
  function renderSprite(img, worldW, s, x, y, clipY, alpha) {
    const dw = worldW * s * W / 2, dh = dw * img.height / img.width;
    if (dw < 1.5) return null;
    const dx = x - dw / 2, dy = y - dh;
    const clipH = clipY ? Math.max(0, dy + dh - clipY) : 0;
    if (clipH >= dh) return null;
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, 0, 0, img.width, img.height - img.height * clipH / dh, dx, dy, dw, dh - clipH);
    ctx.globalAlpha = 1;
    return { dx, dy, dw, dh };
  }

  function render() {
    const R = run, base = findSeg(R.position), basePct = (R.position % SEG) / SEG;
    const pSeg = findSeg(R.position + PLAYER_Z), pPct = ((R.position + PLAYER_Z) % SEG) / SEG;
    const pY = lerp(pSeg.p1.world.y, pSeg.p2.world.y, pPct);
    const S = stats(), sp = R.speed / S.max;
    const shake = R.shake * 9;
    ctx.save();
    if (shake) ctx.translate(rand(-shake, shake), rand(-shake, shake) * .6);
    // Sky, cross-fading into the next stage.
    const z = pSeg.zone, zEnd = z + 1 < zoneStart.length ? zoneStart[z + 1] : segments.length;
    const blend = clamp((pSeg.i - (zEnd - 260)) / 260, 0, 1);
    const horizon = H / 2 + clamp(-pY / 60, -60, 60) * .3;
    drawSky(THEMES[z], 1, horizon);
    if (blend > 0) drawSky(THEMES[(z + 1) % THEMES.length], blend, horizon);
    // Road, near to far.
    let maxy = H, x = 0, dx = -(base.curve * basePct);
    for (let n = 0; n < DRAW; n++) {
      const seg = segments[(base.i + n) % segments.length];
      seg.looped = seg.i < base.i;
      seg.fog = fogAt(n / DRAW);
      seg.clip = maxy;
      const cz = R.position - (seg.looped ? trackLen : 0);
      project(seg.p1, R.x * ROAD - x, pY + CAM_H, cz);
      project(seg.p2, R.x * ROAD - x - dx, pY + CAM_H, cz);
      x += dx; dx += seg.curve;
      if (seg.p1.camera.z <= DEPTH || seg.p2.screen.y >= seg.p1.screen.y || seg.p2.screen.y >= maxy) continue;
      renderSegment(seg);
      maxy = seg.p1.screen.y;
    }
    // Scenery and traffic, far to near.
    for (let n = DRAW - 1; n > 0; n--) {
      const seg = segments[(base.i + n) % segments.length];
      const a = seg.p1.screen, b = seg.p2.screen, al = clamp(seg.fog * 1.6, 0, 1);
      if (a.scale > 0) for (const s of seg.sprites) {
        renderSprite(s.src.img, s.src.w, a.scale, a.x + a.scale * s.offset * ROAD * W / 2, a.y, seg.clip, al);
      }
      for (const c of seg.cars) {
        const pct = (c.z % SEG) / SEG, cs = lerp(a.scale, b.scale, pct);
        if (!(cs > 0)) continue;
        const r = renderSprite(c.spr.img, c.spr.w, cs, lerp(a.x, b.x, pct) + cs * c.offset * ROAD * W / 2, lerp(a.y, b.y, pct), seg.clip, al);
        if (r && THEMES[seg.zone].night && !c.spr.van) for (const sx of [-.29, .29]) glowAt(ctx, r.dx + r.dw * (.5 + sx), r.dy + r.dh * .56, r.dw * .12, r.dw * .05, '#ff3344', .7 * al);
      }
      if (seg === pSeg) drawPlayer(pSeg, pPct, sp);
    }
    drawParticles();
    if (R.nitroOn) speedLines(sp);
    ctx.restore();
  }

  function drawPlayer(pSeg, pPct, sp) {
    const R = run, s = DEPTH / PLAYER_Z;
    const camY = lerp(pSeg.p1.camera.y, pSeg.p2.camera.y, pPct);
    const y = H / 2 - s * camY * H / 2;
    const w = CAR_W * s * W / 2;
    const bump = Math.abs(R.x) > 1.02 && R.speed > 500 ? rand(-2.5, 2.5) : 0;
    const inp = readInput();
    drawCarRear(ctx, W / 2, y - 4 + bump, w, car, { steer: R.steer, brake: inp.brk > 0 || R.out, nitro: R.nitroOn, t: time * sp, night: THEMES[pSeg.zone].night });
  }
  function drawParticles() {
    for (const p of particles) {
      const k = p.life / p.max;
      if (p.spark) { ctx.fillStyle = p.color; ctx.globalAlpha = 1 - k; ctx.fillRect(p.x, p.y, p.r, p.r); }
      else { ctx.fillStyle = p.color; ctx.globalAlpha = (1 - k) * .35; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
  }
  const LINES = Array.from({ length: 40 }, () => [Math.random() * TAU, Math.random()]);
  function speedLines(sp) {
    ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 2;
    for (const L of LINES) {
      const t = (L[1] + time * 2.2) % 1, r0 = 220 + t * 700, r1 = r0 + 60 + t * 140;
      ctx.globalAlpha = t * .8 * sp;
      ctx.beginPath(); ctx.moveTo(W / 2 + Math.cos(L[0]) * r0, H * .45 + Math.sin(L[0]) * r0 * .6); ctx.lineTo(W / 2 + Math.cos(L[0]) * r1, H * .45 + Math.sin(L[0]) * r1 * .6); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  // ---------- HUD ----------
  function panel(x, y, w, h) {
    ctx.fillStyle = 'rgba(16,11,32,.5)'; ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 14); ctx.fill(); ctx.stroke();
  }
  function text(t, x, y, size, color, align = 'left', font = 'Bebas Neue') {
    ctx.font = `${font === 'Bebas Neue' ? 400 : 600} ${size}px '${font}', Impact, sans-serif`;
    ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = color; ctx.fillText(t, x, y);
  }
  function drawHud() {
    const R = run, S = stats();
    ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 8;
    // Time.
    const low = R.time < 10 && !R.out;
    panel(W / 2 - 90, 18, 180, 86);
    text('TIME', W / 2, 40, 15, '#d8cfee', 'center', 'Rajdhani');
    text(String(Math.ceil(R.time)), W / 2, 94, 60, low && Math.floor(time * 4) % 2 ? '#ff6f7d' : '#ffffff', 'center');
    // Score and stage.
    panel(22, 18, 330, 86);
    text('SCORE', 40, 40, 15, '#d8cfee', 'left', 'Rajdhani');
    text(String(Math.floor(R.score)).padStart(7, '0'), 40, 78, 38, '#ffd27a');
    const z = R.zone, a = zoneStart[z], b = z + 1 < zoneStart.length ? zoneStart[z + 1] : segments.length;
    const prog = clamp((findSeg(R.position + PLAYER_Z).i - a) / (b - a), 0, 1);
    text(`STAGE ${R.stage + 1} · ${THEMES[z].name.toUpperCase()}`, 190, 40, 13, '#ffffff', 'left', 'Rajdhani');
    ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.beginPath(); ctx.roundRect(190, 56, 144, 8, 4); ctx.fill();
    const pg = ctx.createLinearGradient(190, 0, 334, 0); pg.addColorStop(0, '#46f0d0'); pg.addColorStop(1, '#ffd27a');
    ctx.fillStyle = pg; ctx.beginPath(); ctx.roundRect(190, 56, Math.max(8, 144 * prog), 8, 4); ctx.fill();
    text('CHECKPOINT', 334, 84, 12, '#a9a1c2', 'right', 'Rajdhani');
    // Lap and overtakes.
    panel(W - 252, 18, 230, 86);
    text('LAP', W - 234, 40, 15, '#d8cfee', 'left', 'Rajdhani');
    text(String(R.lap + 1), W - 234, 82, 40, '#ffffff');
    text('OVERTAKES', W - 40, 40, 15, '#d8cfee', 'right', 'Rajdhani');
    text(String(R.passes), W - 40, 82, 40, '#ffffff', 'right');
    if (R.combo > 1) text(`COMBO x${R.combo}`, W - 137, 128, 24, '#ffd27a', 'center');
    // Speedometer.
    const cx = W - 130, cy = H - 92, r = 82, k = clamp(R.speed / (BASE_MAX * 1.45), 0, 1);
    ctx.fillStyle = 'rgba(16,11,32,.55)'; ctx.beginPath(); ctx.arc(cx, cy, r + 18, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0; ctx.lineCap = 'round';
    ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI * .75, Math.PI * 2.25); ctx.stroke();
    const sg = ctx.createLinearGradient(cx - r, 0, cx + r, 0); sg.addColorStop(0, '#46f0d0'); sg.addColorStop(.6, '#ffd27a'); sg.addColorStop(1, '#ff6f7d');
    ctx.strokeStyle = sg; ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI * .75, Math.PI * (.75 + 1.5 * k)); ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.4)';
    for (let i = 0; i <= 10; i++) { const an = Math.PI * (.75 + .15 * i); ctx.beginPath(); ctx.moveTo(cx + Math.cos(an) * (r - 18), cy + Math.sin(an) * (r - 18)); ctx.lineTo(cx + Math.cos(an) * (r - 10), cy + Math.sin(an) * (r - 10)); ctx.stroke(); }
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.beginPath(); ctx.arc(cx, cy, r - 28, Math.PI * .8, Math.PI * 1.2); ctx.stroke();
    ctx.strokeStyle = R.nitroOn ? '#7fd8ff' : '#4fa8ff'; ctx.beginPath(); ctx.arc(cx, cy, r - 28, Math.PI * 1.2 - Math.PI * .4 * R.nitro, Math.PI * 1.2); ctx.stroke();
    text(String(mph(R.speed)), cx + 6, cy + 12, 50, '#ffffff', 'center');
    text('MPH', cx + 6, cy + 32, 13, '#a9a1c2', 'center', 'Rajdhani');
    const gear = R.speed < 60 ? 'N' : String(Math.min(6, 1 + Math.floor(R.speed / S.max * 5.6)));
    text(gear, cx + 6, cy + 66, 22, '#ffd27a', 'center');
    text('NITRO', cx - r + 6, cy + 4, 12, '#7fd8ff', 'left', 'Rajdhani');
    ctx.shadowBlur = 8;
    // Messages.
    let my = 196;
    for (const m of R.msgs) {
      const a = m.t < .2 ? m.t / .2 : m.t > 2.1 ? (2.6 - m.t) / .5 : 1;
      ctx.globalAlpha = clamp(a, 0, 1);
      text(m.text, W / 2, my, m.big ? 46 : 28, m.color, 'center');
      my += m.big ? 48 : 34;
    }
    ctx.globalAlpha = 1;
    // Countdown.
    if (R.start > 0) {
      const n = Math.ceil(R.start - .6), t = R.start - .6 - Math.floor(R.start - .6);
      const label = n > 0 ? String(n) : 'GO!';
      ctx.globalAlpha = n > 0 ? .4 + t * .6 : clamp(R.start / .6, 0, 1);
      text(label, W / 2, H * .42, n > 0 ? 130 : 110, n > 0 ? '#ffffff' : '#ffd27a', 'center');
      ctx.globalAlpha = 1;
    }
    ctx.shadowBlur = 0;
    if (R.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${R.flash * .25})`; ctx.fillRect(0, 0, W, H); }
    // Soft vignette.
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * .45, W / 2, H / 2, H * .95);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(10,6,22,.4)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  }
  // ---------- Audio: original synthwave, engine and sound effects ----------
  let AC = null, master, musicBus, sfxBus, noiseBuf, engine = null, musicTimer = null, mNext = 0, mStep = 0;
  function initAudio() {
    if (AC) { AC.resume().catch(() => {}); return; }
    const Ctor = window.AudioContext || window.webkitAudioContext; if (!Ctor) return;
    AC = new Ctor();
    master = AC.createGain(); master.gain.value = .8;
    const comp = AC.createDynamicsCompressor(); master.connect(comp); comp.connect(AC.destination);
    musicBus = AC.createGain(); musicBus.gain.value = car.music ? .32 : 0; musicBus.connect(master);
    sfxBus = AC.createGain(); sfxBus.gain.value = .55; sfxBus.connect(master);
    // Gentle echo on the music.
    const dl = AC.createDelay(); dl.delayTime.value = 60 / 112 * .75; const fb = AC.createGain(); fb.gain.value = .28;
    const wet = AC.createGain(); wet.gain.value = .25; musicBus.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(master);
    musicBus.echo = dl;
    noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // Engine: two filtered sawtooth oscillators whose pitch follows the revs.
    const o1 = AC.createOscillator(), o2 = AC.createOscillator(), f = AC.createBiquadFilter(), g = AC.createGain();
    o1.type = 'sawtooth'; o2.type = 'square'; o2.detune.value = -1200; f.type = 'lowpass'; f.frequency.value = 600; f.Q.value = 4; g.gain.value = 0;
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(sfxBus); o1.start(); o2.start();
    const sk = AC.createBufferSource(), skf = AC.createBiquadFilter(), skg = AC.createGain();
    sk.buffer = noiseBuf; sk.loop = true; skf.type = 'bandpass'; skf.frequency.value = 2400; skf.Q.value = 2; skg.gain.value = 0;
    sk.connect(skf); skf.connect(skg); skg.connect(sfxBus); sk.start();
    engine = { o1, o2, f, g, skg };
    mNext = AC.currentTime + .1;
    musicTimer = setInterval(scheduleMusic, 25);
  }
  function audioTick(S) {
    if (!engine) return;
    const R = run, t = AC.currentTime, sp = R.speed / S.max;
    const gearF = (sp * 5.6) % 1, rpm = R.speed < 60 ? .15 : .3 + gearF * .7 * Math.min(1, sp * 3);
    const fr = 38 + rpm * 90 + sp * 30;
    engine.o1.frequency.setTargetAtTime(fr, t, .05); engine.o2.frequency.setTargetAtTime(fr, t, .05);
    engine.f.frequency.setTargetAtTime(380 + rpm * 1400 + (R.nitroOn ? 900 : 0), t, .06);
    engine.g.gain.setTargetAtTime(state === 'race' ? .07 + rpm * .07 : 0, t, .1);
    engine.skg.gain.setTargetAtTime(state === 'race' ? R.skid * .07 + (Math.abs(R.x) > 1.02 && R.speed > 400 ? .04 : 0) : 0, t, .05);
  }
  function env(node, t, a, peak, dec) { node.gain.setValueAtTime(0.0001, t); node.gain.linearRampToValueAtTime(peak, t + a); node.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }
  function tone(freq, t, dur, type, vol, bus = musicBus, cutoff = 0) {
    const o = AC.createOscillator(), g = AC.createGain(); o.type = type; o.frequency.setValueAtTime(freq, t);
    let out = o; if (cutoff) { const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; o.connect(f); out = f; }
    out.connect(g); g.connect(bus); env(g, t, .01, vol, dur); o.start(t); o.stop(t + dur + .05);
  }
  function noise(t, dur, type, freq, vol, bus = musicBus) {
    const s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
    s.buffer = noiseBuf; f.type = type; f.frequency.value = freq; s.connect(f); f.connect(g); g.connect(bus); env(g, t, .002, vol, dur);
    s.start(t, Math.random() * .5); s.stop(t + dur + .05);
  }
  const midi = n => 440 * Math.pow(2, (n - 69) / 12);
  // F minor: Fm – Db – Ab – Eb, 112 bpm, quavers.
  const CHORDS = [[53, 56, 60], [49, 53, 56], [56, 60, 63], [51, 55, 58]];
  const MELODY = [72, 0, 75, 0, 77, 75, 72, 0, 68, 0, 70, 72, 0, 0, 75, 0, 73, 0, 72, 70, 68, 0, 65, 0, 68, 0, 70, 0, 72, 0, 0, 0];
  function scheduleMusic() {
    if (!AC) return;
    const step8 = 60 / 112 / 2;
    while (mNext < AC.currentTime + .15) {
      const t = mNext, s = mStep % 8, bar = Math.floor(mStep / 8) % 4, section = Math.floor(mStep / 64) % 4;
      if (state === 'race' && run && run.start <= 0) {
        const ch = CHORDS[bar];
        if (s % 2 === 0) { const k = AC.createOscillator(), g = AC.createGain(); k.frequency.setValueAtTime(130, t); k.frequency.exponentialRampToValueAtTime(42, t + .16); k.connect(g); g.connect(musicBus); env(g, t, .003, s % 4 === 0 ? .9 : .5, .22); k.start(t); k.stop(t + .3); }
        if (s === 4) noise(t, .2, 'bandpass', 1800, .35);
        noise(t, .04, 'highpass', 8000, s % 2 ? .1 : .05);
        tone(midi(ch[0] - 24), t, step8 * .9, 'sawtooth', .22, musicBus, 500);
        if (s === 0) for (const n of ch) { tone(midi(n), t, step8 * 7, 'sawtooth', .05, musicBus, 1400); tone(midi(n) * 1.004, t, step8 * 7, 'sawtooth', .04, musicBus, 1400); }
        if (section > 0) { const ar = ch[(mStep) % 3] + 12 * (1 + (s > 3)); tone(midi(ar), t, step8 * .7, 'square', .035, musicBus, 2600); }
        if (section >= 2) { const m = MELODY[mStep % 32]; if (m) { tone(midi(m), t, step8 * 1.8, 'sawtooth', .06, musicBus, 3000); tone(midi(m) * 1.006, t, step8 * 1.8, 'triangle', .05); } }
      } else if (state !== 'race') {
        // Menu: calm pads only.
        if (s === 0) for (const n of CHORDS[bar]) tone(midi(n), t, step8 * 8, 'triangle', .05, musicBus, 1200);
        if (s % 2 === 0) tone(midi(CHORDS[bar][(s / 2) % 3] + 12), t, step8 * 1.5, 'sine', .04);
      }
      mNext += step8; mStep++;
    }
  }
  function sfx(name) {
    if (!AC) return; const t = AC.currentTime;
    if (name === 'crash') { noise(t, .45, 'lowpass', 900, 1, sfxBus); tone(70, t, .3, 'square', .4, sfxBus, 400); }
    else if (name === 'near') { tone(880, t, .12, 'triangle', .25, sfxBus); tone(1320, t + .06, .16, 'triangle', .2, sfxBus); noise(t, .25, 'bandpass', 1200, .25, sfxBus); }
    else if (name === 'checkpoint') { [72, 76, 79, 84].forEach((n, i) => tone(midi(n), t + i * .08, .35, 'triangle', .3, sfxBus)); }
    else if (name === 'timeout') { [67, 63, 60].forEach((n, i) => tone(midi(n), t + i * .18, .4, 'sawtooth', .18, sfxBus, 1500)); }
    else if (name === 'beep') tone(880, t, .15, 'square', .18, sfxBus, 2000);
    else if (name === 'go') tone(1320, t, .5, 'square', .2, sfxBus, 2400);
    else if (name === 'click') tone(660, t, .06, 'triangle', .15, sfxBus);
    else if (name === 'buy') { tone(midi(79), t, .15, 'triangle', .25, sfxBus); tone(midi(86), t + .08, .3, 'triangle', .25, sfxBus); }
  }
  function setMusic(on) {
    car.music = on; save();
    $('#musicBtn').textContent = on ? '♫ MUSIC ON' : '♫ MUSIC OFF';
    if (AC) musicBus.gain.setTargetAtTime(on ? .32 : 0, AC.currentTime, .1);
  }
  // ---------- UI: screens and garage ----------
  const screens = ['menu', 'garage', 'pause', 'end'];
  function show(id) {
    for (const s of screens) $('#' + s).hidden = s !== id;
    $('#screen').classList.toggle('playing', !id);
  }
  function refreshMenu() {
    $('#bestNote').textContent = `BEST ${Math.floor(car.best).toLocaleString('en-GB')} PTS · ${car.credits.toLocaleString('en-GB')} CREDITS`;
    $('#credits').textContent = car.credits.toLocaleString('en-GB');
  }
  const cap = s => s[0].toUpperCase() + s.slice(1);
  function group(title, html) { return `<div><h3>${title}</h3><div class="chips">${html}</div></div>`; }
  const chipsOf = (key, map) => Object.entries(map).map(([k, v]) => `<button class="chip" type="button" data-set="${key}" data-val="${k}" aria-pressed="${car[key] === k}">${Array.isArray(v) ? v[0] : v}</button>`).join('');
  function buildGarage() {
    $('#lookOpts').innerHTML =
      group('Paint', PAINTS.map(([c, n]) => `<button class="swatch" type="button" data-set="paint" data-val="${c}" aria-label="${n}" title="${n}" aria-pressed="${car.paint === c}" style="background:${c}"></button>`).join('')) +
      group('Finish', chipsOf('finish', FINISHES)) +
      group('Wheels', chipsOf('rims', RIMS)) +
      group('Wheel colour', Object.entries(RIM_COLORS).map(([k, c]) => `<button class="swatch" type="button" data-set="rimColor" data-val="${k}" aria-label="${cap(k)}" title="${cap(k)}" aria-pressed="${car.rimColor === k}" style="background:${c}"></button>`).join('')) +
      group('Spoiler', chipsOf('spoiler', SPOILERS)) +
      group('Body kit', chipsOf('kit', KITS)) +
      group('Vinyl', chipsOf('vinyl', VINYLS)) +
      group('Underglow', chipsOf('neon', NEONS)) +
      `<div><h3>Number plate</h3><input class="plate" id="plate" maxlength="7" value="${car.plate.replace(/[^\w -]/g, '')}" aria-label="Number plate text"></div>`;
    $('#plate').addEventListener('input', e => { car.plate = e.target.value.toUpperCase().replace(/[^A-Z0-9 -]/g, '').slice(0, 7); save(); });
    buildPerf();
  }
  function buildPerf() {
    $('#perfOpts').innerHTML = PERF.map(p => {
      const lvl = car.perf[p.id], cost = COST[lvl];
      const bars = [0, 1, 2, 3].map(i => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
      const btn = lvl >= 4 ? '<button class="buy" type="button" disabled>MAX</button>' : `<button class="buy" type="button" data-buy="${p.id}" ${car.credits < cost ? 'disabled' : ''}>${cost.toLocaleString('en-GB')} cr</button>`;
      return `<div class="perf"><div><b>${p.name}</b> <small>${p.note}</small><div class="bars">${bars}</div></div>${btn}</div>`;
    }).join('') + `<p class="note">You earn credits after every race, based on your score.</p>`;
    refreshMenu();
  }
  document.addEventListener('click', e => {
    const set = e.target.closest('[data-set]');
    if (set) {
      car[set.dataset.set] = set.dataset.val; save(); sfx('click');
      document.querySelectorAll(`[data-set="${set.dataset.set}"]`).forEach(b => b.setAttribute('aria-pressed', String(b === set)));
      return;
    }
    const buy = e.target.closest('[data-buy]');
    if (buy) {
      const id = buy.dataset.buy, lvl = car.perf[id];
      if (lvl < 4 && car.credits >= COST[lvl]) { car.credits -= COST[lvl]; car.perf[id]++; save(); sfx('buy'); buildPerf(); }
      return;
    }
    const tab = e.target.closest('[data-tab]');
    if (tab) {
      document.querySelectorAll('[data-tab]').forEach(t => t.setAttribute('aria-selected', String(t === tab)));
      $('#lookOpts').hidden = tab.dataset.tab !== 'look'; $('#perfOpts').hidden = tab.dataset.tab !== 'perf';
      return;
    }
    const view = e.target.closest('[data-view]');
    if (view) { previewView = view.dataset.view; document.querySelectorAll('[data-view]').forEach(v => v.setAttribute('aria-pressed', String(v === view))); }
  });

  let previewView = 'side';
  const pv = $('#preview'), pctx = pv.getContext('2d');
  function drawPreview() {
    const w = pv.width, h = pv.height, g = pctx;
    const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#1c1436'); bg.addColorStop(.62, '#2a1d48'); bg.addColorStop(.63, '#17112b'); bg.addColorStop(1, '#0c0918');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const spot = g.createRadialGradient(w / 2, h * .2, 10, w / 2, h * .55, w * .55); spot.addColorStop(0, 'rgba(255,210,150,.28)'); spot.addColorStop(1, 'rgba(255,210,150,0)');
    g.fillStyle = spot; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 1;
    for (let i = -10; i <= 10; i++) { g.beginPath(); g.moveTo(w / 2 + i * 30, h * .63); g.lineTo(w / 2 + i * 120, h); g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,.05)'; g.beginPath(); g.ellipse(w / 2, h * .82, w * .4, h * .07, 0, 0, TAU); g.fill();
    if (previewView === 'side') drawCarSide(g, w / 2, h * .82, w * .74, car, time * 1.5);
    else drawCarRear(g, w / 2, h * .84, w * .46, car, { steer: Math.sin(time * .8) * .4, brake: Math.sin(time * 1.3) > .6, nitro: Math.sin(time * .9) > .7, t: time, night: true });
    g.fillStyle = 'rgba(255,255,255,.5)'; g.font = "500 16px 'DM Mono', monospace"; g.textAlign = 'left';
    const S = stats();
    g.fillText(`TOP SPEED ${mph(S.max)} MPH · NITRO ${S.nitroDur.toFixed(1)}s`, 22, 34);
  }

  // ---------- Game flow ----------
  let lastBeep = -1;
  function startRace() {
    initAudio(); newRun(); state = 'race'; lastBeep = -1; run.start = 3.6; show(null);
  }
  function endRun() {
    if (state !== 'race') return;
    state = 'end';
    const R = run, earned = Math.floor(R.score / 15);
    car.credits += earned; const record = R.score > car.best; if (record) car.best = R.score; save();
    $('#endEyebrow').textContent = record ? 'New record' : 'End of the road';
    $('#endTitle').textContent = R.lap > 0 ? `Made it to lap ${R.lap + 1}` : `You reached ${THEMES[R.zone].name}`;
    $('#eDist').textContent = `${(R.dist / 1609.344).toFixed(1)} mi`;
    $('#eStage').textContent = String(R.stage + 1);
    $('#ePass').textContent = String(R.passes);
    $('#eScore').textContent = Math.floor(R.score).toLocaleString('en-GB');
    $('#endText').textContent = `You earned ${earned.toLocaleString('en-GB')} credits (${R.nears} near ${R.nears === 1 ? 'miss' : 'misses'}, ${R.crashes} ${R.crashes === 1 ? 'crash' : 'crashes'}). Spend them in the garage to upgrade your car.`;
    buildPerf(); show('end');
  }
  function setPause(on) {
    if (on && state === 'race') { state = 'pause'; show('pause'); }
    else if (!on && state === 'pause') { state = 'race'; show(null); }
  }
  function toMenu() { state = 'menu'; refreshMenu(); show('menu'); newRun(); }
  function toGarage() { state = 'garage'; buildGarage(); show('garage'); }

  // Attract-mode demo drive behind the menus.
  function attract(dt) {
    const R = run, pSeg = findSeg(R.position + PLAYER_Z);
    R.start = 0; R.speed += (BASE_MAX * .6 - R.speed) * Math.min(1, dt);
    R.steer = clamp(-R.x * 2 + pSeg.curve * .15, -1, 1) * .5;
    R.x += (-R.x * .8 + pSeg.curve * .02) * dt;
    for (const c of pSeg.cars) if (Math.abs(c.offset - R.x) < .45) c.target = LANE_X[c.lane = (c.lane + 1) % LANES];
    R.position = wrap(R.position + dt * R.speed, trackLen);
    updateCars(dt); R.passes = 0; R.msgs.length = 0;
    skyOff -= pSeg.curve * R.speed * dt / SEG * .0012;
    updateParticles(dt);
    if (engine) audioTick(stats());
  }

  $('#playBtn').addEventListener('click', startRace);
  $('#garageBtn').addEventListener('click', () => { initAudio(); toGarage(); });
  $('#garagePlay').addEventListener('click', startRace);
  $('#garageBack').addEventListener('click', toMenu);
  $('#resumeBtn').addEventListener('click', () => setPause(false));
  $('#quitBtn').addEventListener('click', toMenu);
  $('#againBtn').addEventListener('click', startRace);
  $('#endGarage').addEventListener('click', toGarage);
  $('#endMenu').addEventListener('click', toMenu);
  $('#musicBtn').addEventListener('click', () => { initAudio(); setMusic(!car.music); });

  document.addEventListener('keydown', e => {
    if (e.target && e.target.tagName === 'INPUT') return;
    keys[e.code] = true;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'Escape' || e.code === 'KeyP') { if (state === 'race') setPause(true); else if (state === 'pause') setPause(false); }
    if (e.code === 'KeyM') { initAudio(); setMusic(!car.music); }
    if (e.code === 'Enter' && (state === 'menu' || state === 'end')) startRace();
  });
  document.addEventListener('keyup', e => { keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; setPause(true); });
  if ('ontouchstart' in window) $('#touch').classList.add('on');
  document.querySelectorAll('#touch [data-k]').forEach(b => {
    const k = b.dataset.k;
    b.addEventListener('pointerdown', e => { e.preventDefault(); touch[k] = true; });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => { touch[k] = false; });
  });

  function pollPad() {
    pad = navigator.getGamepads ? Array.from(navigator.getGamepads()).find(Boolean) || null : null;
    if (!pad) { padPrev = []; return; }
    const now = pad.buttons.map(b => Boolean(b && b.pressed));
    const hit = i => now[i] && !padPrev[i];
    if (hit(9)) { if (state === 'race') setPause(true); else if (state === 'pause') setPause(false); else if (state !== 'garage') startRace(); }
    else if (state === 'menu' && hit(0)) startRace();
    else if (state === 'menu' && hit(3)) toGarage();
    else if (state === 'menu' && hit(1)) location.href = '../index.html';
    else if (state === 'pause' && hit(0)) setPause(false);
    else if (state === 'pause' && hit(1)) toMenu();
    else if (state === 'end' && hit(0)) startRace();
    else if (state === 'end' && hit(1)) toMenu();
    else if (state === 'garage' && hit(1)) toMenu();
    padPrev = now;
  }

  let last = 0, frames = 0;
  function frame(ts) {
    const dt = Math.min(.05, (ts - last) / 1000 || 0); last = ts; time += dt;
    if (frames++ % 30 === 0) resize();
    pollPad();
    if (state === 'race') {
      update(dt);
      const n = Math.ceil(run.start - .6);
      if (run.start > 0 && n !== lastBeep) { lastBeep = n; sfx(n > 0 ? 'beep' : 'go'); }
    } else if (state === 'menu' || state === 'garage') attract(dt);
    else if (engine) audioTick(stats());
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    render();
    if (state === 'race' || state === 'pause' || state === 'end') drawHud();
    if (state === 'garage') drawPreview();
    requestAnimationFrame(frame);
  }

  resize();
  buildSprites();
  buildTraffic();
  newRun();
  setMusic(car.music);
  refreshMenu();
  show('menu');
  requestAnimationFrame(frame);
})();
