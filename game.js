const GAME_WIDTH = 800;
const GAME_HEIGHT = 600;
const STORAGE_KEY = 'paloma-panic.highscores.v1';
const MAX_HIGH_SCORES = 5;
const ROUND_TIME = 60;
const MAX_ESCAPES = 7;
const MAX_TARGETS = 5;
const BOSS_HITS = 3;
const START_GRACE = 8;

const CABINET_KEYS = {
  P1_U: ['w'],
  P1_D: ['s'],
  P1_L: ['a'],
  P1_R: ['d'],
  P1_1: ['u'],
  P1_2: ['i'],
  P1_3: ['o'],
  P1_4: ['j'],
  P1_5: ['k'],
  P1_6: ['l'],
  P2_U: ['ArrowUp'],
  P2_D: ['ArrowDown'],
  P2_L: ['ArrowLeft'],
  P2_R: ['ArrowRight'],
  P2_1: ['r'],
  P2_2: ['t'],
  P2_3: ['y'],
  P2_4: ['f'],
  P2_5: ['g'],
  P2_6: ['h'],
  START1: ['Enter'],
  START2: ['2'],
};

const KEYBOARD_TO_ARCADE = {};
for (const [code, keys] of Object.entries(CABINET_KEYS)) {
  for (const key of keys) {
    KEYBOARD_TO_ARCADE[normalizeIncomingKey(key)] = code;
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  parent: 'game-root',
  backgroundColor: '#07111f',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
  },
  scene: { create, update },
});

function create() {
  const s = this;
  s.state = {
    phase: 'boot',
    score: 0,
    shots: 0,
    hits: 0,
    combo: 0,
    bestCombo: 0,
    escapes: 0,
    timeLeft: ROUND_TIME,
    spawnAt: 0,
    flashAt: 0,
    focus: 100,
    focusOn: false,
    pauseLocked: false,
    lastScore: 0,
    hi: [],
  };
  s.controls = { held: Object.create(null), pressed: Object.create(null) };
  s.targets = [];
  s.shards = [];
  s.beams = [];
  createControls(s);
  buildScene(s);
  loadScores(s).finally(() => showMenu(s));
}

function update(time, delta) {
  const s = this;
  if (!s.state) return;
  const dt = delta / 1000;
  const slow = s.state.phase === 'play' && s.state.focusOn && s.state.focus > 0 ? 0.45 : 1;
  const sim = dt * slow;

  if (s.state.phase === 'menu') {
    if (consumeAnyPressedControl(s, ['START1', 'P1_1', 'P1_2'])) startRun(s, time);
    return;
  }

  if (s.state.phase === 'over') {
    if (consumeAnyPressedControl(s, ['START1', 'P1_1', 'P1_2'])) showMenu(s);
    return;
  }

  updateCrosshair(s, dt);
  updateSkyline(s, time);

  if (consumeAnyPressedControl(s, ['START1'])) {
    s.state.pauseLocked = !s.state.pauseLocked;
    s.pauseText.setVisible(s.state.pauseLocked);
  }
  if (s.state.pauseLocked) return;

  s.state.focusOn = isControlDown(s, 'P1_2');
  if (s.state.focusOn && s.state.focus > 0) {
    s.state.focus = Math.max(0, s.state.focus - 28 * dt);
  } else {
    s.state.focus = Math.min(100, s.state.focus + 18 * dt);
  }

  s.state.timeLeft = Math.max(0, s.state.timeLeft - dt);
  if (s.state.timeLeft <= 0 || s.state.escapes >= MAX_ESCAPES) {
    return endRun(s);
  }

  if (time >= s.state.spawnAt) spawnTarget(s, time);
  if (consumeAnyPressedControl(s, ['P1_1'])) shoot(s, time);
  stepTargets(s, sim, time);
  stepShards(s, sim);
  stepBeams(s, dt, time);
  refreshHud(s);
}

