(() => {
  'use strict';
  /* =====================================================================
     STAR SIEGE — wave-based space shooter in an open sector
     ===================================================================== */
  const canvas = document.querySelector('#game');
  const ctx = canvas.getContext('2d');
  const W = 1280, H = 720, TAU = Math.PI * 2, WORLD = 4000;
  const $ = s => document.querySelector(s);
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
  const load = (k, def) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? def; } catch { return def; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };
  const rgb = hex => { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const rgba = (hex, a) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; };
  const shade = (hex, k) => { const f = v => Math.round(k < 1 ? v * k : v + (255 - v) * (k - 1)); const [r, g, b] = rgb(hex); return `rgb(${f(r)},${f(g)},${f(b)})`; };

  /* ---------------- Native screen resolution ---------------- */
  // Game logic runs in 1280×720 logical coordinates, but the canvas is drawn at
  // the screen's physical resolution so everything stays crisp.
  let scale = 1;
  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const bw = Math.round(clamp(r.width * dpr, 640, 2560));
    if (canvas.width !== bw) { canvas.width = bw; canvas.height = Math.round(bw * 9 / 16); }
    scale = canvas.width / W;
  }
  window.addEventListener('resize', resize);
  resize();

  // Cached glow sprites: much faster than shadowBlur.
  const glowCache = new Map();
  function glowSprite(color) {
    let c = glowCache.get(color);
    if (!c) {
      c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.18, color); gr.addColorStop(.45, color.startsWith('#') ? rgba(color, .35) : color);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      glowCache.set(color, c);
    }
    return c;
  }
  function glow(c, x, y, color, size, alpha = 1) {
    c.globalAlpha = alpha;
    c.drawImage(glowSprite(color), x - size, y - size, size * 2, size * 2);
    c.globalAlpha = 1;
  }

  /* ---------------- Hangar: ship customisation ---------------- */
  const CHASSIS = [
    { id: 'falcon', name: 'Falcon', role: 'All-rounder', hp: 3, speed: 1, rate: 1, dmg: 1, dash: 1, span: 15, desc: 'Reliable at everything. The best ship to start with.' },
    { id: 'swift', name: 'Swift', role: 'Interceptor', hp: 2, speed: 1.22, rate: 1, dmg: .9, dash: .65, span: 13, desc: 'The fastest, with near-constant dashes. Very fragile.' },
    { id: 'rhino', name: 'Rhino', role: 'Bomber', hp: 5, speed: .84, rate: .88, dmg: 1.35, dash: 1.25, span: 19, desc: 'Heavily armoured and hard-hitting, but slow to react.' },
    { id: 'mantis', name: 'Mantis', role: 'Gunship', hp: 3, speed: .95, rate: 1.28, dmg: .95, dash: 1, span: 15, desc: 'Its forward claws fire extremely fast.' }
  ];
  const PAINTS = [
    { id: 'cyan', name: 'Cyan', c: '#6fe3ff' }, { id: 'lime', name: 'Lime', c: '#c8ff4d' }, { id: 'pink', name: 'Pink', c: '#ff5fae' },
    { id: 'orange', name: 'Orange', c: '#ff9a3d' }, { id: 'violet', name: 'Violet', c: '#a98bff' }, { id: 'silver', name: 'Silver', c: '#dfe6ff' }
  ];
  const TRAILS = [
    { id: 'ion', name: 'Ion', c: '#5fd8ff' }, { id: 'fire', name: 'Fire', c: '#ff7a2e' },
    { id: 'plasma', name: 'Plasma', c: '#7dff8a' }, { id: 'rainbow', name: 'Rainbow', c: null }
  ];
  const PATTERNS = [{ id: 'plain', name: 'Plain' }, { id: 'stripes', name: 'Stripes' }, { id: 'chevron', name: 'Chevron' }, { id: 'eye', name: 'Eye' }];
  // localStorage keys keep the game's original Spanish name so existing saves still load.
  const STORAGE = { ship: 'asedio-estelar-nave', autoFire: 'asedio-estelar-autofuego', best: 'asedio-estelar-best', sound: 'asedio-estelar-sonido' };
  // Older saves stored the Spanish option ids; map them to the current ones.
  const LEGACY_IDS = { halcon: 'falcon', colibri: 'swift', rinoceronte: 'rhino', cian: 'cyan', lima: 'lime', rosa: 'pink', naranja: 'orange', violeta: 'violet', plata: 'silver',
    ionica: 'ion', fuego: 'fire', arcoiris: 'rainbow', liso: 'plain', franjas: 'stripes', ojo: 'eye' };
  const migrateId = id => LEGACY_IDS[id] || id;
  let custom = load(STORAGE.ship, {});
  const byId = (list, id) => list.find(x => x.id === id) || list[0];
  custom = { chassis: byId(CHASSIS, migrateId(custom.chassis)).id, paint: byId(PAINTS, migrateId(custom.paint)).id, trail: byId(TRAILS, migrateId(custom.trail)).id, pattern: byId(PATTERNS, migrateId(custom.pattern)).id };
  const chassis = () => byId(CHASSIS, custom.chassis);

  /* ---------------- Upgrades (they also change how the ship looks) ---------------- */
  const MAX_LVL = 4;
  const UPGRADES = [
    { id: 'multi', name: 'Multi-cannon', color: '#6fe3ff', icon: '⋔', text: l => `${l + 1} projectiles per shot` },
    { id: 'rate', name: 'Fire Rate', color: '#ffd166', icon: '»', text: l => `+${Math.round((1 / Math.pow(.8, l) - 1) * 100)}% fire rate` },
    { id: 'power', name: 'Plasma', color: '#ff6fd0', icon: '✦', text: l => `Damage ×${(1 + l * .6).toFixed(1)}` },
    { id: 'pierce', name: 'Piercing Lance', color: '#b48cff', icon: '➶', text: l => `Pierces ${l} enem${l > 1 ? 'ies' : 'y'}` },
    { id: 'shield', name: 'Hex Shield', color: '#46f0d0', icon: '⬡', text: l => `${l} regenerating charge${l > 1 ? 's' : ''}` },
    { id: 'drones', name: 'Orbital Drones', color: '#8dff6a', icon: '◈', text: l => `${l} support drone${l > 1 ? 's' : ''}` },
    { id: 'missiles', name: 'Missiles', color: '#ff9a3d', icon: '⇡', text: l => `${l} missile${l > 1 ? 's' : ''} per salvo` },
    { id: 'nova', name: 'Nova', color: '#e8f75a', icon: '◎', text: l => `Shockwave every ${(5.2 - l * .7).toFixed(1)} s` },
    { id: 'speed', name: 'Thrusters', color: '#4fb6ff', icon: '≋', text: l => `Speed +${l * 15}%` },
    { id: 'armor', name: 'Armour', color: '#ff5a6e', icon: '♥', text: l => `+${l} max health` }
  ];
  const TOTAL_LVLS = UPGRADES.length * MAX_LVL;
  const PLASMA = ['#9fe8ff', '#7aa8ff', '#b48cff', '#ff6fd0', '#ff4f6e'];

  /* ---------------- Random loot ---------------- */
  const RARITY = [
    { id: 'common', name: 'Common', color: '#cfd8ff', w: 62 },
    { id: 'rare', name: 'Rare', color: '#4fa3ff', w: 26 },
    { id: 'epic', name: 'Epic', color: '#c86bff', w: 10 },
    { id: 'legendary', name: 'Legendary', color: '#ffd166', w: 2 }
  ];
  const POWERS = {
    overdrive: { name: 'Overdrive', color: '#ffd166', icon: '⚡', dur: 10, desc: 'Fire rate ×2 for 10 s' },
    magnet: { name: 'Magnet', color: '#46f0d0', icon: '⊛', dur: 14, desc: 'Pulls in all loot for 14 s' },
    bomb: { name: 'Bomb', color: '#ff5a6e', icon: '✸', dur: 0, desc: 'Obliterates everything around you' }
  };

  /* ---------------- Bosses ---------------- */
  const BOSSES = [
    { id: 'mothership', name: 'Mothership', color: '#ff4fa3', hp: 170, r: 66 },
    { id: 'colossus', name: 'Rock Colossus', color: '#d8a46c', hp: 230, r: 72 },
    { id: 'queen', name: 'Swarm Queen', color: '#b48cff', hp: 160, r: 50 },
    { id: 'dreadnought', name: 'Dreadnought', color: '#46f0d0', hp: 270, r: 74 }
  ];

  /* ---------------- State ---------------- */
  let mode = 'menu'; // menu | play | pause | over
  let up, player, enemies, bullets, enemyBullets, missiles, pickups, particles, rings, beams, toasts, banner, powers;
  let wave, waveQueue, waveTotal, waveKilled, spawnT, clearT, score, time, shake, flash, god, ascendT;
  const cam = { x: WORLD / 2, y: WORLD / 2 };
  const keys = Object.create(null);
  const mouse = { x: W / 2, y: H / 2, down: false, used: false };
  let autoFire = load(STORAGE.autoFire, false);
  const touch = { move: null, aim: null };
  let pad = { mx: 0, my: 0, ax: 0, ay: 0, rt: false }, padButtons = [];

  const S = {
    fireInterval: () => .30 * Math.pow(.8, up.rate) / chassis().rate * (powers.overdrive > 0 ? .5 : 1),
    shots: () => 1 + up.multi,
    dmg: () => (1 + up.power * .6) * chassis().dmg * (god ? 2 : 1),
    speed: () => 300 * (1 + up.speed * .15) * chassis().speed,
    dashCd: () => (1.4 - up.speed * .18) * chassis().dash,
    maxHp: () => chassis().hp + up.armor,
    shieldRegen: () => 7 - up.shield * .9,
    missileCd: () => 2.4 - up.missiles * .3,
    novaCd: () => 5.2 - up.nova * .7,
    novaR: () => 160 + up.nova * 50
  };
  const levels = () => UPGRADES.reduce((n, u) => n + up[u.id], 0);

  // Difficulty: rises with every wave cleared and ramps up sharply from wave 10.
  const hpScale = n => (1 + (n - 1) * .18) * Math.pow(1.04, Math.max(0, n - 10));
  const spdScale = n => Math.min(2.4, 1 + (n - 1) * .045);
  const eliteChance = n => clamp((n - 5) * .022, 0, .3);

  function reset() {
    up = Object.fromEntries(UPGRADES.map(u => [u.id, 0]));
    powers = { overdrive: 0, magnet: 0 };
    player = { x: WORLD / 2, y: WORLD / 2, vx: 0, vy: 0, r: 14, hp: 0, invuln: 2, fireT: 0, aim: -Math.PI / 2, dashCd: 0, dashT: 0,
      shield: 0, shieldT: 0, missileT: 1, novaT: 3, droneT: 0, trail: [] };
    player.hp = S.maxHp();
    cam.x = player.x; cam.y = player.y;
    enemies = []; bullets = []; enemyBullets = []; missiles = []; pickups = []; particles = []; rings = []; beams = []; toasts = [];
    score = 0; time = 0; shake = 0; flash = 0; god = false; ascendT = 0; banner = null;
    startWave(1);
  }

  /* ---------------- Waves ---------------- */
  function startWave(n) {
    wave = n;
    waveQueue = buildWave(n);
    waveTotal = waveQueue.reduce((c, t) => c + (t === 'swarm' ? 6 : 1), 0);
    waveKilled = 0; spawnT = .8; clearT = 0;
    const bossWave = n % 5 === 0;
    const names = waveQueue.filter(t => t.startsWith('boss:')).map(t => byId(BOSSES, t.slice(5)).name);
    banner = { title: bossWave ? `WAVE ${n} · BOSS${names.length > 1 ? 'ES' : ''}` : `WAVE ${n}`,
      sub: bossWave ? names.join(' & ') : waveSub(n), t: 2.6, color: bossWave ? '#ff4fa3' : '#46f0d0' };
    sfx(bossWave ? 'boss' : 'wave');
  }
  function waveSub(n) {
    const tips = { 2: 'Insects dive-bombing from above', 3: 'Gunships incoming: keep moving', 4: 'Swarms on the scope', 6: 'Elite ships appear: tougher, with better loot' };
    return tips[n] || (god ? 'You are invincible. Tear them apart.' : `Enemies at ${Math.round(hpScale(n) * 100)}% toughness`);
  }
  function buildWave(n) {
    const q = [];
    if (n % 5 === 0) {
      const k = n / 5 - 1;
      q.push('boss:' + BOSSES[k % BOSSES.length].id);
      if (n >= 20) q.push('boss:' + BOSSES[(k + 1) % BOSSES.length].id);
      for (let i = 0; i < 4 + n / 2; i++) q.push(pick(['drone', 'diver', 'swarm']));
      return q;
    }
    const pool = [['asteroid', 3, 1], ['drone', 1, 1], ['diver', 2, 2], ['shooter', 3, 3], ['swarm', 4, 4]].filter(t => n >= t[2]);
    let budget = 10 + n * 5 + Math.floor(n * n * .15);
    while (budget > 0) { const [type, cost] = pick(pool); q.push(type); budget -= cost; }
    return q;
  }

  function aroundPlayer(min = 760, max = 920) {
    const a = rand(0, TAU), d = rand(min, max);
    return { x: clamp(player.x + Math.cos(a) * d, 60, WORLD - 60), y: clamp(player.y + Math.sin(a) * d, 60, WORLD - 60) };
  }

  function spawn(type) {
    if (type.startsWith('boss:')) {
      const p = { x: player.x + rand(-300, 300), y: player.y - 620 };
      return addEnemy('boss', clamp(p.x, 100, WORLD - 100), clamp(p.y, 100, WORLD - 100), byId(BOSSES, type.slice(5)));
    }
    if (type === 'swarm') {
      const p = aroundPlayer();
      for (let i = 0; i < 6; i++) addEnemy('swarmer', p.x + rand(-50, 50), p.y + rand(-50, 50));
      return;
    }
    if (type === 'diver') return addEnemy('diver', player.x + rand(-520, 520), player.y - rand(480, 560));
    const p = aroundPlayer();
    const e = addEnemy(type, p.x, p.y, type === 'asteroid' ? 3 : 0);
    if (type !== 'asteroid' && Math.random() < eliteChance(wave)) makeElite(e);
  }

  const BASE = {
    asteroid: { hp: [0, 1, 3, 7], r: [0, 17, 30, 48], value: [0, 60, 40, 20] },
    drone: { hp: 2, r: 14, value: 30, speed: 100 },
    swarmer: { hp: 1, r: 9, value: 15, speed: 185 },
    diver: { hp: 3, r: 16, value: 50, speed: 160 },
    shooter: { hp: 6, r: 19, value: 70, speed: 115 }
  };

  function addEnemy(type, x, y, extra = 0) {
    const e = { type, x, y, vx: 0, vy: 0, t: rand(0, 10), flash: 0, rot: rand(0, TAU), seed: Math.random(), elite: false };
    if (type === 'asteroid') {
      const b = BASE.asteroid, size = extra;
      e.size = size; e.r = b.r[size]; e.hp = e.maxHp = Math.ceil(b.hp[size] * hpScale(wave)); e.value = b.value[size];
      const a = Math.atan2(player.y - y, player.x - x) + rand(-.5, .5), sp = rand(40, 90) * spdScale(wave) * (4 - size) / 2.2;
      e.vx = Math.cos(a) * sp; e.vy = Math.sin(a) * sp; e.spin = rand(-1, 1);
      e.shape = Array.from({ length: 12 }, () => rand(.74, 1.08));
      e.craters = Array.from({ length: 2 + size }, () => ({ a: rand(0, TAU), d: rand(.1, .55), r: rand(.12, .24) }));
    } else if (type === 'boss') {
      const def = extra, cycle = Math.floor((wave - 5) / 20);
      Object.assign(e, { def, r: def.r, value: 3000, rot: 0, attackT: 2.2, pattern: 0, phase2: false, state: 'orbit', stateT: 2.4, spiral: 0, orbitA: rand(0, TAU) });
      e.hp = e.maxHp = Math.ceil(def.hp * hpScale(wave) * (1 + cycle * .35));
      if (def.id === 'dreadnought') { e.laserT = 3; e.laser = null; }
    } else {
      const b = BASE[type];
      e.r = b.r; e.hp = e.maxHp = Math.ceil(b.hp * hpScale(wave)); e.value = b.value; e.speed = b.speed * spdScale(wave);
    }
    if (type === 'diver') { e.phase = 'enter'; e.baseX = x; e.enterY = y; }
    if (type === 'shooter') { e.fireT = rand(1, 2.5); e.orbit = rand(0, TAU); }
    enemies.push(e);
    return e;
  }
  function makeElite(e) {
    e.elite = true; e.r *= 1.45; e.hp = e.maxHp = e.maxHp * 5; e.value *= 6; e.speed *= .9;
  }
  // Elites only sometimes drop a capsule; otherwise they drop a power-up.
  const eliteDrop = () => Math.random() < .55;

  /* ---------------- Input ---------------- */
  function moveVector() {
    let x = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + pad.mx;
    let y = (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0) + pad.my;
    if (touch.move) { x += clamp((touch.move.x - touch.move.ox) / 45, -1, 1); y += clamp((touch.move.y - touch.move.oy) / 45, -1, 1); }
    const m = Math.hypot(x, y);
    return m > 1 ? { x: x / m, y: y / m } : { x, y };
  }
  // Manual aiming priority: gamepad > arrow keys > touch > mouse.
  function aimIntent() {
    if (Math.hypot(pad.ax, pad.ay) > .3) return { a: Math.atan2(pad.ay, pad.ax), fire: true, src: 'pad' };
    const kx = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0), ky = (keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0);
    if (kx || ky) return { a: Math.atan2(ky, kx), fire: true, src: 'keys' };
    if (touch.aim && touch.aim.moved) return { a: Math.atan2(touch.aim.y - touch.aim.oy, touch.aim.x - touch.aim.ox), fire: true, src: 'touch' };
    if (mouse.used) {
      const wx = cam.x - W / 2 + mouse.x, wy = cam.y - H / 2 + mouse.y;
      return { a: Math.atan2(wy - player.y, wx - player.x), fire: mouse.down || autoFire || pad.rt, src: 'mouse' };
    }
    return { a: player.aim, fire: autoFire || pad.rt, src: 'none' };
  }

  function dash() {
    if (mode !== 'play' || player.dashCd > 0) return;
    const v = moveVector();
    const a = Math.hypot(v.x, v.y) > .1 ? Math.atan2(v.y, v.x) : player.aim;
    player.vx = Math.cos(a) * S.speed() * 3.2; player.vy = Math.sin(a) * S.speed() * 3.2;
    player.dashT = .18; player.dashCd = S.dashCd(); player.invuln = Math.max(player.invuln, .3);
    burst(player.x, player.y, 16, trailColor(0), 180, 3);
    sfx('dash');
  }

  /* ---------------- Main loop ---------------- */
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(.04, (now - last) / 1000 || 0);
    last = now;
    pollPad();
    if (mode === 'play') update(dt);
    updateFx(mode === 'pause' ? 0 : mode === 'play' ? dt : dt * .5, now / 1000);
    draw(now / 1000);
    if (mode === 'menu') drawPreview(now / 1000);
    requestAnimationFrame(frame);
  }

  function update(dt) {
    time += dt;
    const p = player;
    for (const k in powers) powers[k] = Math.max(0, powers[k] - dt);
    p.dashT -= dt; p.dashCd -= dt; p.invuln -= dt;
    if (p.dashT <= 0) {
      const v = moveVector(), sp = S.speed(), k = Math.min(1, dt * 10);
      p.vx += (v.x * sp - p.vx) * k; p.vy += (v.y * sp - p.vy) * k;
    }
    p.x = clamp(p.x + p.vx * dt, 30, WORLD - 30);
    p.y = clamp(p.y + p.vy * dt, 30, WORLD - 30);
    p.trail.unshift({ x: p.x, y: p.y }); if (p.trail.length > (god ? 28 : 14)) p.trail.pop();

    // Manual aiming and firing.
    const aim = aimIntent();
    p.aim += angDiff(p.aim, aim.a) * Math.min(1, dt * 22);
    p.aim = Math.atan2(Math.sin(p.aim), Math.cos(p.aim));
    p.fireT -= dt;
    if (aim.fire && p.fireT <= 0) {
      p.fireT = S.fireInterval();
      const n = S.shots(), spread = .11;
      const col = god ? `hsl(${Math.floor(time * 4) % 12 * 30} 100% 70%)` : PLASMA[up.power];
      for (let i = 0; i < n; i++) {
        const a = p.aim + (i - (n - 1) / 2) * spread;
        // Bullets don't inherit the ship's velocity, so they go exactly where you aim.
        bullets.push({ x: p.x + Math.cos(a) * 18, y: p.y + Math.sin(a) * 18, vx: Math.cos(a) * 860, vy: Math.sin(a) * 860,
          r: 3 + up.power * .8, dmg: S.dmg(), pierce: up.pierce, hit: new Set(), life: 1.05, color: col });
      }
      sfx('shoot');
    }

    // Free camera: follows the ship and leads towards where you aim.
    let lx = p.vx * .18, ly = p.vy * .18;
    if (aim.src === 'mouse') { lx = clamp((mouse.x - W / 2) * .35, -260, 260); ly = clamp((mouse.y - H / 2) * .35, -170, 170); }
    else if (aim.src !== 'none') { lx = Math.cos(aim.a) * 180; ly = Math.sin(aim.a) * 120; }
    cam.x += (clamp(p.x + lx, W / 2, WORLD - W / 2) - cam.x) * Math.min(1, dt * 5);
    cam.y += (clamp(p.y + ly, H / 2, WORLD - H / 2) - cam.y) * Math.min(1, dt * 5);

    if (p.shield < up.shield) { p.shieldT -= dt; if (p.shieldT <= 0) { p.shield++; p.shieldT = S.shieldRegen(); } }

    // Orbital drones (they aim by themselves: they are support).
    if (up.drones) {
      p.droneT -= dt;
      const fire = p.droneT <= 0; if (fire) p.droneT = 1.1;
      const tgt = nearestEnemy(p, 520);
      for (let i = 0; i < up.drones; i++) {
        const dp = dronePos(i);
        for (const e of enemies) if (d2(e, dp) < (e.r + 10) ** 2) hurtEnemy(e, 7 * dt * S.dmg(), false);
        if (fire && tgt) {
          const a = Math.atan2(tgt.y - dp.y, tgt.x - dp.x);
          bullets.push({ x: dp.x, y: dp.y, vx: Math.cos(a) * 700, vy: Math.sin(a) * 700, r: 2.5, dmg: S.dmg() * .6, pierce: 0, hit: new Set(), life: .9, color: '#8dff6a' });
        }
      }
    }
    if (up.missiles) {
      p.missileT -= dt;
      if (p.missileT <= 0 && nearestEnemy(p, 900)) {
        p.missileT = S.missileCd();
        for (let i = 0; i < up.missiles; i++) {
          const a = p.aim + Math.PI + (i - (up.missiles - 1) / 2) * .6;
          missiles.push({ x: p.x, y: p.y, vx: Math.cos(a) * 240, vy: Math.sin(a) * 240, target: null, life: 4 });
        }
        sfx('missile');
      }
    }
    if (up.nova) {
      p.novaT -= dt;
      if (p.novaT <= 0) { p.novaT = S.novaCd(); shockwave(p.x, p.y, S.novaR(), (3 + up.nova) * S.dmg(), '#e8f75a'); sfx('nova'); }
    }

    spawnT -= dt;
    const cap = Math.min(120, 50 + wave * 2);
    if (waveQueue.length && spawnT <= 0 && enemies.length < cap) {
      spawn(waveQueue.shift());
      spawnT = Math.max(.1, .95 - wave * .05) * rand(.6, 1.3);
    }

    updateEnemies(dt);
    updateBeams(dt);
    updateBullets(dt);
    updateMissiles(dt);
    updatePickups(dt);

    if (!waveQueue.length && !enemies.length) {
      if (clearT === 0) {
        clearT = 2.8;
        const bonus = 400 * wave;
        score += bonus;
        const reward = waveReward();
        banner = { title: `WAVE ${wave} CLEARED`, sub: `+${bonus} points · ${reward}`, t: 2.6, color: '#e8f75a' };
        sfx('clear');
      }
      clearT -= dt;
      if (clearT <= 0) startWave(wave + 1);
    }
  }

  function nearestEnemy(from, range) {
    let best = null, bd = range * range;
    for (const e of enemies) { const d = d2(e, from); if (d < bd) { bd = d; best = e; } }
    return best;
  }
  const inView = (x, y, m = 0) => Math.abs(x - cam.x) < W / 2 + m && Math.abs(y - cam.y) < H / 2 + m;
  function dronePos(i) {
    const a = time * 2.4 + i * TAU / up.drones;
    return { x: player.x + Math.cos(a) * 58, y: player.y + Math.sin(a) * 58 };
  }
  function shockwave(x, y, R, dmg, color) {
    rings.push({ x, y, r: 10, max: R, life: .55, color, w: 5 });
    for (const e of enemies) if (d2(e, { x, y }) < (R + e.r) ** 2) {
      hurtEnemy(e, dmg);
      if (e.type !== 'boss') { const a = Math.atan2(e.y - y, e.x - x); e.x += Math.cos(a) * 34; e.y += Math.sin(a) * 34; }
    }
    enemyBullets = enemyBullets.filter(b => d2(b, { x, y }) > R * R);
  }

  /* ---------------- Enemies ---------------- */
  function updateEnemies(dt) {
    const p = player;
    for (const e of enemies) {
      e.t += dt; e.flash -= dt;
      switch (e.type) {
        case 'asteroid':
          e.x += e.vx * dt; e.y += e.vy * dt; e.rot += e.spin * dt;
          if (e.x < e.r || e.x > WORLD - e.r) e.vx *= -1;
          if (e.y < e.r || e.y > WORLD - e.r) e.vy *= -1;
          // If it drifts too far away, respawn it nearby so the player isn't left waiting forever.
          if (d2(e, p) > 1500 ** 2) { const q = aroundPlayer(); e.x = q.x; e.y = q.y; const a = Math.atan2(p.y - e.y, p.x - e.x); const sp = Math.hypot(e.vx, e.vy); e.vx = Math.cos(a) * sp; e.vy = Math.sin(a) * sp; }
          break;
        case 'drone': case 'swarmer': {
          const a = Math.atan2(p.y - e.y, p.x - e.x), k = Math.min(1, dt * (e.type === 'drone' ? 2.4 : 3.6));
          e.vx += (Math.cos(a) * e.speed - e.vx) * k; e.vy += (Math.sin(a) * e.speed - e.vy) * k;
          e.x += e.vx * dt; e.y += e.vy * dt; e.rot = Math.atan2(e.vy, e.vx);
          if (e.elite && Math.random() < dt * .5) shootEnemy(e.x, e.y, a, 240);
          break;
        }
        case 'diver':
          if (e.phase === 'enter') {
            e.enterY += e.speed * .55 * dt;
            e.y = e.enterY; e.x = e.baseX + Math.sin(e.t * 2.2 + e.seed * 6) * 120;
            if (e.y > p.y - 300 + e.seed * 140) {
              e.phase = 'dive';
              const a = Math.atan2(p.y - e.y, p.x - e.x);
              e.vx = Math.cos(a) * e.speed * 1.8; e.vy = Math.sin(a) * e.speed * 1.8;
              if (e.elite) for (let i = -1; i <= 1; i++) shootEnemy(e.x, e.y, a + i * .25, 260);
            }
          } else {
            e.x += e.vx * dt; e.y += e.vy * dt;
            if (d2(e, p) > 900 ** 2) { e.phase = 'enter'; e.baseX = p.x + rand(-500, 500); e.enterY = p.y - 520; e.t = 0; }
          }
          e.rot = e.phase === 'dive' ? Math.atan2(e.vy, e.vx) : Math.PI / 2;
          break;
        case 'shooter': {
          e.orbit += dt * .35;
          const tx = p.x + Math.cos(e.orbit) * 300, ty = p.y + Math.sin(e.orbit) * 230;
          const a = Math.atan2(ty - e.y, tx - e.x), k = Math.min(1, dt * 1.5);
          e.vx += (Math.cos(a) * e.speed - e.vx) * k; e.vy += (Math.sin(a) * e.speed - e.vy) * k;
          e.x += e.vx * dt; e.y += e.vy * dt;
          e.rot = Math.atan2(p.y - e.y, p.x - e.x);
          e.fireT -= dt;
          if (e.fireT <= 0 && inView(e.x, e.y)) {
            e.fireT = Math.max(.7, 2.2 - wave * .07) * (e.elite ? .6 : 1);
            const n = wave >= 14 ? 5 : wave >= 7 ? 3 : 1;
            for (let i = 0; i < n; i++) shootEnemy(e.x, e.y, e.rot + (i - (n - 1) / 2) * .2, 230 + wave * 3);
          }
          break;
        }
        case 'boss': updateBoss(e, dt); break;
      }
      if (d2(e, p) < (e.r + p.r * .8) ** 2) {
        hurtPlayer();
        if (e.type !== 'boss') hurtEnemy(e, e.type === 'asteroid' ? 3 : e.elite ? 4 : 99);
      }
    }
    enemies = enemies.filter(e => !e.dead);
  }

  function shootEnemy(x, y, a, sp, big = false) {
    enemyBullets.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: big ? 8 : 5, life: 6 });
  }

  function bossTempo(e) { return (e.phase2 ? .7 : 1) * Math.max(.6, 1 - wave * .008); }

  function updateBoss(e, dt) {
    const p = player, id = e.def.id;
    if (!e.phase2 && e.hp < e.maxHp / 2) {
      e.phase2 = true;
      rings.push({ x: e.x, y: e.y, r: e.r, max: e.r * 4, life: .7, color: e.def.color, w: 6 });
      toast(`${e.def.name.toUpperCase()} · PHASE 2`, 'Enraged: faster attacks', e.def.color);
      sfx('boss');
    }
    e.attackT -= dt;
    if (id === 'mothership') {
      const hx = p.x + Math.sin(e.t * .45) * 420, hy = p.y - 230 + Math.sin(e.t * .7) * 40;
      e.x += (hx - e.x) * Math.min(1, dt * .9); e.y += (hy - e.y) * Math.min(1, dt * .9);
      e.rot += dt * .8;
      if (e.attackT <= 0) {
        e.attackT = 2.1 * bossTempo(e);
        const pat = e.pattern++ % 3;
        if (pat === 0) { const n = 18 + Math.floor(wave / 2) + (e.phase2 ? 8 : 0); for (let i = 0; i < n; i++) shootEnemy(e.x, e.y, e.rot + i * TAU / n, 180); }
        else if (pat === 1) { const a = Math.atan2(p.y - e.y, p.x - e.x), n = e.phase2 ? 5 : 3; for (let i = -n; i <= n; i++) shootEnemy(e.x, e.y, a + i * .12, 280); }
        else for (let i = 0; i < (e.phase2 ? 5 : 3); i++) addEnemy('drone', e.x + rand(-60, 60), e.y + 40);
        sfx('bossShot');
      }
    } else if (id === 'colossus') {
      const a = Math.atan2(p.y - e.y, p.x - e.x), sp = e.phase2 ? 80 : 50;
      e.x += Math.cos(a) * sp * dt; e.y += Math.sin(a) * sp * dt;
      e.rot += dt * (e.phase2 ? 1.3 : .8);
      if (e.attackT <= 0) {
        e.attackT = 2.6 * bossTempo(e);
        if (e.pattern++ % 2 === 0) {
          for (let i = 0; i < (e.phase2 ? 5 : 3); i++) {
            const rock = addEnemy('asteroid', e.x, e.y, 2), aa = a + (i - 1) * .35;
            rock.vx = Math.cos(aa) * 190; rock.vy = Math.sin(aa) * 190; waveTotal++;
          }
        } else { const n = e.phase2 ? 36 : 24; for (let i = 0; i < n; i++) shootEnemy(e.x, e.y, i * TAU / n + e.rot, 140, true); }
        sfx('bossShot');
      }
    } else if (id === 'queen') {
      e.stateT -= dt;
      if (e.state === 'orbit') {
        e.orbitA += dt * 1.1;
        const tx = p.x + Math.cos(e.orbitA) * 340, ty = p.y + Math.sin(e.orbitA) * 260;
        e.x += (tx - e.x) * Math.min(1, dt * 2.2); e.y += (ty - e.y) * Math.min(1, dt * 2.2);
        if (e.attackT <= 0) {
          e.attackT = .09 * bossTempo(e);
          e.spiral += .33;
          shootEnemy(e.x, e.y, e.spiral, 210);
          if (e.phase2) shootEnemy(e.x, e.y, e.spiral + Math.PI, 210);
        }
        if (e.stateT <= 0) { e.state = 'aim'; e.stateT = .75; e.chargeA = Math.atan2(p.y - e.y, p.x - e.x); }
      } else if (e.state === 'aim') {
        e.chargeA += angDiff(e.chargeA, Math.atan2(p.y - e.y, p.x - e.x)) * Math.min(1, dt * 3);
        if (e.stateT <= 0) { e.state = 'charge'; e.stateT = .55; sfx('dash'); }
      } else if (e.state === 'charge') {
        e.x += Math.cos(e.chargeA) * 860 * dt; e.y += Math.sin(e.chargeA) * 860 * dt;
        if (Math.random() < .5) burst(e.x, e.y, 2, e.def.color, 80, 3);
        if (e.stateT <= 0) {
          e.state = 'orbit'; e.stateT = 2.4; e.orbitA = Math.atan2(e.y - p.y, e.x - p.x);
          for (let i = 0; i < (e.phase2 ? 6 : 4); i++) addEnemy('swarmer', e.x + rand(-40, 40), e.y + rand(-40, 40));
        }
      }
      e.rot = e.state === 'orbit' ? e.rot + dt * 2 : e.chargeA;
    } else if (id === 'dreadnought') {
      const hx = p.x + Math.sin(e.t * .3) * 320, hy = p.y - 250;
      e.x += (hx - e.x) * Math.min(1, dt * .7); e.y += (hy - e.y) * Math.min(1, dt * .7);
      if (e.attackT <= 0) {
        e.attackT = 1.3 * bossTempo(e);
        for (const ox of [-52, 0, 52]) { const tx = e.x + ox, ty = e.y + 16; shootEnemy(tx, ty, Math.atan2(p.y - ty, p.x - tx), 300); }
        sfx('bossShot');
      }
      e.laserT -= dt;
      if (e.laserT <= 0 && !beams.some(b => b.owner === e)) {
        e.laserT = 5.5 * bossTempo(e);
        const base = Math.atan2(p.y - e.y, p.x - e.x);
        for (const off of e.phase2 ? [-.45, .45] : [0]) beams.push({ owner: e, a: base + off, off, state: 'charge', t: 1.1, color: e.def.color });
      }
    }
  }

  // Dreadnought laser: telegraphs with a thin line first, then sweeps the area.
  function updateBeams(dt) {
    const p = player;
    for (const b of beams) {
      const e = b.owner;
      if (e.dead) { b.dead = true; continue; }
      b.t -= dt;
      const want = Math.atan2(p.y - e.y, p.x - e.x) + b.off;
      b.a += angDiff(b.a, want) * Math.min(1, dt * (b.state === 'charge' ? 2.5 : e.phase2 ? .8 : .5));
      if (b.state === 'charge' && b.t <= 0) { b.state = 'fire'; b.t = 1.6; sfx('laser'); shake = Math.max(shake, 6); }
      else if (b.state === 'fire') {
        const dx = Math.cos(b.a), dy = Math.sin(b.a), rx = p.x - e.x, ry = p.y - e.y;
        const along = rx * dx + ry * dy, perp = Math.abs(rx * dy - ry * dx);
        if (along > 0 && along < 1600 && perp < 22) hurtPlayer();
        if (b.t <= 0) b.dead = true;
      }
    }
    beams = beams.filter(b => !b.dead);
  }

  function updateBullets(dt) {
    for (const b of bullets) {
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.life <= 0) { b.dead = true; continue; }
      for (const e of enemies) {
        if (e.dead || b.hit.has(e) || d2(b, e) > (b.r + e.r) ** 2) continue;
        b.hit.add(e);
        hurtEnemy(e, b.dmg);
        spark(b.x, b.y, b.color);
        if (b.pierce-- <= 0) { b.dead = true; break; }
      }
      // The rocks orbiting the Colossus block shots.
      if (!b.dead) for (const e of enemies) if (e.type === 'boss' && e.def.id === 'colossus') {
        for (const r of colossusRocks(e)) if (d2(b, r) < (b.r + 16) ** 2) { b.dead = true; spark(b.x, b.y, '#d8a46c'); break; }
      }
    }
    bullets = bullets.filter(b => !b.dead);
    const p = player;
    for (const b of enemyBullets) {
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.life <= 0 || d2(b, p) > 1500 ** 2) b.dead = true;
      else if (d2(b, p) < (b.r + p.r * .7) ** 2) { b.dead = true; hurtPlayer(); }
    }
    enemyBullets = enemyBullets.filter(b => !b.dead);
  }
  function colossusRocks(e) {
    const n = 7, out = [];
    for (let i = 0; i < n; i++) { const a = e.rot + i * TAU / n; out.push({ x: e.x + Math.cos(a) * (e.r + 40), y: e.y + Math.sin(a) * (e.r + 40) }); }
    return out;
  }

  function updateMissiles(dt) {
    for (const m of missiles) {
      m.life -= dt;
      if (!m.target || m.target.dead) m.target = nearestEnemy(m, 900);
      if (m.target) {
        const a = Math.atan2(m.target.y - m.y, m.target.x - m.x), k = Math.min(1, dt * 5);
        m.vx += (Math.cos(a) * 500 - m.vx) * k; m.vy += (Math.sin(a) * 500 - m.vy) * k;
      }
      m.x += m.vx * dt; m.y += m.vy * dt;
      if (Math.random() < .8) particles.push({ x: m.x, y: m.y, vx: rand(-20, 20), vy: rand(-20, 20), life: .4, max: .4, color: '#ff9a3d', size: 6 });
      const hit = enemies.find(e => d2(e, m) < (e.r + 6) ** 2);
      if (hit || m.life <= 0) {
        m.dead = true;
        rings.push({ x: m.x, y: m.y, r: 6, max: 64, life: .3, color: '#ff9a3d', w: 3 });
        flashAt(m.x, m.y, '#ff9a3d', 70);
        for (const e of enemies) if (d2(e, m) < (64 + e.r) ** 2) hurtEnemy(e, 3 * S.dmg());
        sfx('boom', .5);
      }
    }
    missiles = missiles.filter(m => !m.dead);
  }

  /* ---------------- Damage, kills and loot ---------------- */
  function hurtEnemy(e, dmg, showFlash = true) {
    if (e.dead) return;
    e.hp -= dmg;
    if (showFlash) e.flash = .07;
    if (e.hp > 0) return;
    e.dead = true;
    waveKilled++;
    score += Math.round(e.value * (1 + (wave - 1) * .12));
    const col = enemyColor(e);
    const big = e.type === 'boss' ? 4 : e.type === 'asteroid' ? e.size / 2 : e.elite ? 1.6 : .8;
    burst(e.x, e.y, Math.round(16 * big + 8), col, 240 * Math.sqrt(big), 5);
    burst(e.x, e.y, Math.round(6 * big), '#ffffff', 120 * Math.sqrt(big), 3);
    rings.push({ x: e.x, y: e.y, r: e.r * .5, max: e.r * 2.6, life: .4, color: col, w: 3 });
    flashAt(e.x, e.y, col, e.r * 3);
    shake = Math.max(shake, e.type === 'boss' ? 26 : 3 + big * 3);
    sfx('boom', big);
    if (e.type === 'asteroid' && e.size > 1) {
      waveTotal += 2;
      for (let i = 0; i < 2; i++) {
        const c = addEnemy('asteroid', e.x, e.y, e.size - 1);
        const a = Math.atan2(e.vy, e.vx) + (i ? .7 : -.7), sp = Math.hypot(e.vx, e.vy) * 1.35 + 25;
        c.vx = Math.cos(a) * sp; c.vy = Math.sin(a) * sp;
      }
    }
    dropLoot(e);
  }

  function rollRarity(min = 0) {
    const pool = RARITY.slice(min);
    let r = Math.random() * pool.reduce((s, x) => s + x.w, 0);
    for (const x of pool) { if ((r -= x.w) <= 0) return x.id; }
    return pool[0].id;
  }
  function dropLoot(e) {
    if (e.type === 'boss') {
      score += 2500 * wave;
      for (let i = 0; i < 2; i++) addPickup('upgrade', e.x + rand(-80, 80), e.y + rand(-60, 60), rollRarity(1));
      addPickup('power', e.x, e.y, pick(Object.keys(POWERS)));
      for (let i = 0; i < 10; i++) addPickup('gem', e.x + rand(-90, 90), e.y + rand(-90, 90));
      banner = { title: `${e.def.name.toUpperCase()} DESTROYED`, sub: 'Dropped rare-or-better loot', t: 2.4, color: e.def.color };
      return;
    }
    if (e.elite) { if (eliteDrop()) addPickup('upgrade', e.x, e.y, rollRarity(1)); else addPickup('power', e.x, e.y, pick(Object.keys(POWERS))); return; }
    const r = Math.random();
    if (r < .032) addPickup('upgrade', e.x, e.y, rollRarity());
    else if (r < .065) addPickup('power', e.x, e.y, pick(Object.keys(POWERS)));
    else if (r < .08 && player.hp < S.maxHp()) addPickup('heart', e.x, e.y);
    else if (r < .24) addPickup('gem', e.x, e.y);
  }
  // Random reward for clearing a wave.
  function waveReward() {
    const r = Math.random(), x = player.x + rand(-140, 140), y = player.y + rand(-140, 140);
    if (r < .35 && !god) { const rar = rollRarity(); addPickup('upgrade', x, y, rar); return `${byId(RARITY, rar).name.toLowerCase()} capsule nearby`; }
    if (r < .62) { const k = pick(Object.keys(POWERS)); addPickup('power', x, y, k); return `power-up: ${POWERS[k].name}`; }
    for (let i = 0; i < 8; i++) addPickup('gem', player.x + rand(-180, 180), player.y + rand(-180, 180));
    return 'crystal shower';
  }
  function addPickup(kind, x, y, sub) {
    const life = { upgrade: 28, power: 16, heart: 15, gem: 12 }[kind];
    pickups.push({ kind, sub, x: clamp(x, 40, WORLD - 40), y: clamp(y, 40, WORLD - 40), vx: rand(-40, 40), vy: rand(-40, 40), life, t: rand(0, 3) });
  }

  function hurtPlayer() {
    const p = player;
    if (god || p.invuln > 0) return;
    if (p.shield > 0) {
      p.shield--; p.shieldT = S.shieldRegen(); p.invuln = .6;
      rings.push({ x: p.x, y: p.y, r: 20, max: 80, life: .35, color: '#46f0d0', w: 4 });
      sfx('shield');
      return;
    }
    p.hp--; p.invuln = 1.5; shake = Math.max(shake, 16); flash = .25;
    burst(p.x, p.y, 24, '#ff5a6e', 220, 4);
    sfx('hurt');
    if (p.hp <= 0) gameOver();
  }

  function updatePickups(dt) {
    const p = player, magnet = powers.magnet > 0;
    for (const c of pickups) {
      c.t += dt; c.life -= dt;
      const d = Math.sqrt(d2(c, p)) || 1, reach = magnet ? 2200 : c.kind === 'gem' ? 200 : 150;
      if (d < reach) { const k = (magnet ? 1400 : (1 - d / reach) * 1000) * dt; c.vx += (p.x - c.x) / d * k; c.vy += (p.y - c.y) / d * k; }
      c.vx *= .95; c.vy *= .95;
      c.x += c.vx * dt; c.y += c.vy * dt;
      if (d < p.r + 18) { c.dead = true; collect(c); }
      else if (c.life <= 0) c.dead = true;
    }
    pickups = pickups.filter(c => !c.dead);
  }

  function grantLevels(n, distinct) {
    const got = [];
    for (let i = 0; i < n; i++) {
      const options = UPGRADES.filter(u => up[u.id] < MAX_LVL && (!distinct || !got.includes(u)));
      const u = !distinct && got.length && up[got[0].id] < MAX_LVL ? got[0] : pick(options.length ? options : UPGRADES.filter(x => up[x.id] < MAX_LVL));
      if (!u) break;
      up[u.id]++;
      if (u.id === 'armor') player.hp = Math.min(S.maxHp(), player.hp + 1);
      if (u.id === 'shield') { player.shield = Math.min(up.shield, player.shield + 1); player.shieldT = S.shieldRegen(); }
      got.push(u);
    }
    return got;
  }

  function collect(c) {
    const p = player;
    if (c.kind === 'gem') { score += 25 * wave; sfx('gem'); return; }
    if (c.kind === 'heart') { p.hp = Math.min(S.maxHp(), p.hp + 1); toast('REPAIR', '+1 health', '#ff5a6e'); sfx('pickup'); return; }
    if (c.kind === 'power') {
      const pw = POWERS[c.sub];
      if (c.sub === 'bomb') { shockwave(p.x, p.y, 650, 30 * S.dmg(), '#ff5a6e'); flash = .3; shake = Math.max(shake, 18); sfx('bomb'); }
      else { powers[c.sub] = pw.dur; sfx('power'); }
      toast(`${pw.icon}  ${pw.name.toUpperCase()}`, pw.desc, pw.color);
      return;
    }
    // Upgrade capsule: the reward depends on its rarity.
    const rar = byId(RARITY, c.sub);
    if (levels() >= TOTAL_LVLS) { score += 1000 * wave; return; }
    let got;
    if (rar.id === 'common') got = grantLevels(1, true);
    else if (rar.id === 'rare') got = grantLevels(2, true);
    else if (rar.id === 'epic') got = grantLevels(2, false);
    else { got = grantLevels(3, true); p.hp = S.maxHp(); p.invuln = 3; }
    const names = [...new Set(got.map(u => u.name))].map(n => { const u = UPGRADES.find(x => x.name === n); return `${n} Lv ${up[u.id]}`; });
    toast(`${rar.name.toUpperCase()} · ${got[0] ? got[0].icon : ''} ${got.length > 1 && rar.id !== 'epic' ? got.length + ' UPGRADES' : got[0] ? got[0].name.toUpperCase() : ''}`,
      rar.id === 'epic' && got[0] ? `${got[0].name} +2 · ${got[0].text(up[got[0].id])}` : names.join(' · '), rar.color);
    const col = rar.color;
    burst(p.x, p.y, 30, col, 280, 4);
    rings.push({ x: p.x, y: p.y, r: 12, max: rar.id === 'legendary' ? 220 : 100, life: .5, color: col, w: 4 });
    sfx(rar.id === 'legendary' || rar.id === 'epic' ? 'rare' : 'pickup');
    if (levels() >= TOTAL_LVLS) ascend();
  }

  function ascend() {
    god = true; ascendT = 4;
    player.hp = S.maxHp();
    banner = { title: 'SHIP ASCENDED!', sub: 'Every upgrade maxed out: you are now invincible', t: 4, color: '#ffd166' };
    rings.push({ x: player.x, y: player.y, r: 20, max: 1100, life: 1.3, color: '#ffd166', w: 8 });
    for (const e of enemies) if (e.type !== 'boss') hurtEnemy(e, 1e9);
    enemyBullets = []; flash = .5;
    sfx('ascend');
  }

  function toast(title, sub, color) {
    toasts.unshift({ title, sub, color, t: 3.4 });
    toasts.length = Math.min(toasts.length, 4);
  }

  /* ---------------- Effects ---------------- */
  function burst(x, y, n, color, speed, size) {
    for (let i = 0; i < n && particles.length < 1400; i++) {
      const a = rand(0, TAU), s = rand(.15, 1) * speed;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(.35, .9), max: .9, color, size: rand(2, size * 2.2) });
    }
  }
  const spark = (x, y, color) => burst(x, y, 3, color, 140, 2);
  const flashes = [];
  function flashAt(x, y, color, size) { flashes.push({ x, y, color, size, life: .18 }); }

  function updateFx(dt, t) {
    for (const s of particles) { s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= .96; s.vy *= .96; s.life -= dt; }
    particles = (particles || []).filter(s => s.life > 0);
    for (const r of rings) { r.life -= dt; r.r += (r.max - r.r) * Math.min(1, dt * 9); }
    rings = (rings || []).filter(r => r.life > 0);
    for (let i = flashes.length - 1; i >= 0; i--) { flashes[i].life -= dt; if (flashes[i].life <= 0) flashes.splice(i, 1); }
    for (const tt of toasts || []) tt.t -= dt;
    toasts = (toasts || []).filter(tt => tt.t > 0);
    if (banner) { banner.max ??= banner.t; banner.t -= dt; if (banner.t <= 0) banner = null; }
    shake = Math.max(0, (shake || 0) - dt * 45);
    flash = Math.max(0, (flash || 0) - dt);
    ascendT = Math.max(0, (ascendT || 0) - dt);
    if (mode === 'menu') { cam.x = WORLD / 2 + Math.cos(t * .05) * 600; cam.y = WORLD / 2 + Math.sin(t * .04) * 400; }
  }
  const trailColor = i => {
    const tr = byId(TRAILS, custom.trail);
    if (god || !tr.c) return `hsl(${Math.floor((time * 160 + i * 18) / 30) % 12 * 30} 100% 65%)`;
    return tr.c;
  };
  function enemyColor(e) {
    if (e.type === 'boss') return e.def.color;
    if (e.elite) return '#ffd166';
    return { asteroid: '#bfb6e6', drone: '#ff4f6e', swarmer: '#ff9a3d', diver: '#b48cff', shooter: '#46f0d0' }[e.type];
  }

  /* ---------------- Background: nebulae, planets and dust with depth ---------------- */
  const NEB_COLORS = ['#5b2a9e', '#1f5fa8', '#9e2a6f', '#1a7f8a', '#3b2a9e', '#7a2a9e'];
  const nebulae = Array.from({ length: 46 }, () => ({ x: rand(-600, WORLD + 600), y: rand(-600, WORLD + 600), r: rand(260, 720), c: pick(NEB_COLORS), a: rand(.12, .3) }));
  const starLayers = [.12, .25, .45].map((z, li) => ({ z, stars: Array.from({ length: 170 - li * 40 }, () => ({ x: Math.random() * 2400, y: Math.random() * 1600, s: rand(.6, 1.6) + li * .4, tw: rand(0, TAU), hue: Math.random() < .15 ? '#ffd9a8' : Math.random() < .3 ? '#a8c8ff' : '#ffffff' })) }));
  const dust = Array.from({ length: 70 }, () => ({ x: Math.random() * W, y: Math.random() * H, s: rand(.5, 1.5) }));
  const planets = [
    { x: 900, y: 1100, r: 210, base: '#3a2a8a', light: '#9a7bff', ring: true, z: .3 },
    { x: 3100, y: 2900, r: 150, base: '#14506a', light: '#6fe3ff', ring: false, z: .35 },
    { x: 2600, y: 700, r: 90, base: '#7a2a4a', light: '#ff8fb5', ring: false, z: .4 }
  ].map(p => ({ ...p, img: renderPlanet(p) }));
  function renderPlanet(p) {
    const s = Math.ceil(p.r * 2.8), c = document.createElement('canvas'); c.width = c.height = s;
    const g = c.getContext('2d'), cx = s / 2;
    const atm = g.createRadialGradient(cx, cx, p.r * .9, cx, cx, p.r * 1.35); atm.addColorStop(0, rgba(p.light, .35)); atm.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = atm; g.fillRect(0, 0, s, s);
    const body = g.createRadialGradient(cx - p.r * .4, cx - p.r * .45, p.r * .1, cx, cx, p.r);
    body.addColorStop(0, p.light); body.addColorStop(.45, p.base); body.addColorStop(1, '#05060f');
    g.fillStyle = body; g.beginPath(); g.arc(cx, cx, p.r, 0, TAU); g.fill();
    g.save(); g.beginPath(); g.arc(cx, cx, p.r, 0, TAU); g.clip(); g.globalAlpha = .18;
    for (let i = 0; i < 7; i++) { g.fillStyle = i % 2 ? p.light : '#000'; g.fillRect(0, cx - p.r + i * p.r * .3 + rand(-8, 8), s, rand(6, 20)); }
    g.restore();
    if (p.ring) { g.strokeStyle = rgba(p.light, .55); g.lineWidth = 6; g.beginPath(); g.ellipse(cx, cx, p.r * 1.3, p.r * .32, -.35, 0, TAU); g.stroke(); g.strokeStyle = rgba(p.light, .25); g.lineWidth = 14; g.beginPath(); g.ellipse(cx, cx, p.r * 1.45, p.r * .38, -.35, 0, TAU); g.stroke(); }
    return c;
  }
  const vignette = (() => {
    const c = document.createElement('canvas'); c.width = W / 2; c.height = H / 2;
    const g = c.getContext('2d'), gr = g.createRadialGradient(W / 4, H / 4, H * .2, W / 4, H / 4, W * .32);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(2,2,10,.75)');
    g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
    return c;
  })();

  function drawBackground(t) {
    ctx.fillStyle = '#04040c'; ctx.fillRect(0, 0, W, H);
    // Nebulae at mid depth (parallax 0.5)
    ctx.globalCompositeOperation = 'lighter';
    const nz = .5;
    for (const n of nebulae) {
      const sx = W / 2 + (n.x - cam.x) * nz, sy = H / 2 + (n.y - cam.y) * nz;
      if (sx < -n.r || sx > W + n.r || sy < -n.r || sy > H + n.r) continue;
      glow(ctx, sx, sy, n.c, n.r, n.a);
    }
    // Stars in three parallax layers
    for (const L of starLayers) {
      const ox2 = (cam.x * L.z) % 2400, oy2 = (cam.y * L.z) % 1600;
      for (const s of L.stars) {
        const x = ((s.x - ox2) % 2400 + 2400) % 2400, y = ((s.y - oy2) % 1600 + 1600) % 1600;
        if (x > W || y > H) continue;
        const a = .45 + .35 * Math.sin(t * 1.7 + s.tw);
        ctx.globalAlpha = a; ctx.fillStyle = s.hue;
        ctx.fillRect(x, y, s.s, s.s);
        if (s.s > 1.9) glow(ctx, x, y, s.hue === '#ffffff' ? '#cfe0ff' : s.hue, 6, a * .6);
      }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    // Distant planets
    for (const p of planets) {
      const x = W / 2 + (p.x - cam.x) * p.z, y = H / 2 + (p.y - cam.y) * p.z, s = p.img.width;
      if (x < -s || x > W + s || y < -s || y > H + s) continue;
      ctx.globalAlpha = .62; // dimmed so they don't compete with the action
      ctx.drawImage(p.img, x - s / 2, y - s / 2);
      ctx.globalAlpha = 1;
    }
    // Nearby space dust: gives a sense of speed
    ctx.fillStyle = '#9fb4ff';
    for (const d of dust) {
      const x = ((d.x - cam.x * 1.1) % W + W) % W, y = ((d.y - cam.y * 1.1) % H + H) % H;
      ctx.globalAlpha = .25 * d.s; ctx.fillRect(x, y, d.s * 1.4, d.s * 1.4);
    }
    ctx.globalAlpha = 1;
  }

  /* ---------------- World rendering ---------------- */
  function draw(t) {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    drawBackground(t);
    if (mode !== 'menu') {
      ctx.save();
      const sh = shake * .5;
      ctx.translate(Math.round(W / 2 - cam.x + rand(-sh, sh)), Math.round(H / 2 - cam.y + rand(-sh, sh)));
      drawBorder(t);
      drawPickups(t);
      for (const e of enemies) if (inView(e.x, e.y, e.r + 80)) drawEnemy(e, t);
      drawBeams(t);
      ctx.globalCompositeOperation = 'lighter';
      for (const b of enemyBullets) if (inView(b.x, b.y, 20)) { glow(ctx, b.x, b.y, '#ff3d8b', b.r * 3.4, .9); ctx.fillStyle = '#ffe1f0'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r * .55, 0, TAU); ctx.fill(); }
      for (const b of bullets) {
        if (!inView(b.x, b.y, 30)) continue;
        ctx.strokeStyle = b.color; ctx.lineWidth = b.r * 1.2; ctx.lineCap = 'round'; ctx.globalAlpha = .9;
        ctx.beginPath(); ctx.moveTo(b.x - b.vx * .028, b.y - b.vy * .028); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.globalAlpha = 1; glow(ctx, b.x, b.y, b.color, b.r * 4, .8);
      }
      for (const m of missiles) glow(ctx, m.x, m.y, '#ff9a3d', 16, 1);
      for (const s of particles) { if (!inView(s.x, s.y, 20)) continue; glow(ctx, s.x, s.y, s.color, s.size, Math.max(0, s.life / s.max)); }
      for (const f of flashes) glow(ctx, f.x, f.y, f.color, f.size * (1.4 - f.life * 2), f.life * 4);
      for (const r of rings) { ctx.strokeStyle = r.color; ctx.globalAlpha = Math.max(0, r.life * 1.8); ctx.lineWidth = r.w || 3; ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, TAU); ctx.stroke(); }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      if (mode !== 'over') drawPlayerInWorld(t);
      ctx.restore();
    }
    ctx.drawImage(vignette, 0, 0, W, H);
    if (mode === 'play' || mode === 'pause') drawHud(t);
    if (flash > 0) { ctx.fillStyle = `rgba(255,${god ? 220 : 80},${god ? 120 : 110},${flash * .35})`; ctx.fillRect(0, 0, W, H); }
    if (ascendT > 0) { ctx.fillStyle = `rgba(255,209,102,${ascendT * .05})`; ctx.fillRect(0, 0, W, H); }
  }

  function drawBorder(t) {
    // Energy barrier at the sector edges (only visible up close)
    const m = 400;
    if (cam.x - W / 2 > m && cam.y - H / 2 > m && cam.x + W / 2 < WORLD - m && cam.y + H / 2 < WORLD - m) return;
    ctx.save();
    ctx.strokeStyle = rgba('#46f0d0', .35 + .15 * Math.sin(t * 3)); ctx.lineWidth = 4; ctx.setLineDash([24, 14]); ctx.lineDashOffset = -t * 40;
    ctx.strokeRect(0, 0, WORLD, WORLD);
    ctx.restore();
  }

  function drawBeams(t) {
    for (const b of beams) {
      const e = b.owner, x2 = e.x + Math.cos(b.a) * 1600, y2 = e.y + Math.sin(b.a) * 1600;
      ctx.save(); ctx.lineCap = 'round';
      if (b.state === 'charge') {
        ctx.strokeStyle = rgba(b.color, .35 + .3 * Math.sin(t * 30)); ctx.lineWidth = 2; ctx.setLineDash([10, 10]);
        ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(x2, y2); ctx.stroke();
      } else {
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = rgba(b.color, .25); ctx.lineWidth = 60; ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.strokeStyle = rgba(b.color, .6); ctx.lineWidth = 26; ctx.stroke();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 8 + Math.sin(t * 50) * 2; ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawEnemy(e, t) {
    const hit = e.flash > 0, col = enemyColor(e);
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, 0, 0, col, e.r * (e.type === 'boss' ? 2.6 : 2.2), e.type === 'asteroid' ? .18 : .45);
    ctx.globalCompositeOperation = 'source-over';
    if (e.elite) { ctx.strokeStyle = rgba('#ffd166', .6 + .3 * Math.sin(t * 6)); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, e.r + 7, 0, TAU); ctx.stroke(); }
    if (e.type === 'asteroid') {
      ctx.rotate(e.rot);
      ctx.beginPath();
      e.shape.forEach((k, i) => { const a = i / e.shape.length * TAU; ctx.lineTo(Math.cos(a) * e.r * k, Math.sin(a) * e.r * k); });
      ctx.closePath();
      const g = ctx.createRadialGradient(-e.r * .35, -e.r * .4, e.r * .1, 0, 0, e.r * 1.1);
      g.addColorStop(0, hit ? '#ffffff' : '#8d84b8'); g.addColorStop(.55, hit ? '#ffffff' : '#3a3358'); g.addColorStop(1, '#12101f');
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = rgba('#c9c0ff', .35); ctx.lineWidth = 1.5; ctx.stroke();
      for (const c of e.craters) { ctx.fillStyle = 'rgba(10,8,20,.35)'; ctx.beginPath(); ctx.arc(Math.cos(c.a) * e.r * c.d, Math.sin(c.a) * e.r * c.d, e.r * c.r, 0, TAU); ctx.fill(); }
    } else if (e.type === 'drone' || e.type === 'swarmer') {
      ctx.rotate(e.rot);
      const r = e.r;
      const g = ctx.createLinearGradient(-r, 0, r * 1.3, 0); g.addColorStop(0, '#1b0b18'); g.addColorStop(1, hit ? '#fff' : shade(col, .75));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(r * 1.35, 0); ctx.quadraticCurveTo(0, r * .3, -r, r); ctx.lineTo(-r * .45, 0); ctx.lineTo(-r, -r); ctx.quadraticCurveTo(0, -r * .3, r * 1.35, 0); ctx.fill();
      ctx.strokeStyle = shade(col, 1.3); ctx.lineWidth = 1.2; ctx.stroke();
      ctx.globalCompositeOperation = 'lighter'; glow(ctx, r * .25, 0, col, r * .8, 1); glow(ctx, -r * .7, 0, col, r * .6, .7);
    } else if (e.type === 'diver') {
      ctx.rotate(e.rot - Math.PI / 2);
      const flap = Math.sin(t * 18 + e.seed * 9) * .35, s = e.r / 16;
      ctx.scale(s, s);
      for (const sd of [-1, 1]) {
        ctx.save(); ctx.scale(sd, 1); ctx.rotate(flap);
        const wg = ctx.createLinearGradient(0, 0, 24, 0); wg.addColorStop(0, rgba(col, .85)); wg.addColorStop(1, rgba(col, .15));
        ctx.fillStyle = wg; ctx.beginPath(); ctx.ellipse(12, -3, 13, 7, -.45, 0, TAU); ctx.fill();
        ctx.strokeStyle = rgba('#e3d4ff', .5); ctx.lineWidth = 1; ctx.stroke();
        ctx.restore();
      }
      const bg = ctx.createLinearGradient(0, -14, 0, 14); bg.addColorStop(0, hit ? '#fff' : '#e4d6ff'); bg.addColorStop(1, '#3b1f7a');
      ctx.fillStyle = bg; ctx.beginPath(); ctx.ellipse(0, 0, 6.5, 14, 0, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'lighter'; glow(ctx, -3, 8, '#ffe36e', 4, 1); glow(ctx, 3, 8, '#ffe36e', 4, 1);
    } else if (e.type === 'shooter') {
      ctx.save(); ctx.rotate(t * .8);
      ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = i * TAU / 6; ctx.lineTo(Math.cos(a) * e.r, Math.sin(a) * e.r); } ctx.closePath();
      const g = ctx.createRadialGradient(-5, -6, 2, 0, 0, e.r); g.addColorStop(0, hit ? '#fff' : '#5ef5dc'); g.addColorStop(.6, '#0f3a3c'); g.addColorStop(1, '#061a1c');
      ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = rgba(col, .8); ctx.lineWidth = 1.5; ctx.stroke();
      ctx.restore();
      ctx.rotate(e.rot);
      ctx.fillStyle = '#0c2224'; ctx.fillRect(2, -4, e.r + 6, 8);
      ctx.fillStyle = col; ctx.fillRect(e.r + 2, -3, 6, 6);
      ctx.globalCompositeOperation = 'lighter'; glow(ctx, 0, 0, col, 12, 1);
    } else if (e.type === 'boss') drawBoss(e, t, hit);
    ctx.restore();
    // Elite health bar
    if (e.elite && e.hp < e.maxHp) { ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(e.x - 20, e.y - e.r - 14, 40, 4); ctx.fillStyle = '#ffd166'; ctx.fillRect(e.x - 20, e.y - e.r - 14, 40 * e.hp / e.maxHp, 4); }
  }

  function drawBoss(e, t, hit) {
    const id = e.def.id, col = e.def.color, r = e.r;
    if (id === 'mothership') {
      ctx.save(); ctx.rotate(e.rot);
      for (let i = 0; i < 8; i++) { ctx.rotate(TAU / 8); ctx.fillStyle = shade(col, .6); ctx.fillRect(r * .82, -6, 18, 12); ctx.fillStyle = col; ctx.fillRect(r * .82 + 14, -3, 6, 6); }
      ctx.restore();
      const g = ctx.createRadialGradient(-r * .3, -r * .35, r * .1, 0, 0, r);
      g.addColorStop(0, hit ? '#fff' : '#ff9bd0'); g.addColorStop(.5, '#5a1650'); g.addColorStop(1, '#1a0618');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, r, r * .58, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = rgba(col, .8); ctx.lineWidth = 2; ctx.stroke();
      const dome = ctx.createLinearGradient(0, -r * .5, 0, 0); dome.addColorStop(0, 'rgba(255,220,240,.9)'); dome.addColorStop(1, 'rgba(255,79,163,.2)');
      ctx.fillStyle = dome; ctx.beginPath(); ctx.ellipse(0, -8, r * .45, r * .36, 0, Math.PI, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'lighter'; glow(ctx, 0, 8, '#ffe36e', 22 + Math.sin(t * 6) * 4, 1);
    } else if (id === 'colossus') {
      for (const rk of colossusRocks(e)) {
        const x = rk.x - e.x, y = rk.y - e.y, g = ctx.createRadialGradient(x - 5, y - 6, 2, x, y, 18);
        g.addColorStop(0, '#e8c49a'); g.addColorStop(1, '#3a2614'); ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, 16, 0, TAU); ctx.fill();
      }
      ctx.rotate(e.rot * .3);
      ctx.beginPath(); for (let i = 0; i < 14; i++) { const a = i / 14 * TAU, k = .82 + .18 * Math.sin(i * 2.7); ctx.lineTo(Math.cos(a) * r * k, Math.sin(a) * r * k); } ctx.closePath();
      const g = ctx.createRadialGradient(-r * .35, -r * .4, r * .1, 0, 0, r * 1.05);
      g.addColorStop(0, hit ? '#fff' : '#f0c896'); g.addColorStop(.55, '#6a4224'); g.addColorStop(1, '#1c1008');
      ctx.fillStyle = g; ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 5; i++) { const a = i * 1.3 + t * .2; glow(ctx, Math.cos(a) * r * .45, Math.sin(a) * r * .45, '#ff7a2e', 14, .7); }
      glow(ctx, 0, 0, e.phase2 ? '#ff3d3d' : '#ff9a3d', 34, .9);
    } else if (id === 'queen') {
      ctx.rotate(e.state === 'orbit' ? Math.PI / 2 : e.rot - Math.PI / 2);
      const flap = Math.sin(t * 14) * .3;
      for (const sd of [-1, 1]) for (const k of [0, 1]) {
        ctx.save(); ctx.scale(sd, 1); ctx.rotate(flap * (k ? -1 : 1) + (k ? .6 : -.1));
        const wg = ctx.createLinearGradient(0, 0, r * 1.6, 0); wg.addColorStop(0, rgba(col, .9)); wg.addColorStop(1, rgba('#ff6fd0', .1));
        ctx.fillStyle = wg; ctx.beginPath(); ctx.ellipse(r * .8, k ? 12 : -10, r * .9, r * .38, k ? .5 : -.3, 0, TAU); ctx.fill();
        ctx.restore();
      }
      const bg = ctx.createLinearGradient(0, -r, 0, r); bg.addColorStop(0, hit ? '#fff' : '#f0e4ff'); bg.addColorStop(.5, '#7a4adf'); bg.addColorStop(1, '#240c4a');
      ctx.fillStyle = bg; ctx.beginPath(); ctx.ellipse(0, 0, r * .42, r * 1.05, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.moveTo(-14, -r * .9); ctx.lineTo(-8, -r * 1.25); ctx.lineTo(0, -r * .95); ctx.lineTo(8, -r * 1.25); ctx.lineTo(14, -r * .9); ctx.fill();
      ctx.globalCompositeOperation = 'lighter'; glow(ctx, -9, -r * .55, '#ff4f6e', 9, 1); glow(ctx, 9, -r * .55, '#ff4f6e', 9, 1);
      if (e.state === 'aim') { ctx.globalCompositeOperation = 'source-over'; ctx.rotate(-(e.rot - Math.PI / 2)); }
    } else if (id === 'dreadnought') {
      const g = ctx.createLinearGradient(0, -30, 0, 30); g.addColorStop(0, hit ? '#fff' : '#9ff7e8'); g.addColorStop(.45, '#1d4f55'); g.addColorStop(1, '#071a1d');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(-r * 1.4, -10); ctx.lineTo(-r * .9, -30); ctx.lineTo(r * .9, -30); ctx.lineTo(r * 1.4, -10); ctx.lineTo(r * 1.2, 26); ctx.lineTo(-r * 1.2, 26); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = rgba(col, .8); ctx.lineWidth = 2; ctx.stroke();
      for (const ox of [-52, 0, 52]) { ctx.fillStyle = '#0b2629'; ctx.beginPath(); ctx.arc(ox, 16, 11, 0, TAU); ctx.fill(); ctx.strokeStyle = col; ctx.stroke(); }
      ctx.globalCompositeOperation = 'lighter';
      glow(ctx, 0, -6, col, 30 + Math.sin(t * 5) * 5, .9);
      for (const ox of [-r * 1.1, r * 1.1]) glow(ctx, ox, 0, '#5fd8ff', 14, .8);
    }
    // Swarm Queen charge warning
    if (id === 'queen' && e.state === 'aim') {
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.translate(W / 2 - cam.x, H / 2 - cam.y);
      ctx.strokeStyle = rgba('#ff4f6e', .4 + .4 * Math.sin(t * 40)); ctx.lineWidth = 3; ctx.setLineDash([12, 10]);
      ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + Math.cos(e.chargeA) * 900, e.y + Math.sin(e.chargeA) * 900); ctx.stroke();
    }
  }

  function drawPickups(t) {
    for (const c of pickups) {
      if (!inView(c.x, c.y, 40) || (c.life < 3 && Math.floor(t * 8) % 2)) continue;
      const y = c.y + Math.sin(c.t * 4) * 3;
      ctx.save(); ctx.translate(c.x, y);
      ctx.globalCompositeOperation = 'lighter';
      if (c.kind === 'gem') {
        glow(ctx, 0, 0, '#6fe3ff', 12, .8);
        ctx.globalCompositeOperation = 'source-over'; ctx.rotate(c.t * 2); ctx.fillStyle = '#bff3ff';
        ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, 0); ctx.lineTo(0, 6); ctx.lineTo(-4, 0); ctx.fill();
      } else if (c.kind === 'heart') {
        glow(ctx, 0, 0, '#ff5a6e', 26, .8);
        ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#ff8a9a'; ctx.font = '700 22px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('♥', 0, 1);
      } else if (c.kind === 'power') {
        const pw = POWERS[c.sub];
        glow(ctx, 0, 0, pw.color, 30, .9);
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(5,6,15,.8)'; ctx.strokeStyle = pw.color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, 13, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = pw.color; ctx.font = '700 15px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(pw.icon, 0, 1);
      } else {
        const rar = byId(RARITY, c.sub);
        glow(ctx, 0, 0, rar.color, rar.id === 'legendary' ? 54 : 38, .9);
        if (rar.id !== 'common') { ctx.save(); ctx.rotate(t * 1.2); for (let i = 0; i < 4; i++) { ctx.rotate(TAU / 4); ctx.fillStyle = rgba(rar.color, .35); ctx.fillRect(0, -1.5, 34, 3); } ctx.restore(); }
        ctx.globalCompositeOperation = 'source-over';
        ctx.rotate(t * 1.4);
        const g = ctx.createLinearGradient(-12, -12, 12, 12); g.addColorStop(0, '#ffffff'); g.addColorStop(1, rar.color);
        ctx.fillStyle = g; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.roundRect(-11, -11, 22, 22, 5); ctx.fill(); ctx.stroke();
        ctx.rotate(-t * 2.8); ctx.fillStyle = 'rgba(5,6,15,.85)'; ctx.fillRect(-4, -4, 8, 8);
      }
      ctx.restore();
      // Loot name shown when you get close
      if (c.kind !== 'gem' && d2(c, player) < 260 ** 2) {
        const label = c.kind === 'upgrade' ? `${byId(RARITY, c.sub).name} capsule` : c.kind === 'power' ? POWERS[c.sub].name : 'Repair';
        const color = c.kind === 'upgrade' ? byId(RARITY, c.sub).color : c.kind === 'power' ? POWERS[c.sub].color : '#ff8a9a';
        ctx.font = '600 11px "Chakra Petch", sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = color;
        ctx.fillText(label, c.x, y - 26);
      }
    }
  }

  /* ---------------- The ship (used both in game and in the hangar) ---------------- */
  function hullPath(c, id, span, armor) {
    c.beginPath();
    if (id === 'swift') {
      c.moveTo(0, -24); c.lineTo(3.5, -8); c.lineTo(span, 7 + armor); c.lineTo(span - 3, 10 + armor); c.lineTo(4, 8); c.lineTo(0, 10);
      c.lineTo(-4, 8); c.lineTo(-span + 3, 10 + armor); c.lineTo(-span, 7 + armor); c.lineTo(-3.5, -8);
    } else if (id === 'rhino') {
      c.moveTo(0, -16); c.lineTo(8, -14); c.lineTo(span * .7, -2); c.lineTo(span, 6); c.lineTo(span, 13 + armor); c.lineTo(7, 15); c.lineTo(0, 12);
      c.lineTo(-7, 15); c.lineTo(-span, 13 + armor); c.lineTo(-span, 6); c.lineTo(-span * .7, -2); c.lineTo(-8, -14);
    } else if (id === 'mantis') {
      c.moveTo(0, -10); c.lineTo(4, -12); c.lineTo(7, -24); c.lineTo(9, -8); c.lineTo(span, 8 + armor); c.lineTo(span * .55, 12); c.lineTo(0, 9);
      c.lineTo(-span * .55, 12); c.lineTo(-span, 8 + armor); c.lineTo(-9, -8); c.lineTo(-7, -24); c.lineTo(-4, -12);
    } else {
      c.moveTo(0, -20); c.lineTo(span * .42, 1); c.lineTo(span, 10 + armor); c.lineTo(span * .55, 13); c.lineTo(0, 9);
      c.lineTo(-span * .55, 13); c.lineTo(-span, 10 + armor); c.lineTo(-span * .42, 1);
    }
    c.closePath();
  }

  function drawShip(c, o) {
    const ch = byId(CHASSIS, o.chassis), paint = byId(PAINTS, o.paint).c, U = o.up, t = o.t;
    const tier = UPGRADES.reduce((n, u) => n + U[u.id], 0);
    const hull = o.god ? `hsl(${Math.floor(t * 90) % 360} 95% 70%)` : paint;
    const span = ch.span + U.armor * 3 + Math.min(10, tier * .25);
    const tc = o.trailColor;
    c.save();
    c.translate(o.x, o.y); c.rotate(o.aim + Math.PI / 2);
    const s = (o.scale || 1) * (1 + U.armor * .06 + (o.god ? .14 : 0));
    c.scale(s, s);
    // Engines: more and longer flames with thruster upgrades
    const flame = 12 + U.speed * 5 + Math.sin(t * 40) * 3 + (o.dash ? 20 : 0);
    const engines = U.speed >= 3 ? [-7, 0, 7] : U.speed >= 1 ? [-5, 5] : [0];
    c.globalCompositeOperation = 'lighter';
    for (const ex of engines) {
      const fg = c.createLinearGradient(0, 10, 0, 12 + flame);
      fg.addColorStop(0, '#ffffff'); fg.addColorStop(.3, tc); fg.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = fg; c.beginPath(); c.moveTo(ex - 4, 10); c.lineTo(ex + 4, 10); c.lineTo(ex, 12 + flame); c.closePath(); c.fill();
      glow(c, ex, 13, tc, 12, .9);
    }
    c.globalCompositeOperation = 'source-over';
    // Shaded hull
    hullPath(c, ch.id, span, U.armor);
    const hg = c.createLinearGradient(0, -24, 0, 16);
    hg.addColorStop(0, shade(o.god ? '#ffd166' : paint, 1.25)); hg.addColorStop(.45, shade(o.god ? '#ffd166' : paint, .55)); hg.addColorStop(1, '#0b0e22');
    c.fillStyle = hg; c.fill();
    c.save(); c.clip();
    // Hull pattern
    c.fillStyle = 'rgba(5,6,20,.45)'; c.strokeStyle = 'rgba(255,255,255,.55)';
    if (o.pattern === 'stripes') { c.fillRect(-span, 2, span * 2, 2.5); c.fillRect(-span, 7, span * 2, 2.5); }
    else if (o.pattern === 'chevron') { c.lineWidth = 2.5; c.beginPath(); c.moveTo(-span * .6, 10); c.lineTo(0, 1); c.lineTo(span * .6, 10); c.stroke(); }
    else if (o.pattern === 'eye') { c.beginPath(); c.arc(0, 4, 4.5, 0, TAU); c.fill(); c.fillStyle = shade(paint, 1.4); c.beginPath(); c.arc(0, 4, 2, 0, TAU); c.fill(); }
    // Plasma veins: change colour with the damage level
    if (U.power) { c.strokeStyle = PLASMA[U.power]; c.lineWidth = 1.2 + U.power * .3; c.globalAlpha = .9; c.beginPath(); c.moveTo(0, -14); c.lineTo(span * .7, 9); c.moveTo(0, -14); c.lineTo(-span * .7, 9); c.stroke(); c.globalAlpha = 1; }
    c.restore();
    hullPath(c, ch.id, span, U.armor);
    c.strokeStyle = shade(hull.startsWith('#') ? hull : '#ffd166', 1.35); c.lineWidth = 1.3; c.stroke();
    if (tier >= 20 || o.god) { c.strokeStyle = o.god ? '#ffd166' : shade(paint, 1.3); c.lineWidth = 1.6; c.beginPath(); c.moveTo(-6, 4); c.lineTo(-12, -13); c.lineTo(-3, -2); c.moveTo(6, 4); c.lineTo(12, -13); c.lineTo(3, -2); c.stroke(); }
    // Extra cannons, missile pods and lance
    for (let i = 1; i <= U.multi; i++) {
      const sd = i % 2 ? 1 : -1, k = Math.ceil(i / 2);
      c.fillStyle = '#1a2040'; c.fillRect(sd * (span * .32 + k * 4) - 2, -7 + k * 3, 4, 10);
      c.fillStyle = '#6fe3ff'; c.fillRect(sd * (span * .32 + k * 4) - 1, -8 + k * 3, 2, 3);
    }
    for (let i = 0; i < U.missiles; i++) { const sd = i % 2 ? 1 : -1; c.fillStyle = '#ff9a3d'; c.beginPath(); c.roundRect(sd * (span * .55 + Math.floor(i / 2) * 5) - 2, 8, 4, 8, 2); c.fill(); }
    if (U.pierce) {
      c.globalCompositeOperation = 'lighter';
      c.strokeStyle = '#d4bcff'; c.lineWidth = 2; c.beginPath(); c.moveTo(0, -20); c.lineTo(0, -20 - U.pierce * 5); c.stroke();
      glow(c, 0, -20 - U.pierce * 5, '#b48cff', 10, .9);
      c.globalCompositeOperation = 'source-over';
    }
    // Glass cockpit and core (brighter with fire-rate upgrades)
    const cg = c.createLinearGradient(0, -12, 0, 2); cg.addColorStop(0, 'rgba(230,250,255,.95)'); cg.addColorStop(1, 'rgba(60,120,200,.5)');
    c.fillStyle = cg; c.beginPath(); c.ellipse(0, -5, 3.4, 6.5, 0, 0, TAU); c.fill();
    c.globalCompositeOperation = 'lighter';
    glow(c, 0, 3, U.rate ? `hsl(${45 - U.rate * 8} 100% 60%)` : tc, 8 + U.rate * 4, .9);
    c.restore();
  }

  function drawPlayerInWorld(t) {
    const p = player;
    if (p.invuln > 0 && !god && Math.floor(t * 20) % 2) return;
    // Trail
    ctx.globalCompositeOperation = 'lighter';
    p.trail.forEach((q, i) => { const k = 1 - i / p.trail.length; glow(ctx, q.x, q.y, trailColor(i), (god ? 16 : 10) * k + 2, k * .55); });
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < up.drones; i++) {
      const dp = dronePos(i);
      ctx.save(); ctx.translate(dp.x, dp.y); ctx.rotate(t * 4);
      ctx.globalCompositeOperation = 'lighter'; glow(ctx, 0, 0, god ? '#ffd166' : '#8dff6a', 14, .8); ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = god ? '#ffe9a8' : '#d4ffc4'; ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(6, 0); ctx.lineTo(0, 7); ctx.lineTo(-6, 0); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    drawShip(ctx, { ...custom, x: p.x, y: p.y, aim: p.aim, up, t, god, dash: p.dashT > 0, trailColor: trailColor(0), scale: 1.2 });
    for (let i = 0; i < p.shield; i++) {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(t * (i % 2 ? -.8 : .8));
      ctx.strokeStyle = rgba('#46f0d0', .55 - i * .08); ctx.lineWidth = 2;
      const R = 28 + up.armor * 2 + i * 6;
      ctx.beginPath(); for (let k = 0; k < 6; k++) { const a = k * TAU / 6; ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R); } ctx.closePath(); ctx.stroke();
      ctx.fillStyle = rgba('#46f0d0', .04); ctx.fill();
      ctx.restore();
    }
    if (up.nova) {
      const k = 1 - Math.max(0, p.novaT) / S.novaCd();
      ctx.strokeStyle = rgba('#e8f75a', .15 + k * .4); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 40 + up.armor * 2, -Math.PI / 2, -Math.PI / 2 + k * TAU); ctx.stroke();
    }
    if (p.dashCd > 0) {
      ctx.strokeStyle = rgba('#6fe3ff', .5); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 21, -Math.PI / 2, -Math.PI / 2 + (1 - p.dashCd / S.dashCd()) * TAU); ctx.stroke();
    }
  }

  /* ---------------- HUD ---------------- */
  function panel(x, y, w, h, r = 12) {
    ctx.fillStyle = 'rgba(10,12,32,.55)'; ctx.strokeStyle = 'rgba(255,255,255,.09)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); ctx.stroke();
  }
  const FONT = '"Chakra Petch", "Barlow Condensed", sans-serif';

  function drawHud(t) {
    const p = player;
    ctx.save();
    ctx.textBaseline = 'top';
    // Health, shield and power-ups
    const maxHp = S.maxHp();
    panel(18, 16, 40 + maxHp * 26, up.shield ? 64 : 44);
    for (let i = 0; i < maxHp; i++) {
      const on = i < p.hp, c = god ? '#ffd166' : '#ff4f6e';
      ctx.fillStyle = on ? c : 'rgba(255,255,255,.08)'; ctx.beginPath(); ctx.roundRect(32 + i * 26, 30, 20, 14, 3); ctx.fill();
      if (on) { ctx.globalCompositeOperation = 'lighter'; glow(ctx, 42 + i * 26, 37, c, 14, .35); ctx.globalCompositeOperation = 'source-over'; }
    }
    for (let i = 0; i < up.shield; i++) { ctx.fillStyle = i < p.shield ? '#46f0d0' : 'rgba(255,255,255,.08)'; ctx.beginPath(); ctx.roundRect(32 + i * 26, 52, 20, 6, 3); ctx.fill(); }
    let px = 18;
    for (const k of Object.keys(powers)) if (powers[k] > 0) {
      const pw = POWERS[k];
      panel(px, up.shield ? 88 : 68, 120, 26, 8);
      ctx.fillStyle = pw.color; ctx.font = `600 12px ${FONT}`; ctx.fillText(`${pw.icon} ${pw.name}`, px + 10, (up.shield ? 88 : 68) + 6);
      ctx.fillRect(px + 10, (up.shield ? 88 : 68) + 21, 100 * powers[k] / pw.dur, 2);
      px += 128;
    }
    // Wave
    ctx.textAlign = 'center';
    ctx.font = `700 26px ${FONT}`; ctx.fillStyle = '#f2f0ff';
    ctx.fillText(`WAVE ${wave}`, W / 2, 14);
    const prog = waveTotal ? clamp(waveKilled / waveTotal, 0, 1) : 0;
    ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.beginPath(); ctx.roundRect(W / 2 - 110, 48, 220, 4, 2); ctx.fill();
    const pg = ctx.createLinearGradient(W / 2 - 110, 0, W / 2 + 110, 0); pg.addColorStop(0, '#46f0d0'); pg.addColorStop(1, '#6fa8ff');
    ctx.fillStyle = pg; ctx.beginPath(); ctx.roundRect(W / 2 - 110, 48, 220 * prog, 4, 2); ctx.fill();
    // Boss health bars
    enemies.filter(e => e.type === 'boss').forEach((b, i) => {
      const y = 62 + i * 28;
      ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.beginPath(); ctx.roundRect(W / 2 - 260, y, 520, 8, 4); ctx.fill();
      const bg = ctx.createLinearGradient(W / 2 - 260, 0, W / 2 + 260, 0); bg.addColorStop(0, b.def.color); bg.addColorStop(1, '#ffffff');
      ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(W / 2 - 260, y, 520 * Math.max(0, b.hp / b.maxHp), 8, 4); ctx.fill();
      ctx.font = `600 11px ${FONT}`; ctx.fillStyle = b.def.color; ctx.fillText(`${b.def.name.toUpperCase()}${b.phase2 ? ' · PHASE 2' : ''}`, W / 2, y + 11);
    });
    // Score
    ctx.textAlign = 'right';
    ctx.font = `700 28px ${FONT}`; ctx.fillStyle = '#e8f75a';
    ctx.fillText(String(score).padStart(7, '0'), W - 260, 12);
    ctx.font = `500 10px ${FONT}`; ctx.fillStyle = '#a5a2bd';
    ctx.fillText(`BEST ${Math.max(best, score)}${autoFire ? ' · AUTO-FIRE' : ''}`, W - 260, 46);
    // Upgrades
    ctx.textAlign = 'left';
    panel(14, H - 88, 404, 74);
    ctx.font = `600 10px ${FONT}`; ctx.fillStyle = god ? '#ffd166' : '#a5a2bd';
    ctx.fillText(god ? 'ASCENDED · INVINCIBLE' : `ASCENSION ${levels()}/${TOTAL_LVLS}`, 26, H - 80);
    UPGRADES.forEach((u, i) => {
      const x = 26 + i * 39, y = H - 62, l = up[u.id];
      ctx.globalAlpha = l ? 1 : .25;
      ctx.fillStyle = rgba(u.color, l ? .14 : .05); ctx.strokeStyle = u.color; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.roundRect(x, y, 32, 32, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = u.color; ctx.font = '700 16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(u.icon, x + 16, y + 16);
      for (let k = 0; k < MAX_LVL; k++) { ctx.fillStyle = k < l ? u.color : 'rgba(255,255,255,.12)'; ctx.fillRect(x + 2 + k * 7.5, y + 36, 6, 2.5); }
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    });
    ctx.globalAlpha = 1;
    drawRadar();
    drawIndicators(t);
    // Toast notifications
    toasts.forEach((tt, i) => {
      const w = 340, x = W - w - 190, y = H - 64 - i * 52, a = Math.min(1, tt.t * 2);
      ctx.globalAlpha = a;
      panel(x, y, w, 44, 10);
      ctx.fillStyle = tt.color; ctx.beginPath(); ctx.roundRect(x, y, 4, 44, 2); ctx.fill();
      ctx.font = `700 15px ${FONT}`; ctx.fillText(tt.title, x + 14, y + 6);
      ctx.font = `500 10px ${FONT}`; ctx.fillStyle = '#cfcbe3'; ctx.fillText(tt.sub.slice(0, 56), x + 14, y + 26);
    });
    ctx.globalAlpha = 1;
    // Centre-screen banner
    if (banner) {
      banner.max ??= banner.t;
      const a = clamp(Math.min(1, banner.t * 2, (banner.max - banner.t) * 4 + .2), 0, 1);
      ctx.globalAlpha = a; ctx.textAlign = 'center';
      ctx.font = `700 58px ${FONT}`;
      ctx.globalCompositeOperation = 'lighter'; glow(ctx, W / 2, H * .34 + 30, banner.color, 260, .18); ctx.globalCompositeOperation = 'source-over';
      const g = ctx.createLinearGradient(0, H * .34, 0, H * .34 + 60); g.addColorStop(0, '#ffffff'); g.addColorStop(1, banner.color);
      ctx.fillStyle = g; ctx.fillText(banner.title, W / 2, H * .34);
      ctx.font = `500 13px ${FONT}`; ctx.fillStyle = '#e8e5f8'; ctx.fillText(banner.sub, W / 2, H * .34 + 66);
      ctx.globalAlpha = 1;
    }
    // Crosshair
    if (mouse.used && mode === 'play') {
      ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(mouse.x, mouse.y, 9, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mouse.x - 15, mouse.y); ctx.lineTo(mouse.x - 5, mouse.y); ctx.moveTo(mouse.x + 5, mouse.y); ctx.lineTo(mouse.x + 15, mouse.y);
      ctx.moveTo(mouse.x, mouse.y - 15); ctx.lineTo(mouse.x, mouse.y - 5); ctx.moveTo(mouse.x, mouse.y + 5); ctx.lineTo(mouse.x, mouse.y + 15); ctx.stroke();
    }
    ctx.restore();
  }

  function drawRadar() {
    const R = 74, cx = W - 96, cy = H - 96, k = R / 1500;
    ctx.fillStyle = 'rgba(10,12,32,.6)'; ctx.strokeStyle = 'rgba(70,240,208,.25)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R / 2, 0, TAU); ctx.stroke();
    // Outline of the area currently on screen
    ctx.strokeRect(cx + (cam.x - W / 2 - player.x) * k, cy + (cam.y - H / 2 - player.y) * k, W * k, H * k);
    const dot = (x, y, c, s) => { const dx = (x - player.x) * k, dy = (y - player.y) * k; const m = Math.hypot(dx, dy); const f = m > R - 3 ? (R - 3) / m : 1; ctx.fillStyle = c; ctx.fillRect(cx + dx * f - s / 2, cy + dy * f - s / 2, s, s); };
    for (const c of pickups) if (c.kind === 'upgrade') dot(c.x, c.y, byId(RARITY, c.sub).color, 4);
    for (const e of enemies) dot(e.x, e.y, e.type === 'boss' ? e.def.color : e.elite ? '#ffd166' : '#ff4f6e', e.type === 'boss' ? 7 : e.elite ? 4 : 2.5);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(cx - 2, cy - 2, 4, 4);
  }

  // Arrows at the screen edge pointing to off-screen bosses and capsules.
  function drawIndicators(t) {
    const marks = [];
    const few = !waveQueue.length && enemies.length <= 3; // last enemies of the wave: mark them all
    for (const e of enemies) if (e.type === 'boss' || e.elite || few) marks.push({ x: e.x, y: e.y, c: e.type === 'boss' ? e.def.color : '#ffd166', s: e.type === 'boss' ? 12 : 7 });
    for (const c of pickups) if (c.kind === 'upgrade' || c.kind === 'power') marks.push({ x: c.x, y: c.y, c: c.kind === 'upgrade' ? byId(RARITY, c.sub).color : POWERS[c.sub].color, s: 7 });
    for (const m of marks) {
      if (inView(m.x, m.y, -10)) continue;
      const sx = m.x - cam.x, sy = m.y - cam.y, a = Math.atan2(sy, sx);
      const f = Math.min((W / 2 - 30) / Math.abs(sx || 1e-6), (H / 2 - 30) / Math.abs(sy || 1e-6));
      const x = W / 2 + sx * f, y = H / 2 + sy * f;
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.fillStyle = m.c; ctx.globalAlpha = .65 + .3 * Math.sin(t * 6);
      ctx.beginPath(); ctx.moveTo(m.s, 0); ctx.lineTo(-m.s * .7, m.s * .7); ctx.lineTo(-m.s * .7, -m.s * .7); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  /* ---------------- Hangar ---------------- */
  const preview = $('#preview'), pctx = preview.getContext('2d');
  const showcase = Object.fromEntries(UPGRADES.map(u => [u.id, 0]));
  function drawPreview(t) {
    const w = preview.width, h = preview.height;
    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.clearRect(0, 0, w, h);
    pctx.globalCompositeOperation = 'lighter';
    const tr = byId(TRAILS, custom.trail);
    const rainbow = i => `hsl(${Math.floor((t * 160 + i * 18) / 30) % 12 * 30} 100% 65%)`;
    for (let i = 0; i < 16; i++) {
      const col = tr.c || rainbow(i);
      glow(pctx, w / 2, h / 2 + 40 + i * 9, col, 26 * (1 - i / 16) + 3, (1 - i / 16) * .45);
    }
    pctx.globalCompositeOperation = 'source-over';
    drawShip(pctx, { ...custom, x: w / 2, y: h / 2 - 6 + Math.sin(t * 2) * 5, aim: -Math.PI / 2 + Math.sin(t * .9) * .25, up: showcase, t, god: false, scale: 3.6, trailColor: tr.c || rainbow(0) });
  }

  function buildHangar() {
    const ch = chassis();
    $('#shipName').textContent = ch.name; $('#shipRole').textContent = ch.role; $('#shipDesc').textContent = ch.desc;
    const bars = [['Health', ch.hp / 5], ['Speed', ch.speed / 1.25], ['Fire rate', ch.rate / 1.3], ['Damage', ch.dmg / 1.4]];
    $('#shipBars').innerHTML = bars.map(([n, v]) => `<div class="bar">${n}<i><b style="width:${Math.round(v * 100)}%"></b></i></div>`).join('');
    $('#chassisPick').innerHTML = CHASSIS.map(c => `<button type="button" data-chassis="${c.id}" aria-pressed="${c.id === custom.chassis}">${c.name}<small>${c.role}</small></button>`).join('');
    $('#paintPick').innerHTML = PAINTS.map(p => `<button type="button" class="swatch" data-paint="${p.id}" aria-label="${p.name}" title="${p.name}" aria-pressed="${p.id === custom.paint}" style="background:${p.c}"></button>`).join('');
    $('#trailPick').innerHTML = TRAILS.map(p => `<button type="button" class="swatch" data-trail="${p.id}" aria-label="${p.name}" title="${p.name}" aria-pressed="${p.id === custom.trail}" style="background:${p.c || 'conic-gradient(#ff4f6e,#ffd166,#8dff6a,#46f0d0,#6fa8ff,#c86bff,#ff4f6e)'}"></button>`).join('');
    $('#patternPick').innerHTML = PATTERNS.map(p => `<button type="button" class="chip" data-pattern="${p.id}" aria-pressed="${p.id === custom.pattern}">${p.name}</button>`).join('');
  }
  $('.hangar').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    for (const k of ['chassis', 'paint', 'trail', 'pattern']) if (b.dataset[k]) custom[k] = b.dataset[k];
    save(STORAGE.ship, custom);
    buildHangar();
    ensureAudio(); sfx('ui');
  });

  /* ---------------- Screens ---------------- */
  let best = load(STORAGE.best, 0);
  function start() {
    ensureAudio();
    reset();
    mode = 'play';
    $('#screen').classList.add('playing');
    for (const id of ['#startScreen', '#overScreen', '#pauseScreen']) $(id).hidden = true;
  }
  function toHangar() {
    mode = 'menu';
    $('#screen').classList.remove('playing');
    $('#overScreen').hidden = true; $('#pauseScreen').hidden = true; $('#startScreen').hidden = false;
    buildHangar(); updateBest();
  }
  function togglePause() {
    if (mode === 'play') {
      mode = 'pause';
      $('#screen').classList.remove('playing');
      $('#pauseInfo').textContent = `Wave ${wave} · ${score} points · ascension ${levels()}/${TOTAL_LVLS}`;
      $('#pauseScreen').hidden = false;
    } else if (mode === 'pause') {
      mode = 'play'; $('#pauseScreen').hidden = true; $('#screen').classList.add('playing'); last = performance.now();
    }
  }
  function gameOver() {
    mode = 'over';
    $('#screen').classList.remove('playing');
    const record = score > best;
    if (record) { best = score; save(STORAGE.best, best); }
    $('#oWave').textContent = wave; $('#oScore').textContent = score; $('#oUps').textContent = `${levels()}/${TOTAL_LVLS}`; $('#oBest').textContent = best;
    $('#overEyebrow').textContent = record ? 'New high score!' : 'Ship destroyed';
    $('#overText').textContent = levels() >= TOTAL_LVLS - 8
      ? 'You were on the verge of ascending. Next time you will be invincible.'
      : `You held out for ${Math.floor(time / 60)} min ${Math.floor(time % 60)} s in the ${chassis().name}. Every wave is tougher: hunt rare capsules and elites to power up faster.`;
    setTimeout(() => { if (mode === 'over') $('#overScreen').hidden = false; }, 900);
    sfx('over');
    updateBest();
  }
  function updateBest() { $('#bestNote').textContent = best ? `BEST: ${best} POINTS` : 'BEST: —'; }

  $('#startBtn').addEventListener('click', start);
  $('#retryBtn').addEventListener('click', start);
  $('#hangarBtn').addEventListener('click', toHangar);
  $('#quitBtn').addEventListener('click', toHangar);
  $('#resumeBtn').addEventListener('click', togglePause);
  $('#soundBtn').addEventListener('click', toggleSound);

  window.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code) && mode === 'play') e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') { if (mode === 'play') dash(); }
    if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
    if (e.code === 'KeyM') toggleSound();
    if (e.code === 'KeyF' && mode === 'play') { autoFire = !autoFire; save(STORAGE.autoFire, autoFire); toast(autoFire ? 'AUTO-FIRE ON' : 'AUTO-FIRE OFF', autoFire ? 'You fire without holding the button' : 'Hold the mouse button to fire', '#6fe3ff'); }
    if (e.code === 'Enter' && (mode === 'menu' || (mode === 'over' && !$('#overScreen').hidden))) start();
  });
  window.addEventListener('keyup', e => { keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.down = false; if (mode === 'play') togglePause(); });

  function toLogical(ev) { const r = canvas.getBoundingClientRect(); return { x: (ev.clientX - r.left) / r.width * W, y: (ev.clientY - r.top) / r.height * H }; }
  canvas.addEventListener('mousemove', e => { const q = toLogical(e); mouse.x = q.x; mouse.y = q.y; mouse.used = true; });
  canvas.addEventListener('mousedown', e => { if (e.button === 0) { mouse.down = true; mouse.used = true; } if (e.button === 2) dash(); });
  window.addEventListener('mouseup', e => { if (e.button === 0) mouse.down = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  // Touch: left half = move; right half = aim and fire; quick tap on the right = dash.
  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    for (const tc of e.changedTouches) {
      const q = toLogical(tc), slot = q.x < W / 2 ? 'move' : 'aim';
      if (!touch[slot]) touch[slot] = { id: tc.identifier, ox: tc.clientX, oy: tc.clientY, x: tc.clientX, y: tc.clientY, t0: performance.now(), moved: false };
    }
  }, { passive: false });
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const tc of e.changedTouches) for (const slot of ['move', 'aim']) {
      const s = touch[slot];
      if (s && s.id === tc.identifier) { s.x = tc.clientX; s.y = tc.clientY; if (Math.hypot(s.x - s.ox, s.y - s.oy) > 12) s.moved = true; }
    }
  }, { passive: false });
  canvas.addEventListener('touchend', e => {
    for (const tc of e.changedTouches) for (const slot of ['move', 'aim']) {
      const s = touch[slot];
      if (s && s.id === tc.identifier) { if (slot === 'aim' && !s.moved && performance.now() - s.t0 < 220) dash(); touch[slot] = null; }
    }
  });

  function pollPad() {
    pad = { mx: 0, my: 0, ax: 0, ay: 0, rt: false };
    if (!navigator.getGamepads) return;
    const gp = Array.from(navigator.getGamepads()).find(Boolean);
    if (!gp) { padButtons = []; return; }
    const pressed = i => Boolean(gp.buttons[i]?.pressed), just = i => pressed(i) && !padButtons[i];
    const dz = v => Math.abs(v) < .2 ? 0 : v;
    pad.mx = dz(gp.axes[0] || 0) + (pressed(15) ? 1 : 0) - (pressed(14) ? 1 : 0);
    pad.my = dz(gp.axes[1] || 0) + (pressed(13) ? 1 : 0) - (pressed(12) ? 1 : 0);
    pad.ax = dz(gp.axes[2] || 0); pad.ay = dz(gp.axes[3] || 0);
    pad.rt = (gp.buttons[7]?.value || 0) > .3;
    if (mode === 'play') { if (just(0) || just(5) || just(4)) dash(); if (just(9)) togglePause(); }
    else if (mode === 'pause') { if (just(9) || just(0)) togglePause(); else if (just(1)) toHangar(); }
    else if (mode === 'menu' || (mode === 'over' && !$('#overScreen').hidden)) { if (just(0) || just(9)) start(); else if (just(1)) location.href = '../index.html'; }
    padButtons = gp.buttons.map(b => Boolean(b?.pressed));
  }

  /* =====================================================================
     SOUND: effects and original soundtrack (synthwave / space arcade)
     ===================================================================== */
  let audio = null, soundOn = load(STORAGE.sound, true), lastShot = 0;
  function ensureAudio() {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    if (!audio) {
      const ac = new Ctor();
      const master = ac.createGain(); master.gain.value = soundOn ? .6 : 0;
      const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
      master.connect(comp); comp.connect(ac.destination);
      const music = ac.createGain(); music.gain.value = .38; music.connect(master);
      const fx = ac.createGain(); fx.gain.value = .75; fx.connect(master);
      // Echo for the lead melody and arpeggios
      const delay = ac.createDelay(1); delay.delayTime.value = 60 / 120 * .75;
      const fb = ac.createGain(); fb.gain.value = .33;
      const dlp = ac.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2200;
      const wet = ac.createGain(); wet.gain.value = .35;
      delay.connect(dlp); dlp.connect(fb); fb.connect(delay); dlp.connect(wet); wet.connect(music);
      const noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      audio = { ac, master, music, fx, delay, noise, next: 0, step: 0, song: 'main' };
      setInterval(scheduleMusic, 25);
    }
    audio.ac.resume().catch(() => {});
  }
  function toggleSound() {
    soundOn = !soundOn; save(STORAGE.sound, soundOn);
    $('#soundBtn').textContent = soundOn ? '♫ SOUND ON' : '♫ SOUND OFF';
    $('#soundBtn').setAttribute('aria-pressed', String(soundOn));
    if (audio) audio.master.gain.setTargetAtTime(soundOn ? .6 : 0, audio.ac.currentTime, .05);
  }
  const hz = n => 440 * Math.pow(2, (n - 69) / 12);
  function osc(type, freq, at, dur, vol, dest, { slide = 0, attack = .006, detune = 0, filter = 0 } = {}) {
    const { ac } = audio, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, at); o.detune.value = detune;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), at + dur);
    g.gain.setValueAtTime(.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + attack); g.gain.exponentialRampToValueAtTime(.0001, at + dur);
    let node = o;
    if (filter) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter; o.connect(f); node = f; }
    node.connect(g); g.connect(dest); o.start(at); o.stop(at + dur + .05);
    return g;
  }
  function noiseHit(at, dur, vol, freq, type, dest) {
    const { ac } = audio, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = audio.noise; f.type = type; f.frequency.value = freq;
    g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(.0001, at + dur);
    s.connect(f); f.connect(g); g.connect(dest); s.start(at, Math.random() * .5); s.stop(at + dur + .05);
  }
  function sfx(name, k = 1) {
    if (!audio || !soundOn) return;
    const now = audio.ac.currentTime, fx = audio.fx;
    switch (name) {
      case 'shoot': if (now - lastShot < .06) return; lastShot = now; osc('square', god ? 1500 : 1100, now, .06, .018, fx, { slide: .45 }); osc('sine', 220, now, .05, .03, fx, { slide: .5 }); break;
      case 'boom': noiseHit(now, .2 + k * .25, Math.min(.45, .1 + k * .1), 1100 - Math.min(800, k * 160), 'lowpass', fx); osc('sine', 110, now, .25 + k * .12, .16 * Math.min(2, k), fx, { slide: .35 }); break;
      case 'hurt': osc('sawtooth', 240, now, .4, .16, fx, { slide: .3 }); noiseHit(now, .25, .25, 1500, 'lowpass', fx); break;
      case 'shield': osc('triangle', 520, now, .22, .12, fx, { slide: 1.8 }); break;
      case 'dash': noiseHit(now, .22, .16, 2600, 'bandpass', fx); osc('sine', 300, now, .18, .05, fx, { slide: 2.2 }); break;
      case 'missile': osc('sawtooth', 260, now, .22, .04, fx, { slide: 2.2, filter: 1800 }); break;
      case 'nova': osc('sine', 80, now, .7, .3, fx, { slide: .5 }); noiseHit(now, .45, .18, 700, 'lowpass', fx); break;
      case 'bomb': osc('sine', 60, now, 1.2, .45, fx, { slide: .4 }); noiseHit(now, .9, .4, 900, 'lowpass', fx); break;
      case 'laser': osc('sawtooth', 90, now, 1.5, .1, fx, { filter: 900 }); osc('square', 180, now, 1.5, .05, fx, { filter: 1400 }); break;
      case 'gem': osc('sine', 1760 + Math.random() * 400, now, .08, .04, fx); break;
      case 'pickup': [523, 659, 784, 1046].forEach((f, i) => osc('triangle', f, now + i * .055, .16, .12, fx)); break;
      case 'rare': [523, 659, 784, 1046, 1318, 1568].forEach((f, i) => { osc('triangle', f, now + i * .06, .3, .12, fx); osc('sine', f * 2, now + i * .06, .25, .04, audio.delay); }); break;
      case 'power': [392, 587, 784].forEach((f, i) => osc('square', f, now + i * .07, .14, .06, fx)); break;
      case 'wave': [440, 659].forEach((f, i) => osc('triangle', f, now + i * .14, .35, .09, fx)); break;
      case 'clear': [523, 659, 784, 1046].forEach((f, i) => osc('square', f, now + i * .09, .22, .05, fx)); break;
      case 'boss': osc('sawtooth', 110, now, 1.4, .13, fx, { slide: .5, filter: 900 }); osc('sawtooth', 116, now, 1.4, .1, fx, { slide: .5, filter: 900 }); break;
      case 'bossShot': osc('square', 220, now, .22, .045, fx, { slide: .5 }); break;
      case 'ascend': [523, 659, 784, 1046, 1318, 1568, 2093].forEach((f, i) => { osc('triangle', f, now + i * .09, .6, .13, fx); osc('sine', f * 1.5, now + i * .09, .5, .05, audio.delay); }); break;
      case 'over': [392, 330, 262, 196].forEach((f, i) => osc('triangle', f, now + i * .17, .45, .14, fx)); break;
      case 'ui': osc('sine', 880, now, .06, .04, fx); break;
    }
  }

  // Original soundtrack: i–VI–III–VII progression in A minor, with layers that
  // come in as the waves progress, plus a faster boss theme in the Phrygian mode.
  const SONGS = {
    main: { bpm: 120, chords: [[57, 60, 64], [57, 60, 65], [55, 60, 64], [55, 59, 62]], bass: [45, 41, 48, 43] },
    boss: { bpm: 146, chords: [[57, 60, 64], [58, 62, 65], [57, 60, 64], [56, 59, 64]], bass: [45, 46, 45, 40] }
  };
  const LEAD = [
    [0, 69, 3], [3, 72, 2], [6, 76, 4], [10, 74, 2], [12, 72, 4],
    [16, 72, 3], [19, 77, 3], [22, 76, 2], [24, 74, 2], [26, 72, 2], [28, 69, 4],
    [32, 67, 3], [35, 72, 3], [38, 76, 4], [42, 79, 2], [44, 76, 4],
    [48, 74, 3], [51, 71, 3], [54, 74, 2], [56, 79, 4], [60, 76, 2], [62, 74, 2],
    [64, 81, 4], [68, 79, 2], [70, 76, 2], [72, 77, 2], [74, 76, 2], [76, 72, 4],
    [80, 77, 4], [84, 76, 2], [86, 72, 2], [88, 74, 4], [92, 72, 4],
    [96, 76, 3], [99, 79, 3], [102, 84, 4], [106, 83, 2], [108, 79, 4],
    [112, 79, 2], [114, 81, 2], [116, 83, 4], [120, 86, 2], [122, 83, 2], [124, 79, 4]
  ];
  const leadAt = new Map(LEAD.map(n => [n[0], n]));
  function musicIntensity() {
    if (mode === 'menu') return 0;
    if (god) return 4;
    return wave < 3 ? 1 : wave < 6 ? 2 : 3;
  }
  function scheduleMusic() {
    if (!audio || !soundOn || !(mode === 'play' || mode === 'menu')) { if (audio) audio.next = 0; return; }
    const ac = audio.ac;
    if (audio.next < ac.currentTime) audio.next = ac.currentTime + .06;
    while (audio.next < ac.currentTime + .15) {
      const st = audio.step, s = st % 16;
      // Theme changes wait for the start of a bar.
      if (s === 0) audio.song = mode === 'play' && enemies && enemies.some(e => e.type === 'boss') ? 'boss' : 'main';
      const song = SONGS[audio.song], boss = audio.song === 'boss', step16 = 60 / song.bpm / 4;
      const bar = Math.floor(st / 16) % 4, chord = song.chords[bar], root = song.bass[bar], at = audio.next;
      const lvl = musicIntensity(), mus = audio.music;
      audio.delay.delayTime.setValueAtTime(60 / song.bpm * .75, at);
      // Sustained chords (pad)
      if (s === 0) for (const n of chord) for (const dt of [-8, 8]) osc('sawtooth', hz(n), at, step16 * 16, lvl === 0 ? .018 : .022, mus, { attack: .35, detune: dt, filter: boss ? 1300 : 900 });
      // Pulsing bass
      if (lvl >= 1) {
        if (boss || s % 2 === 0) osc('sawtooth', hz(root - 12 + (s % 4 === 2 && !boss ? 12 : 0)), at, step16 * .9, boss ? .085 : .07, mus, { filter: boss ? 950 : 650 });
      } else if (s % 8 === 0) osc('triangle', hz(root - 12), at, step16 * 7, .06, mus);
      // Drums
      if (lvl >= 1 && (s % 4 === 0 || (boss && s === 14))) osc('sine', 150, at, .18, .5, mus, { slide: .3 });
      if (lvl >= 2 && (s === 4 || s === 12)) { noiseHit(at, .14, .14, 1800, 'bandpass', mus); osc('triangle', 190, at, .08, .06, mus); }
      if (lvl >= 2 && (s % 2 === 1 || (lvl >= 3 && Math.random() < .5))) noiseHit(at, .03, s % 4 === 2 ? .05 : .03, 7500, 'highpass', mus);
      // Chiptune-style arpeggio
      if ((lvl >= 2 || lvl === 0) && (lvl > 0 || s % 2 === 0)) {
        const notes = [chord[0], chord[1], chord[2], chord[1] + 12];
        osc('square', hz(notes[s % 4] + 12), at, step16 * .8, lvl === 0 ? .016 : .022, audio.delay);
        osc('square', hz(notes[s % 4] + 12), at, step16 * .8, lvl === 0 ? .012 : .016, mus);
      }
      // Lead melody (wave 6 onwards) or boss-theme stabs
      if (lvl >= 3 && !boss) {
        const n = leadAt.get(st % 128);
        if (n) {
          const oct = god ? 12 : 0;
          osc('sawtooth', hz(n[1] + oct), at, step16 * n[2], .045, mus, { attack: .02, filter: 2600 });
          osc('square', hz(n[1] + oct), at, step16 * n[2], .03, audio.delay, { attack: .02, detune: 7 });
        }
      } else if (boss && [0, 3, 6, 10, 12].includes(s)) {
        const n = chord[[0, 1, 2, 1, 0][[0, 3, 6, 10, 12].indexOf(s)]] + 12;
        osc('sawtooth', hz(n), at, step16 * 1.6, .04, mus, { filter: 2200 });
        osc('square', hz(n + 12), at, step16 * 1.2, .02, audio.delay);
      }
      audio.next += step16; audio.step++;
    }
  }

  /* ---------------- Start-up ---------------- */
  $('#soundBtn').textContent = soundOn ? '♫ SOUND ON' : '♫ SOUND OFF';
  updateBest();
  buildHangar();
  reset(); mode = 'menu'; enemies = []; banner = null;
  // Hangar music starts on the first interaction (browsers require it).
  window.addEventListener('pointerdown', () => ensureAudio(), { once: true });
  window.addEventListener('keydown', () => ensureAudio(), { once: true });
  requestAnimationFrame(frame);
})();