function buildScene(s) {
  s.add.rectangle(400, 300, 800, 600, 0x07111f);
  s.add.rectangle(400, 100, 800, 200, 0x0f2238, 0.85);
  s.add.circle(666, 92, 44, 0xffe38a, 0.92);
  s.add.circle(666, 92, 72, 0xffe38a, 0.12);
  s.add.rectangle(400, 430, 800, 340, 0x10232f);
  s.add.rectangle(400, 520, 800, 160, 0x162513);
  s.add.rectangle(400, 558, 800, 84, 0x254219);

  s.skyline = [];
  const skyline = [44, 120, 72, 95, 58, 136, 84, 70, 110, 60, 92, 148, 76, 100];
  for (let i = 0; i < skyline.length; i += 1) {
    const x = 30 + i * 56;
    const h = skyline[i];
    const b = s.add.rectangle(x, 430 - h / 2, 42, h, i % 2 ? 0x11293d : 0x17344b).setOrigin(0, 0.5);
    s.skyline.push(b);
    for (let y = 0; y < h - 16; y += 16) {
      if ((i + y) % 3) s.add.rectangle(x + 8 + (y % 2) * 12, 430 - h + 16 + y, 6, 8, 0xffcf5a, 0.32);
    }
  }

  s.hudTop = s.add.rectangle(400, 26, 748, 44, 0x03070c, 0.78).setStrokeStyle(2, 0x9fffe0, 0.35);
  s.scoreText = addText(s, 44, 16, 'SCORE 0000', 22, '#f6ffb0', 'left');
  s.comboText = addText(s, 300, 16, 'COMBO X1', 22, '#7af0ff', 'left');
  s.timeText = addText(s, 548, 16, 'TIME 60', 22, '#ffd06a', 'left');
  s.escapeText = addText(s, 684, 16, 'FLY 0/7', 22, '#ff8c78', 'left');
  s.focusLabel = addText(s, 44, 48, 'FOCUS', 14, '#c6fff7', 'left');
  s.focusBar = s.add.rectangle(126, 56, 120, 10, 0x17344b).setOrigin(0, 0.5).setStrokeStyle(2, 0x7af0ff, 0.4);
  s.focusFill = s.add.rectangle(126, 56, 120, 10, 0x7af0ff).setOrigin(0, 0.5);
  s.statusText = addText(s, 400, 578, 'P1 MUEVE  U DISPARA  I ENFOQUE  ENTER PAUSA', 14, '#d8fff6', 'center');

  s.targetLayer = s.add.container(0, 0);
  s.fxLayer = s.add.container(0, 0);

  s.crosshair = s.add.container(400, 320);
  s.crosshair.add(s.add.circle(0, 0, 18, 0x000000, 0));
  s.crosshair.add(s.add.circle(0, 0, 16, 0x000000, 0).setStrokeStyle(2, 0xf5ffe1, 1));
  s.crosshair.add(s.add.line(0, 0, -24, 0, -8, 0, 0xf5ffe1, 1).setLineWidth(2, 2));
  s.crosshair.add(s.add.line(0, 0, 8, 0, 24, 0, 0xf5ffe1, 1).setLineWidth(2, 2));
  s.crosshair.add(s.add.line(0, 0, 0, -24, 0, -8, 0xf5ffe1, 1).setLineWidth(2, 2));
  s.crosshair.add(s.add.line(0, 0, 0, 8, 0, 24, 0xf5ffe1, 1).setLineWidth(2, 2));
  s.crosshair.add(s.add.circle(0, 0, 3, 0xff6a3d, 1));
  s.crosshair.setDepth(20);

  s.flash = s.add.rectangle(400, 300, 800, 600, 0xfff4cc, 0).setDepth(30);
  s.pauseText = addText(s, 400, 300, 'PAUSA', 34, '#ffffff', 'center').setDepth(40).setVisible(false);

  s.menu = s.add.container(0, 0).setDepth(50);
  s.menu.add(s.add.rectangle(400, 300, 800, 600, 0x03070c, 0.82));
  s.menu.add(addText(s, 400, 94, 'PALOMA PANIC', 44, '#f7ffb5', 'center', true));
  s.menu.add(addText(s, 400, 140, 'BUENOS AIRES UNDER SIEGE', 18, '#7af0ff', 'center', true));
  s.menuInfo = addText(s, 400, 202, '', 18, '#e2fff8', 'center');
  s.menuHelp = addText(s, 400, 504, 'DISPARA PALOMAS FURIOSAS. ENTER O U PARA EMPEZAR.', 16, '#ffd06a', 'center');
  s.menuHigh = addText(s, 400, 280, '', 18, '#d8fff6', 'center');
  s.menu.add([s.menuInfo, s.menuHelp, s.menuHigh]);

  s.over = s.add.container(0, 0).setDepth(55).setVisible(false);
  s.over.add(s.add.rectangle(400, 300, 800, 600, 0x02050a, 0.94));
  s.overTitle = addText(s, 400, 120, 'RONDA TERMINADA', 34, '#fff7b1', 'center', true);
  s.overScore = addText(s, 400, 186, '', 24, '#e7fff8', 'center');
  s.overTable = addText(s, 400, 270, '', 20, '#7af0ff', 'center');
  s.overHelp = addText(s, 400, 502, 'ENTER O U PARA VOLVER AL MENU', 16, '#ffd06a', 'center');
  s.over.add([s.overTitle, s.overScore, s.overTable, s.overHelp]);
}

function addText(s, x, y, t, size, color, align, bold) {
  return s.add.text(x, y, t, {
    fontFamily: 'monospace',
    fontSize: size + 'px',
    color,
    align,
    fontStyle: bold ? 'bold' : '',
  }).setOrigin(align === 'left' ? 0 : 0.5, 0);
}

function showMenu(s) {
  s.state.phase = 'menu';
  s.targets.forEach(killTarget);
  s.targets.length = 0;
  s.shards.forEach((p) => p.destroy());
  s.shards.length = 0;
  s.beams.forEach((b) => b.line.destroy());
  s.beams.length = 0;
  s.crosshair.setVisible(true);
  setHudAlpha(s, 1);
  s.menu.setVisible(true);
  s.over.setVisible(false);
  s.pauseText.setVisible(false);
  const best = s.state.hi[0] || 0;
  const lines = ['TOP 5'];
  for (let i = 0; i < MAX_HIGH_SCORES; i += 1) lines.push((i + 1) + '. ' + String(s.state.hi[i] || 0).padStart(4, '0'));
  s.menuInfo.setText('CAZA RAPIDA DE PALOMAS NEON. NO DEJES ESCAPAR ' + MAX_ESCAPES + '.');
  s.menuHigh.setText('RECORD ' + String(best).padStart(4, '0') + '\n\n' + lines.join('\n'));
  refreshHud(s);
}

function startRun(s, time) {
  s.menu.setVisible(false);
  s.over.setVisible(false);
  s.state.phase = 'play';
  s.state.score = 0;
  s.state.shots = 0;
  s.state.hits = 0;
  s.state.combo = 0;
  s.state.bestCombo = 0;
  s.state.escapes = 0;
  s.state.timeLeft = ROUND_TIME;
  s.state.focus = 100;
  s.state.flashAt = 0;
  s.state.pauseLocked = false;
  s.state.spawnAt = time + 400;
  s.crosshair.setVisible(true);
  setHudAlpha(s, 1);
  s.crosshair.setPosition(400, 320);
  refreshHud(s);
}

function endRun(s) {
  s.state.phase = 'over';
  s.state.lastScore = s.state.score;
  s.targets.forEach(killTarget);
  s.targets.length = 0;
  s.beams.forEach((b) => b.line.destroy());
  s.beams.length = 0;
  s.crosshair.setVisible(false);
  setHudAlpha(s, 0.12);
  const acc = s.state.shots ? Math.round((100 * s.state.hits) / s.state.shots) : 0;
  s.state.hi = keepScores(s.state.hi, s.state.score);
  saveScores(s);
  s.overScore.setText(
    'PUNTAJE ' + String(s.state.score).padStart(4, '0') +
    '\nPRECISION ' + acc + '%' +
    '\nMEJOR RACHA X' + s.state.bestCombo +
    '\nESCAPES ' + s.state.escapes + '/' + MAX_ESCAPES
  );
  const lines = ['TOP 5'];
  for (let i = 0; i < MAX_HIGH_SCORES; i += 1) lines.push((i + 1) + '. ' + String(s.state.hi[i] || 0).padStart(4, '0'));
  s.overTable.setText(lines.join('\n'));
  s.over.setVisible(true);
}

function setHudAlpha(s, alpha) {
  s.hudTop.alpha = alpha;
  s.scoreText.alpha = alpha;
  s.comboText.alpha = alpha;
  s.timeText.alpha = alpha;
  s.escapeText.alpha = alpha;
  s.focusLabel.alpha = alpha;
  s.focusBar.alpha = alpha;
  s.focusFill.alpha = alpha;
  s.statusText.alpha = alpha;
}

function refreshHud(s) {
  s.scoreText.setText('SCORE ' + String(s.state.score).padStart(4, '0'));
  s.comboText.setText('COMBO X' + Math.max(1, s.state.combo));
  s.timeText.setText('TIME ' + Math.ceil(s.state.timeLeft));
  s.escapeText.setText('FLY ' + s.state.escapes + '/' + MAX_ESCAPES);
  s.focusFill.width = 1.2 * s.state.focus;
  s.focusFill.fillColor = s.state.focus > 35 ? 0x7af0ff : 0xff8c78;
  s.flash.alpha = Math.max(0, s.flash.alpha - 0.05);
}

function updateCrosshair(s, dt) {
  const speed = 340 * dt;
  const x = (isControlDown(s, 'P1_R') ? 1 : 0) - (isControlDown(s, 'P1_L') ? 1 : 0);
  const y = (isControlDown(s, 'P1_D') ? 1 : 0) - (isControlDown(s, 'P1_U') ? 1 : 0);
  s.crosshair.x = Phaser.Math.Clamp(s.crosshair.x + x * speed, 40, 760);
  s.crosshair.y = Phaser.Math.Clamp(s.crosshair.y + y * speed, 70, 540);
}

function spawnTarget(s, time) {
  if (s.targets.length >= MAX_TARGETS) {
    s.state.spawnAt = time + Phaser.Math.Between(240, 380);
    return;
  }
  const elapsed = ROUND_TIME - s.state.timeLeft;
  const left = Math.random() > 0.5;
  const y = Phaser.Math.Between(120, 410);
  const typeRoll = Math.random();
  let type = 'pigeon';
  if (elapsed > 24 && typeRoll > 0.986) type = 'storm';
  else if (elapsed > 14 && typeRoll > 0.93) type = 'gold';
  else if (elapsed > START_GRACE && typeRoll > 0.8) type = 'swift';
  const dir = left ? 1 : -1;
  const earlyFactor = elapsed < 18 ? Phaser.Math.Linear(0.76, 1, elapsed / 18) : 1;
  const speed = (type === 'storm' ? Phaser.Math.Between(108, 145) : type === 'swift' ? Phaser.Math.Between(185, 235) : type === 'gold' ? Phaser.Math.Between(128, 162) : Phaser.Math.Between(105, 158)) * earlyFactor;
  const amp = type === 'storm' ? Phaser.Math.Between(8, 18) : type === 'swift' ? Phaser.Math.Between(16, 40) : Phaser.Math.Between(10, 28);
  const body = s.add.container(left ? -60 : 860, y);
  const tint = type === 'storm' ? 0xff6a8f : type === 'gold' ? 0xffcf5a : type === 'swift' ? 0x7af0ff : 0xe6f3ff;
  const wing = type === 'storm' ? 0x51162c : type === 'gold' ? 0xff9f43 : 0x182a38;
  const w = type === 'storm' ? 62 : type === 'swift' ? 34 : 42;
  const h = type === 'storm' ? 30 : type === 'swift' ? 18 : 22;
  body.add(s.add.ellipse(-2, 0, w, h, tint, 1));
  body.add(s.add.circle(type === 'storm' ? 20 : 15, type === 'storm' ? -10 : -8, type === 'storm' ? 12 : 8, tint, 1));
  body.add(s.add.triangle(-12, -4, -18, 0, -42, -12, -10, -12, wing, 0.95));
  body.add(s.add.triangle(-12, 5, -18, 0, -42, 12, -10, 12, wing, 0.95));
  body.add(s.add.triangle(type === 'storm' ? 34 : 24, -7, 0, 0, 10, -2, 0, -12, 0xff7b5a, 1));
  body.add(s.add.circle(-16, -3, 2, 0x081018, 1));
  if (type === 'storm') {
    body.add(s.add.circle(-2, 0, 32, 0x000000, 0).setStrokeStyle(3, 0xffb2c4, 0.9));
    const shield = s.add.text(-2, -40, '3', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#fff2a8',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    body.add(shield);
  }
  body.setDepth(10);
  s.targetLayer.add(body);
  const hp = type === 'storm' ? BOSS_HITS : 1;
  s.targets.push({
    body,
    born: time,
    x: body.x,
    y,
    baseY: y,
    dir,
    speed,
    amp,
    type,
    flap: Math.random() * 6,
    hp,
    maxHp: hp,
    value: type === 'storm' ? 120 : type === 'gold' ? 75 : type === 'swift' ? 35 : 20,
    radius: type === 'storm' ? 30 : type === 'swift' ? 18 : 22,
  });
  const pressure = Math.min(1, elapsed / 45);
  const introBonus = elapsed < START_GRACE ? (START_GRACE - elapsed) * 160 : 0;
  const baseDelay = Phaser.Math.Linear(1550, 580, pressure) + introBonus;
  const scorePressure = Math.min(150, s.state.score * 0.45);
  const escapePressure = s.state.escapes * 12;
  const delay = Math.max(520, baseDelay - scorePressure - escapePressure);
  s.state.spawnAt = time + Phaser.Math.Between(delay, delay + 220);
}


function stepTargets(s, dt, time) {
  while (s.targets.length > MAX_TARGETS) {
    const extra = s.targets.shift();
    if (extra) killTarget(extra);
  }
  for (let i = s.targets.length - 1; i >= 0; i -= 1) {
    const t = s.targets[i];
    const age = (time - t.born) * 0.001;
    t.x += t.dir * t.speed * dt;
    t.y = t.baseY + Math.sin(age * (t.type === 'swift' ? 6.2 : 4.1) + t.flap) * t.amp;
    t.body.x = t.x;
    t.body.y = t.y;
    t.body.scaleX = t.dir;
    t.body.rotation = Math.sin(age * 10 + t.flap) * 0.06;
    t.body.list[2].rotation = Math.sin(age * 16) * 0.35;
    t.body.list[3].rotation = -Math.sin(age * 16) * 0.35;
    if (t.type === 'storm') {
      t.body.list[6].alpha = 0.5 + Math.sin(age * 8) * 0.2;
    }
    if (t.x < -90 || t.x > 890) {
      s.targets.splice(i, 1);
      killTarget(t);
      s.state.escapes += 1;
      s.state.combo = 0;
      pulseHud(s, '#ff8c78');
      tone(s, 160, 0.09, 'sawtooth');
    }
  }
}

function shoot(s, time) {
  s.state.shots += 1;
  s.flash.alpha = 0.12;
  const line = s.add.line(s.crosshair.x, s.crosshair.y, 0, 0, 0, -660, 0xfff4cc, 0.9).setLineWidth(3, 1).setRotation(-0.06 + Math.random() * 0.12).setDepth(18);
  s.fxLayer.add(line);
  s.beams.push({ line, die: time + 50 });
  let hit = null;
  let best = 1e9;
  for (const t of s.targets) {
    const d = Phaser.Math.Distance.Between(s.crosshair.x, s.crosshair.y, t.x, t.y);
    if (d < t.radius + 12 && d < best) {
      best = d;
      hit = t;
    }
  }
  if (hit) {
    s.state.hits += 1;
    if (hit.type === 'storm' && hit.hp > 1) {
      hit.hp -= 1;
      const shield = hit.body.list[7];
      if (shield) shield.setText(String(hit.hp));
      pulseHud(s, '#ff9db7');
      tone(s, 320, 0.08, 'sawtooth');
      popScore(s, hit.x, hit.y - 26, 'HIT ' + hit.hp, '#fff2a8');
      for (let i = 0; i < 3; i += 1) {
        const p = s.add.circle(hit.x, hit.y, Phaser.Math.Between(4, 8), 0xffb2c4);
        p.vx = Phaser.Math.Between(-120, 120);
        p.vy = Phaser.Math.Between(-140, 60);
        p.life = p.maxLife = 0.25 + Math.random() * 0.2;
        p.spin = 0;
        s.fxLayer.add(p);
        s.shards.push(p);
      }
      return;
    }
    s.state.combo += 1;
    s.state.bestCombo = Math.max(s.state.bestCombo, s.state.combo);
    const gain = hit.value + (s.state.combo - 1) * 4;
    s.state.score += gain;
    popScore(s, hit.x, hit.y - 20, '+' + gain, hit.type === 'storm' ? '#ffb2c4' : hit.type === 'gold' ? '#ffd06a' : '#e2fff8');
    if (hit.type === 'storm') {
      clearScreenBlast(s, hit, time);
      pulseHud(s, '#ff6a8f');
      tone(s, 220, 0.18, 'sawtooth');
    } else {
      explodeTarget(s, hit);
      pulseHud(s, hit.type === 'gold' ? '#ffd06a' : '#7af0ff');
      tone(s, hit.type === 'gold' ? 780 : 560 + Math.min(220, s.state.combo * 12), 0.06, 'square');
    }
    const idx = s.targets.indexOf(hit);
    if (idx >= 0) s.targets.splice(idx, 1);
    killTarget(hit);
  } else {
    s.state.combo = 0;
    tone(s, 240, 0.04, 'triangle');
  }
}

function stepShards(s, dt) {
  for (let i = s.shards.length - 1; i >= 0; i -= 1) {
    const p = s.shards[i];
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 460 * dt;
    p.rotation += p.spin * dt;
    p.alpha = Math.max(0, p.life / p.maxLife);
    if (p.label) p.setScale(1 + (1 - p.life / p.maxLife) * 0.4);
    if (p.life <= 0) {
      s.shards.splice(i, 1);
      p.destroy();
    }
  }
}

function stepBeams(s, dt, time) {
  s.crosshair.rotation += dt * 1.6;
  for (let i = s.beams.length - 1; i >= 0; i -= 1) {
    const b = s.beams[i];
    if (time > b.die) {
      s.beams.splice(i, 1);
      b.line.destroy();
    }
  }
}

function explodeTarget(s, t) {
  for (let i = 0; i < 8; i += 1) {
    const p = s.add.rectangle(t.x, t.y, Phaser.Math.Between(4, 10), Phaser.Math.Between(3, 8), t.type === 'gold' ? 0xffcf5a : 0xe8f7ff);
    p.vx = Phaser.Math.Between(-180, 180);
    p.vy = Phaser.Math.Between(-220, 80);
    p.life = p.maxLife = 0.45 + Math.random() * 0.2;
    p.spin = Phaser.Math.FloatBetween(-8, 8);
    s.fxLayer.add(p);
    s.shards.push(p);
  }
}

function clearScreenBlast(s, boss, time) {
  s.flash.alpha = 0.26;
  const ring = s.add.circle(boss.x, boss.y, 16, 0x000000, 0).setStrokeStyle(8, 0xffb2c4, 0.95).setDepth(17);
  s.fxLayer.add(ring);
  ring.vx = 0;
  ring.vy = 0;
  ring.life = ring.maxLife = 0.35;
  ring.spin = 0;
  ring.label = true;
  const others = s.targets.slice();
  for (const t of others) {
    if (t === boss) continue;
    s.state.combo += 1;
    s.state.bestCombo = Math.max(s.state.bestCombo, s.state.combo);
    const gain = t.value + (s.state.combo - 1) * 4;
    s.state.score += gain;
    popScore(s, t.x, t.y - 20, '+' + gain, t.type === 'gold' ? '#ffd06a' : '#e2fff8');
    explodeTarget(s, t);
    const idx = s.targets.indexOf(t);
    if (idx >= 0) s.targets.splice(idx, 1);
    killTarget(t);
  }
  explodeTarget(s, boss);
  tone(s, 120, 0.22, 'sawtooth');
  s.beams.push({ line: ring, die: time + 340 });
}

function popScore(s, x, y, text, color) {
  const p = s.add.text(x, y, text, {
    fontFamily: 'monospace',
    fontSize: '18px',
    color,
    fontStyle: 'bold',
  }).setOrigin(0.5);
  p.vx = Phaser.Math.Between(-14, 14);
  p.vy = -60;
  p.life = p.maxLife = 0.6;
  p.spin = 0;
  p.label = true;
  s.fxLayer.add(p);
  s.shards.push(p);
}

function pulseHud(s, color) {
  s.hudTop.setStrokeStyle(3, Phaser.Display.Color.HexStringToColor(color).color, 0.9);
}

function updateSkyline(s, time) {
  const pulse = 0.28 + Math.sin(time * 0.003) * 0.08;
  for (let i = 0; i < s.skyline.length; i += 1) s.skyline[i].alpha = 0.86 + ((i % 2) ? pulse : -pulse * 0.4);
}

function killTarget(t) {
  t.body.destroy();
}

function keepScores(list, score) {
  const next = Array.isArray(list) ? list.filter((n) => Number.isFinite(n) && n >= 0) : [];
  next.push(score);
  next.sort((a, b) => b - a);
  return next.slice(0, MAX_HIGH_SCORES);
}

async function loadScores(s) {
  try {
    if (!window.platanusArcadeStorage) return;
    const result = await window.platanusArcadeStorage.get(STORAGE_KEY);
    if (result && result.found && Array.isArray(result.value)) s.state.hi = keepScores(result.value, 0).filter((n) => n > 0);
  } catch (_) {}
}

async function saveScores(s) {
  try {
    if (window.platanusArcadeStorage) await window.platanusArcadeStorage.set(STORAGE_KEY, s.state.hi);
  } catch (_) {}
}

function createControls(s) {
  const onKeyDown = (event) => {
    const code = KEYBOARD_TO_ARCADE[normalizeIncomingKey(event.key)];
    if (!code) return;
    if (!s.controls.held[code]) s.controls.pressed[code] = true;
    s.controls.held[code] = true;
  };
  const onKeyUp = (event) => {
    const code = KEYBOARD_TO_ARCADE[normalizeIncomingKey(event.key)];
    if (code) s.controls.held[code] = false;
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  s.events.once('shutdown', () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
  });
}

function isControlDown(s, code) {
  return !!s.controls.held[code];
}

function consumeAnyPressedControl(s, codes) {
  for (const code of codes) {
    if (s.controls.pressed[code]) {
      s.controls.pressed[code] = false;
      return true;
    }
  }
  return false;
}

function normalizeIncomingKey(key) {
  if (!key || typeof key !== 'string') return '';
  return key.length === 1 ? key.toLowerCase() : key;
}

function tone(s, freq, dur, type) {
  const ctx = s.sound && s.sound.context;
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type || 'square';
  osc.frequency.setValueAtTime(freq, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.05, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + dur + 0.02);
}
