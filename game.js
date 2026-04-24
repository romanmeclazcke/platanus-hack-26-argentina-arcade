const GAME_WIDTH = 800;
const GAME_HEIGHT = 600;
const STORAGE_KEY = 'paloma-panic.highscores.v1';
const MAX_HIGH_SCORES = 5;
const MAX_ESCAPES = 7;
const MAX_TARGETS = 5;
const BOSS_HITS = 3;
const START_GRACE = 8;
const CODE_BITS = ['{}', '</>', 'NaN', '404', '++', '&&', 'FIX', 'BUG', 'NULL', '::'];

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
    elapsed: 0,
    spawnAt: 0,
    flashAt: 0,
    focus: 100,
    focusOn: false,
    focusLock: false,
    pauseLocked: false,
    startAt: 0,
    startUntil: 0,
    lastScore: 0,
    crossPulse: 0,
    hi: [],
  };
  s.controls = { held: Object.create(null), pressed: Object.create(null) };
  s.targets = [];
  s.shards = [];
  s.beams = [];
  createControls(s);
  buildScene(s);
  createNameInput(s);
  loadScores(s).finally(() => showMenu(s));
}

function update(time, delta) {
  const s = this;
  if (!s.state) return;
  const dt = delta / 1000;
  const holdingSlow = isControlDown(s, 'P1_2');
  if (!holdingSlow && s.state.focus >= 18) s.state.focusLock = false;
  const activeSlow = s.state.phase === 'play' && holdingSlow && !s.state.focusLock && s.state.focus > 0;
  const slow = activeSlow ? 0.45 : 1;
  const sim = dt * slow;
  animateScreens(s, time);

  if (s.state.phase === 'menu') {
    if (consumeAnyPressedControl(s, ['START1', 'P1_1', 'P1_2'])) startRun(s, time);
    return;
  }

  if (s.state.phase === 'over') {
    if (consumeAnyPressedControl(s, ['START1', 'P1_1', 'P1_2'])) showMenu(s);
    return;
  }

  if (s.state.phase === 'naming') {
    return;
  }

  updateCrosshair(s, dt);
  updateSkyline(s, time);
  if (s.state.phase === 'play' && time < s.state.startUntil) {
    const p = 1 - (s.state.startUntil - time) / Math.max(1, s.state.startUntil - s.state.startAt);
    s.flash.alpha = Math.max(s.flash.alpha, 0.34 * (1 - p));
    s.startText.setVisible(true);
    s.startText.alpha = 1 - p;
    s.startText.setScale(0.9 + p * 0.2);
    s.crosshair.setScale(1.2 - p * 0.2);
    setHudAlpha(s, 0.55 + p * 0.45);
  } else if (s.state.phase === 'play') {
    s.startText.setVisible(false);
    s.crosshair.setScale(1);
  }

  if (consumeAnyPressedControl(s, ['START1'])) {
    s.state.pauseLocked = !s.state.pauseLocked;
    s.pauseText.setVisible(s.state.pauseLocked);
  }
  if (s.state.pauseLocked && consumeAnyPressedControl(s, ['P1_2'])) {
    s.state.pauseLocked = false;
    s.pauseText.setVisible(false);
    showMenu(s);
    return;
  }
  if (s.state.pauseLocked) return;

  s.state.focusOn = activeSlow;
  if (s.state.focusOn) {
    s.state.focus = Math.max(0, s.state.focus - 28 * dt);
    if (s.state.focus <= 0) {
      s.state.focus = 0;
      s.state.focusOn = false;
      s.state.focusLock = true;
    }
  } else {
    s.state.focus = Math.min(100, s.state.focus + 18 * dt);
  }

  s.state.elapsed += dt;
  if (s.state.escapes >= MAX_ESCAPES) {
    return endRun(s);
  }

  if (time < s.state.startUntil) {
    refreshHud(s);
    return;
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
  s.add.circle(666, 92, 44, 0xffe38a, 0.92);
  s.add.circle(666, 92, 72, 0xffe38a, 0.12);
  s.clouds = [];
  s.skyFlyers = [];
  s.nextSkyFlyer = 5000;
  const clouds = [[98, 104, 0.12, 12], [286, 78, 0.08, 7], [548, 148, 0.1, 9], [722, 220, 0.07, 6]];
  for (let i = 0; i < clouds.length; i += 1) {
    const c = s.add.container(clouds[i][0], clouds[i][1]);
    c.baseX = clouds[i][0];
    c.baseY = clouds[i][1];
    c.speed = clouds[i][3];
    c.add(s.add.ellipse(0, 0, 90, 22, 0x9fb7c6, clouds[i][2]));
    c.add(s.add.ellipse(30, 3, 58, 18, 0xc4d4dc, clouds[i][2] * 0.72));
    c.add(s.add.ellipse(-34, 5, 48, 15, 0x8da8b8, clouds[i][2] * 0.64));
    s.clouds.push(c);
  }
  s.add.rectangle(400, 440, 800, 20, 0x46535c, 0.9);
  s.add.rectangle(400, 431, 800, 2, 0x718791, 0.45);
  s.add.rectangle(400, 449, 800, 2, 0x1b2429, 0.35);
  s.add.rectangle(400, 520, 800, 160, 0x162513);
  s.add.rectangle(400, 558, 800, 84, 0x254219);

  s.skyline = [];
  s.skyWindows = [];
  s.nextWindowShift = 0;
  const skyline = [44, 120, 72, 95, 58, 136, 84, 70, 110, 60, 92, 148, 76, 100];
  for (let i = 0; i < skyline.length; i += 1) {
    const x = 30 + i * 56;
    const h = skyline[i];
    const b = s.add.rectangle(x, 430 - h / 2, 42, h, i % 2 ? 0x193750 : 0x214560).setOrigin(0, 0.5);
    s.skyline.push(b);
    for (let y = 0; y < h - 16; y += 16) {
      if ((i + y) % 3) {
        const w = s.add.rectangle(x + 8 + (y % 2) * 12, 430 - h + 16 + y, 6, 8, (i + y) % 4 ? 0x7af0ff : 0xb8ff6a, 0.38);
        w.baseAlpha = 0.08 + ((i + y) % 4) * 0.03;
        w.litAlpha = w.baseAlpha + 0.24 + ((i + y) % 2) * 0.05;
        w.lit = Math.random() > 0.72;
        s.skyWindows.push(w);
      }
    }
    if (i % 3 === 0) {
      s.add.text(x + 5, 430 - h + 10, i % 2 ? 'if' : '</>', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: i % 2 ? '#b8ff6a' : '#7af0ff',
      }).setAlpha(0.35);
    }
  }

  const obX = 468;
  const ob = s.add.graphics();
  ob.fillStyle(0x1f3d54, 0.56);
  ob.beginPath();
  ob.moveTo(obX - 12, 432);
  ob.lineTo(obX - 12, 270);
  ob.lineTo(obX - 8, 242);
  ob.lineTo(obX, 232);
  ob.lineTo(obX + 8, 242);
  ob.lineTo(obX + 12, 270);
  ob.lineTo(obX + 12, 432);
  ob.closePath();
  ob.fillPath();

  const obShade = s.add.graphics();
  obShade.fillStyle(0x11283a, 0.22);
  obShade.beginPath();
  obShade.moveTo(obX - 12, 432);
  obShade.lineTo(obX - 12, 270);
  obShade.lineTo(obX - 6, 243);
  obShade.lineTo(obX, 232);
  obShade.lineTo(obX, 432);
  obShade.closePath();
  obShade.fillPath();

  const obLight = s.add.graphics();
  obLight.fillStyle(0xa9c3d2, 0.14);
  obLight.beginPath();
  obLight.moveTo(obX + 1, 237);
  obLight.lineTo(obX + 5, 250);
  obLight.lineTo(obX + 9, 270);
  obLight.lineTo(obX + 9, 432);
  obLight.lineTo(obX + 1, 432);
  obLight.closePath();
  obLight.fillPath();

  s.skyHaze = s.add.container(120, 132).setDepth(2);
  s.skyHaze.add(s.add.ellipse(0, 0, 84, 22, 0x8fb3c8, 0.08));
  s.skyHaze.add(s.add.ellipse(28, 4, 62, 18, 0xa8c4d4, 0.06));
  s.skyHaze.add(s.add.ellipse(-24, 5, 54, 16, 0x8fb3c8, 0.05));


  for (let y = 74; y < 600; y += 6) {
    s.add.rectangle(400, y, 800, 1, 0xffffff, 0.028);
  }

  s.hudTop = s.add.rectangle(400, 42, 748, 44, 0x03070c, 0.78).setStrokeStyle(2, 0x9fffe0, 0.35);
  s.scoreText = addText(s, 44, 32, 'BUILD SCORE 0000', 22, '#f6ffb0', 'left');
  s.comboText = addText(s, 284, 32, 'CHAIN X1', 22, '#7af0ff', 'left');
  s.timeText = addText(s, 500, 32, 'UPTIME 0', 22, '#ffd06a', 'left');
  s.escapeText = addText(s, 648, 32, 'LEAKS 0/7', 22, '#ff8c78', 'left');
  s.focusLabel = addText(s, 44, 64, 'SLOWMO', 14, '#c6fff7', 'left');
  s.focusBar = s.add.rectangle(126, 72, 120, 10, 0x17344b).setOrigin(0, 0.5).setStrokeStyle(2, 0x7af0ff, 0.4);
  s.focusFill = s.add.rectangle(126, 72, 120, 10, 0x7af0ff).setOrigin(0, 0.5);
  s.statusText = addText(s, 400, 578, 'P1 CURSOR  U PATCH  I DEBUG  ENTER PAUSA', 14, '#d8fff6', 'center');

  s.targetLayer = s.add.container(0, 0).setDepth(10);
  s.fxLayer = s.add.container(0, 0).setDepth(18);

  s.crosshair = s.add.container(400, 320);
  const crosshairShape = s.add.graphics();
  crosshairShape.lineStyle(2, 0xf5ffe1, 1);
  crosshairShape.strokeCircle(0, 0, 16);
  crosshairShape.beginPath();
  crosshairShape.moveTo(-9, 0);
  crosshairShape.lineTo(9, 0);
  crosshairShape.moveTo(0, -9);
  crosshairShape.lineTo(0, 9);
  crosshairShape.strokePath();
  s.crosshair.add(crosshairShape);
  s.crossPulse = s.add.circle(0, 0, 22, 0x000000, 0).setStrokeStyle(3, 0xffa25c, 0);
  s.crosshair.add(s.crossPulse);
  s.crosshair.add(s.add.circle(0, 0, 3, 0xff6a3d, 1));
  s.crosshair.setDepth(20);

  s.gun = s.add.container(400, 548).setDepth(19);
  const gunShadow = s.add.ellipse(0, 18, 84, 10, 0x05090d, 0.14);
  const stockBack = s.add.rectangle(-30, 3, 14, 12, 0x6a2e42, 1);
  const stockMid = s.add.rectangle(-20, 0, 14, 16, 0x8f4560, 1);
  const stockTip = s.add.rectangle(-10, -2, 10, 12, 0xc26b60, 1);
  const receiver = s.add.rectangle(3, -2, 28, 14, 0x4c5087, 1).setStrokeStyle(2, 0x182a38, 0.82);
  const receiverFace = s.add.rectangle(-1, -2, 10, 8, 0x747ab3, 1);
  const sight = s.add.rectangle(2, -11, 14, 3, 0x95a6ca, 1);
  const glow = s.add.rectangle(1, -2, 8, 4, 0x7af0ff, 0.42);
  const trigger = s.add.arc(-5, 8, 5, Phaser.Math.DegToRad(18), Phaser.Math.DegToRad(170), false, 0xdde8f0, 1)
    .setStrokeStyle(2, 0x182a38, 0.75);
  const grip = s.add.triangle(-6, 13, -6, -2, 8, -2, -1, 17, 0x5a2337, 1).setStrokeStyle(2, 0x182a38, 0.72);
  const gunBarrel = s.add.container(16, -2);
  gunBarrel.add(s.add.rectangle(10, 0, 20, 6, 0xdbe6ef, 1).setStrokeStyle(2, 0x182a38, 0.8));
  gunBarrel.add(s.add.rectangle(21, 0, 10, 4, 0xb7c6d0, 1));
  gunBarrel.add(s.add.rectangle(28, 0, 6, 8, 0xff9a62, 1));
  gunBarrel.add(s.add.rectangle(-1, 0, 8, 10, 0x90a7c0, 1));
  const muzzleFlash = s.add.star(31, 0, 5, 3, 8, 0xfff0b0, 1).setScale(0).setAlpha(0);
  gunBarrel.add(muzzleFlash);
  s.gun.barrel = gunBarrel;
  s.gun.flash = muzzleFlash;
  s.gun.kick = 0;
  s.gun.add([gunShadow, stockBack, stockMid, stockTip, receiver, receiverFace, sight, glow, trigger, grip, gunBarrel]);

  s.flash = s.add.rectangle(400, 300, 800, 600, 0xfff4cc, 0).setDepth(30);
  s.startText = addText(s, 400, 248, 'DEPLOY!', 30, '#f6ffb0', 'center', true)
    .setDepth(32)
    .setVisible(false);
  s.pauseText = addText(s, 400, 286, 'PAUSA\nENTER CONTINUA\nI TERMINA PARTIDA', 28, '#ffffff', 'center')
    .setDepth(40)
    .setVisible(false);

  s.menu = s.add.container(0, 0).setDepth(50);
  s.menu.add(s.add.rectangle(400, 300, 800, 600, 0x03070c, 0.84));
  s.menuFrame = s.add.rectangle(400, 300, 650, 462, 0x03070c, 0.66).setStrokeStyle(2, 0x7af0ff, 0.28);
  s.menuRuleTop = s.add.rectangle(400, 212, 500, 2, 0x7af0ff, 0.34);
  s.menuRuleBottom = s.add.rectangle(400, 366, 500, 2, 0xffd06a, 0.3);
  s.menuTitle = addText(s, 400, 72, 'PALOMA PANIC', 44, '#f7ffb5', 'center', true);
  s.menuSub = addText(s, 400, 122, 'PROD PANIC', 24, '#ff8c78', 'center', true);
  s.menuTag = addText(s, 400, 160, 'DEFENDE EL DEPLOY DE BUENOS AIRES', 16, '#7af0ff', 'center', true);
  s.menuInfo = addText(s, 400, 236, '', 17, '#e2fff8', 'center');
  s.menuDesc = addText(s, 400, 288, '', 16, '#d8fff6', 'center');
  s.menuHigh = addText(s, 400, 390, '', 15, '#d8fff6', 'center');
  s.menuHelp = addText(s, 400, 548, 'ENTER / U  DEPLOY', 22, '#ffd06a', 'center', true);
  s.menu.add([s.menuFrame, s.menuRuleTop, s.menuRuleBottom, s.menuTitle, s.menuSub, s.menuTag, s.menuInfo, s.menuDesc, s.menuHigh, s.menuHelp]);

  s.over = s.add.container(0, 0).setDepth(55).setVisible(false);
  s.over.add(s.add.rectangle(400, 300, 800, 600, 0x02050a, 0.92));
  s.overFrame = s.add.rectangle(400, 308, 664, 410, 0x07111f, 0.42).setStrokeStyle(2, 0xff8c78, 0.52);
  s.overBand = s.add.rectangle(244, 104, 324, 52, 0x162513, 0.58).setStrokeStyle(2, 0xffd06a, 0.42);
  s.overTitle = addText(s, 92, 86, 'BUILD CERRADO', 34, '#fff7b1', 'left', true);
  s.overScoreLabel = addText(s, 96, 154, 'BUILD SCORE', 15, '#7af0ff', 'left', true);
  s.overScore = addText(s, 94, 176, '', 42, '#f7ffb5', 'left', true);
  s.overMetrics = addText(s, 104, 284, '', 18, '#e7fff8', 'left');
  s.overTable = addText(s, 474, 190, '', 18, '#7af0ff', 'left');
  s.overHelp = addText(s, 400, 516, 'ENTER / U  REDEPLOY', 18, '#ffd06a', 'center', true);
  s.over.add([s.overFrame, s.overBand, s.overTitle, s.overScoreLabel, s.overScore, s.overMetrics, s.overTable, s.overHelp]);

}

function createNameInput(s) {
  const root = document.getElementById('game-root') || document.body;
  if (root !== document.body && getComputedStyle(root).position === 'static') root.style.position = 'relative';
  const wrap = document.createElement('div');
  wrap.style.position = root === document.body ? 'fixed' : 'absolute';
  wrap.style.inset = '0';
  wrap.style.display = 'none';
  wrap.style.alignItems = 'center';
  wrap.style.justifyContent = 'center';
  wrap.style.background = 'rgba(2,5,10,0.72)';
  wrap.style.zIndex = '99';

  const card = document.createElement('div');
  card.style.width = 'min(420px, 82%)';
  card.style.padding = '22px 24px';
  card.style.border = '2px solid rgba(122,240,255,0.45)';
  card.style.background = 'rgba(3,7,12,0.96)';
  card.style.boxShadow = '0 12px 40px rgba(0,0,0,0.45)';
  card.style.fontFamily = 'monospace';
  card.style.color = '#e7fff8';
  card.style.textAlign = 'center';

  const title = document.createElement('div');
  title.textContent = 'Nuevo Record';
  title.style.fontSize = '28px';
  title.style.fontWeight = '700';
  title.style.color = '#fff7b1';
  title.style.marginBottom = '10px';

  const subtitle = document.createElement('div');
  subtitle.textContent = 'Ingresa tu nombre';
  subtitle.style.fontSize = '15px';
  subtitle.style.color = '#7af0ff';
  subtitle.style.marginBottom = '16px';

  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 12;
  input.placeholder = 'CPU';
  input.style.width = '100%';
  input.style.boxSizing = 'border-box';
  input.style.padding = '12px 14px';
  input.style.fontFamily = 'monospace';
  input.style.fontSize = '22px';
  input.style.border = '2px solid #7af0ff';
  input.style.background = '#081018';
  input.style.color = '#f6ffb0';
  input.style.outline = 'none';
  input.autocomplete = 'off';

  const help = document.createElement('div');
  help.textContent = 'Presiona Enter o el boton guardar';
  help.style.marginTop = '12px';
  help.style.fontSize = '13px';
  help.style.color = '#ffd06a';

  const actions = document.createElement('div');
  actions.style.marginTop = '16px';
  actions.style.display = 'flex';
  actions.style.gap = '10px';
  actions.style.justifyContent = 'center';

  const save = document.createElement('button');
  save.textContent = 'Guardar';
  save.style.padding = '10px 16px';
  save.style.fontFamily = 'monospace';
  save.style.fontSize = '16px';
  save.style.fontWeight = '700';
  save.style.border = '2px solid #b8ff6a';
  save.style.background = '#182a38';
  save.style.color = '#f6ffb0';
  save.style.cursor = 'pointer';

  actions.appendChild(save);
  card.append(title, subtitle, input, help, actions);
  wrap.appendChild(card);
  root.appendChild(wrap);

  s.nameUi = { wrap, input, save };
  const submit = () => finishNameEntry(s);
  save.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
  s.events.once('shutdown', () => {
    wrap.remove();
  });
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

function animateScreens(s, time) {
  const p = 0.5 + 0.5 * Math.sin(time * 0.004);
  if (s.menu && s.menu.visible) {
    s.menuTitle.setScale(1 + p * 0.018);
    s.menuSub.alpha = 0.72 + p * 0.28;
    s.menuHelp.alpha = 0.58 + p * 0.42;
    s.menuFrame.setStrokeStyle(2, 0x7af0ff, 0.22 + p * 0.2);
    s.menuRuleBottom.alpha = 0.18 + p * 0.34;
  }
  if (s.over && s.over.visible) {
    s.overBand.alpha = 0.48 + p * 0.22;
    s.overFrame.setStrokeStyle(2, 0xff8c78, 0.38 + p * 0.24);
    s.overHelp.alpha = 0.6 + p * 0.4;
  }
}

function showMenu(s) {
  s.state.phase = 'menu';
  s.targets.forEach(killTarget);
  s.targets.length = 0;
  s.shards.forEach((p) => p.destroy());
  s.shards.length = 0;
  s.beams.forEach((b) => b.line.destroy());
  s.beams.length = 0;
  s.crosshair.setVisible(false);
  s.startText.setVisible(false);
  setHudAlpha(s, 0.16);
  hideNameInput(s);
  s.menu.setVisible(true);
  s.over.setVisible(false);
  s.pauseText.setVisible(false);
  const best = s.state.hi[0] ? s.state.hi[0].score : 0;
  const lines = ['MEJORES PUNTAJES'];
  for (let i = 0; i < MAX_HIGH_SCORES; i += 1) {
    const row = s.state.hi[i];
    lines.push((i + 1) + '. ' + (row ? row.name : '---') + '  ' + String(row ? row.score : 0).padStart(4, '0'));
  }
  s.menuInfo.setText('SHOOTER ARCADE DE REFLEJOS\nNO DEJES FILTRAR MAS DE ' + MAX_ESCAPES + ' LEAKS');
  s.menuDesc.setText(
    'U PATCH   I DEBUG\n' +
    'MUEVE LA MIRA Y ENCADENA FIXES'
  );
  s.menuHigh.setText('BEST BUILD ' + String(best).padStart(4, '0') + '\n' + lines.join('\n'));
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
  s.state.elapsed = 0;
  s.state.focus = 100;
  s.state.flashAt = 0;
  s.state.focusLock = false;
  s.state.pauseLocked = false;
  s.state.startAt = time;
  s.state.startUntil = time + 550;
  s.state.spawnAt = time + 400;
  s.crosshair.setVisible(true);
  s.startText.setVisible(true);
  s.startText.alpha = 1;
  s.startText.setScale(0.9);
  s.flash.alpha = 0.34;
  setHudAlpha(s, 0.55);
  s.crosshair.setPosition(400, 320);
  s.crosshair.setScale(1.2);
  refreshHud(s);
}

function endRun(s) {
  s.state.lastScore = s.state.score;
  s.targets.forEach(killTarget);
  s.targets.length = 0;
  s.beams.forEach((b) => b.line.destroy());
  s.beams.length = 0;
  s.crosshair.setVisible(false);
  s.startText.setVisible(false);
  setHudAlpha(s, 0.12);
  const acc = s.state.shots ? Math.round((100 * s.state.hits) / s.state.shots) : 0;
  const score = String(s.state.score).padStart(4, '0');
  const metrics =
    'PATCH RATE ' + acc + '%' +
    '\nBEST CHAIN X' + s.state.bestCombo +
    '\nUPTIME ' + Math.floor(s.state.elapsed) + 's' +
    '\nLEAKS ' + s.state.escapes + '/' + MAX_ESCAPES;
  s.state.phase = 'naming';
  s.state.pendingScore = score;
  s.state.pendingMetrics = metrics;
  showNameInput(s);
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
  s.scoreText.setText('BUILD SCORE ' + String(s.state.score).padStart(4, '0'));
  s.comboText.setText('CHAIN X' + Math.max(1, s.state.combo));
  s.timeText.setText('UPTIME ' + Math.floor(s.state.elapsed));
  s.escapeText.setText('LEAKS ' + s.state.escapes + '/' + MAX_ESCAPES);
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
  s.gun.kick = Math.max(0, s.gun.kick - dt * 7);
  s.gun.barrel.x = 18 - s.gun.kick * 8;
  s.gun.flash.alpha = s.gun.kick > 0 ? s.gun.kick * 1.8 : 0;
  s.gun.flash.setScale(0.2 + s.gun.kick * 1.2);
  s.gun.barrel.rotation = Phaser.Math.Clamp(Phaser.Math.Angle.Between(s.gun.x + 12, s.gun.y - 1, s.crosshair.x, s.crosshair.y), -2.05, -1.15);
  s.state.crossPulse = Math.max(0, s.state.crossPulse - dt * 5.5);
  s.crossPulse.alpha = s.state.crossPulse;
  s.crossPulse.setScale(0.55 + (1 - s.state.crossPulse) * 0.75);
}

function spawnTarget(s, time) {
  if (s.targets.length >= MAX_TARGETS) {
    s.state.spawnAt = time + Phaser.Math.Between(240, 380);
    return;
  }
  const elapsed = s.state.elapsed;
  const left = Math.random() > 0.5;
  const y = Phaser.Math.Between(120, 410);
  const typeRoll = Math.random();
  let type = 'pigeon';
  if (elapsed > 22 && typeRoll > 0.972) type = 'storm';
  else if (elapsed > 14 && typeRoll > 0.93) type = 'gold';
  else if (elapsed > START_GRACE && typeRoll > 0.8) type = 'swift';
  const skin = type === 'pigeon' && Math.random() > 0.55 ? 'dark' : '';
  const dir = left ? 1 : -1;
  const earlyFactor = elapsed < 18 ? Phaser.Math.Linear(0.76, 1, elapsed / 18) : 1;
  const speed = (type === 'storm' ? Phaser.Math.Between(108, 145) : type === 'swift' ? Phaser.Math.Between(185, 235) : type === 'gold' ? Phaser.Math.Between(128, 162) : Phaser.Math.Between(105, 158)) * earlyFactor;
  const amp = type === 'storm' ? Phaser.Math.Between(8, 18) : type === 'swift' ? Phaser.Math.Between(16, 40) : Phaser.Math.Between(10, 28);
  const body = s.add.container(left ? -60 : 860, y);
  const tint = type === 'storm' ? 0xff6a8f : type === 'gold' ? 0xffcf5a : type === 'swift' ? 0x7af0ff : skin ? 0x9fb7c6 : 0xe6f3ff;
  const shell = type === 'storm' ? 0x34111f : type === 'gold' ? 0x44391c : type === 'swift' ? 0x133c50 : skin ? 0x253b4b : 0x182a38;
  const bodyW = type === 'storm' ? 58 : type === 'swift' ? 40 : 46;
  const bodyH = type === 'storm' ? 28 : type === 'swift' ? 18 : 22;
  const headX = type === 'storm' ? 19 : 15;
  const headY = type === 'storm' ? -8 : -7;
  const headR = type === 'storm' ? 11 : 8;
  const wingColor = type === 'storm' ? 0xb93f6b : type === 'gold' ? 0xffe08a : type === 'swift' ? 0x9ff6ff : skin ? 0x6f8b9d : 0xc8dae5;
  const core = s.add.ellipse(-2, 0, bodyW, bodyH, tint, 1).setStrokeStyle(2, shell, 0.95);
  const belly = s.add.ellipse(-4, 2, bodyW * 0.52, bodyH * 0.42, 0xffffff, type === 'storm' ? 0.2 : 0.28);
  const wingBottom = s.add.ellipse(-8, 5, bodyW * 0.58, bodyH * 0.46, wingColor, 0.92)
    .setStrokeStyle(1, shell, 0.28);
  const wingTop = s.add.ellipse(-4, -3, bodyW * 0.68, bodyH * 0.54, wingColor, 0.98)
    .setStrokeStyle(1, shell, 0.34);
  const head = s.add.circle(headX, headY, headR, tint, 1).setStrokeStyle(2, shell, 0.95);
  const neck = s.add.ellipse(10, -3, bodyW * 0.22, bodyH * 0.34, tint, 1);
  const beak = s.add.triangle(type === 'storm' ? 31 : 25, headY + 1, 12, 0, 0, -4, 0, 4, 0xff7b5a, 1);
  const tailTop = s.add.triangle(type === 'storm' ? -30 : -24, -4, 0, 0, -16, -4, -6, 4, wingColor, 0.95)
    .setStrokeStyle(1, shell, 0.28);
  const tailBottom = s.add.triangle(type === 'storm' ? -29 : -23, 4, 0, 0, -14, 4, -5, -4, wingColor, 0.82)
    .setStrokeStyle(1, shell, 0.22);
  const eyeWhite = s.add.circle(headX + (type === 'storm' ? 2 : 1), headY - 2, type === 'storm' ? 3.2 : 2.5, 0xffffff, 1);
  const eye = s.add.circle(headX + (type === 'storm' ? 3 : 2), headY - 2, 1.4, 0x081018, 1);
  let accent = null;
  if (type === 'gold') {
    accent = s.add.container(0, 0);
    accent.add(s.add.line(-30, -3, 0, 0, -16, 0, 0xfff0b0, 0.9).setLineWidth(2, 5));
    accent.add(s.add.line(-26, 5, 0, 0, -12, 0, 0xffcf5a, 0.7).setLineWidth(2, 4));
  } else if (type === 'swift') {
    accent = s.add.container(0, 0);
    accent.add(s.add.line(-31, -5, 0, 0, -18, 0, 0x9ff6ff, 0.95).setLineWidth(2, 5));
    accent.add(s.add.line(-34, 1, 0, 0, -14, 0, 0x7af0ff, 0.72).setLineWidth(2, 4));
    accent.add(s.add.line(-27, 7, 0, 0, -10, 0, 0xd8fff6, 0.55).setLineWidth(1, 3));
  }
  else if (type === 'storm') accent = s.add.ellipse(-6, 0, bodyW * 0.9, bodyH * 0.8, 0xff7aa3, 0.08).setStrokeStyle(2, 0xffb2c4, 0.22);
  body.add([tailBottom, tailTop, accent, wingBottom, core, belly, wingTop, neck, head, beak, eyeWhite, eye].filter(Boolean));
  let halo = null;
  let shield = null;
  if (type === 'storm') {
    halo = s.add.circle(-4, 0, 34, 0x000000, 0).setStrokeStyle(4, 0xffb2c4, 0.9);
    shield = s.add.text(-4, -40, '3', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#fff2a8',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    body.add([halo, shield]);
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
    wingTop,
    wingBottom,
    accent,
    halo,
    shield,
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
    t.wingTop.rotation = Math.sin(age * 16) * 0.35;
    t.wingBottom.rotation = -Math.sin(age * 16) * 0.35;
    if (t.accent) {
      if (t.type === 'gold') t.accent.alpha = 0.12 + 0.08 * (0.5 + 0.5 * Math.sin(age * 8 + t.flap));
      else if (t.type === 'swift') {
        t.accent.alpha = 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(age * 14 + t.flap));
        t.accent.scaleX = 0.9 + 0.4 * (0.5 + 0.5 * Math.sin(age * 10 + t.flap));
      } else if (t.type === 'storm') t.accent.alpha = 0.05 + 0.08 * (0.5 + 0.5 * Math.sin(age * 9 + t.flap));
    }
    t.body.alpha = 1;
    if (t.type === 'storm') {
      t.halo.alpha = 0.5 + Math.sin(age * 8) * 0.2;
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
  s.gun.kick = 1;
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
      if (hit.shield) hit.shield.setText(String(hit.hp));
      sparkHit(s, hit.x, hit.y, hit.type);
      pulseCrosshair(s, hit.type);
      pulseHud(s, '#ff9db7');
      tone(s, 320, 0.08, 'sawtooth');
      popScore(s, hit.x, hit.y - 26, 'PATCH ' + hit.hp, '#fff2a8');
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
    sparkHit(s, hit.x, hit.y, hit.type);
    pulseCrosshair(s, hit.type);
    popScore(s, hit.x, hit.y - 20, (hit.type === 'storm' ? 'PURGE ' : 'FIX +') + gain, hit.type === 'storm' ? '#ffb2c4' : hit.type === 'gold' ? '#ffd06a' : '#e2fff8');
    if (s.state.combo >= 5 && s.state.combo % 5 === 0) popScore(s, hit.x, hit.y - 46, 'CHAIN X' + s.state.combo, '#7af0ff');
    if (hit.type === 'storm') {
      clearScreenBlast(s, hit, time);
      pulseHud(s, '#ff6a8f');
      tone(s, 220, 0.18, 'sawtooth');
    } else {
      explodeTarget(s, hit);
      pulseHud(s, hit.type === 'gold' ? '#ffd06a' : '#7af0ff');
      weaponBlast(s, hit.type === 'gold' ? 820 : 640 + Math.min(180, s.state.combo * 10), hit.type === 'gold' ? 0.08 : 0.065);
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
    if (p.grow) p.setScale(1 + (1 - p.life / p.maxLife) * p.grow);
    if (p.label) p.setScale(1 + (1 - p.life / p.maxLife) * 0.4);
    if (p.life <= 0) {
      s.shards.splice(i, 1);
      p.destroy();
    }
  }
}

function stepBeams(s, dt, time) {
  for (let i = s.beams.length - 1; i >= 0; i -= 1) {
    const b = s.beams[i];
    if (time > b.die) {
      s.beams.splice(i, 1);
      b.line.destroy();
    }
  }
}

function pulseCrosshair(s, type) {
  const color = type === 'storm' ? 0xff7aa3 : type === 'gold' ? 0xffcf5a : 0x7af0ff;
  s.state.crossPulse = 1;
  s.crossPulse.setStrokeStyle(3, color, 1);
}

function sparkHit(s, x, y, type) {
  const hot = type === 'storm' ? 0xff7aa3 : type === 'gold' ? 0xffcf5a : 0xffa25c;
  const warm = type === 'storm' ? 0xffd1df : type === 'gold' ? 0xfff1b8 : 0xfff0c8;
  const flash = s.add.circle(x, y, 12, warm, 0.95);
  flash.vx = 0;
  flash.vy = 0;
  flash.life = flash.maxLife = 0.16;
  flash.spin = 0;
  s.fxLayer.add(flash);
  s.shards.push(flash);
  const ring = s.add.circle(x, y, 8, 0x000000, 0).setStrokeStyle(3, hot, 0.95);
  ring.vx = 0;
  ring.vy = 0;
  ring.life = ring.maxLife = 0.26;
  ring.spin = 0;
  ring.grow = type === 'storm' ? 3.2 : 2.4;
  s.fxLayer.add(ring);
  s.shards.push(ring);
  for (let i = 0; i < 7; i += 1) {
    const flame = s.add.rectangle(x, y, Phaser.Math.Between(6, 12), Phaser.Math.Between(2, 5), i % 2 ? warm : hot);
    flame.vx = Phaser.Math.Between(-180, 180);
    flame.vy = Phaser.Math.Between(-210, 90);
    flame.life = flame.maxLife = 0.2 + Math.random() * 0.14;
    flame.spin = Phaser.Math.FloatBetween(-8, 8);
    s.fxLayer.add(flame);
    s.shards.push(flame);
  }
  for (let i = 0; i < 5; i += 1) {
    const ember = s.add.circle(x, y, Phaser.Math.Between(2, 4), hot, 1);
    ember.vx = Phaser.Math.Between(-120, 120);
    ember.vy = Phaser.Math.Between(-150, 50);
    ember.life = ember.maxLife = 0.24 + Math.random() * 0.12;
    ember.spin = 0;
    s.fxLayer.add(ember);
    s.shards.push(ember);
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
  for (let i = 0; i < 2; i += 1) {
    const p = s.add.text(t.x, t.y, CODE_BITS[Phaser.Math.Between(0, CODE_BITS.length - 1)], {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: t.type === 'storm' ? '#ffb2c4' : t.type === 'gold' ? '#ffd06a' : '#7af0ff',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    p.vx = Phaser.Math.Between(-90, 90);
    p.vy = Phaser.Math.Between(-180, 20);
    p.life = p.maxLife = 0.38 + Math.random() * 0.18;
    p.spin = Phaser.Math.FloatBetween(-2, 2);
    p.label = true;
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
    popScore(s, t.x, t.y - 20, 'FIX +' + gain, t.type === 'gold' ? '#ffd06a' : '#e2fff8');
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
  if (time >= s.nextWindowShift) {
    s.nextWindowShift = time + 5000;
    for (let i = 0; i < s.skyWindows.length; i += 1) {
      const w = s.skyWindows[i];
      if (Math.random() > 0.55) w.lit = !w.lit;
    }
  }
  for (let i = 0; i < s.skyWindows.length; i += 1) {
    const w = s.skyWindows[i];
    w.alpha = w.lit ? w.litAlpha : w.baseAlpha;
  }
  for (let i = 0; i < s.clouds.length; i += 1) {
    const c = s.clouds[i];
    c.x = ((c.baseX + time * 0.001 * c.speed + 110) % 1020) - 110;
    c.y = c.baseY + Math.sin(time * 0.0007 + i) * 2;
  }
  if (time > s.nextSkyFlyer) spawnSkyFlyer(s, time);
  for (let i = s.skyFlyers.length - 1; i >= 0; i -= 1) {
    const f = s.skyFlyers[i];
    f.body.x += f.vx;
    f.body.y = f.baseY + Math.sin(time * 0.002 + f.phase) * 4;
    if (f.blink) f.blink.alpha = 0.2 + 0.5 * (0.5 + 0.5 * Math.sin(time * 0.012));
    if (f.beam) f.beam.alpha = 0.03 + 0.05 * (0.5 + 0.5 * Math.sin(time * 0.004 + f.phase));
    if (f.body.x < -90 || f.body.x > 890) {
      s.skyFlyers.splice(i, 1);
      f.body.destroy();
    }
  }
  s.skyHaze.x = 120 + ((time * 0.012) % 860);
  s.skyHaze.alpha = 0.6 + 0.2 * Math.sin(time * 0.0014);
}

function spawnSkyFlyer(s, time) {
  s.nextSkyFlyer = time + Phaser.Math.Between(18000, 32000);
  const left = Math.random() > 0.5;
  const body = s.add.container(left ? -70 : 870, Phaser.Math.Between(74, 174)).setAlpha(0.72);
  const beam = s.add.triangle(0, 22, -20, 0, 20, 0, 0, 70, 0x7af0ff, 0.06);
  const blink = s.add.container(0, 0);
  body.add(beam);
  body.add(s.add.ellipse(0, -9, 30, 16, 0xbfe8ef, 0.58).setStrokeStyle(1, 0x7af0ff, 0.52));
  body.add(s.add.ellipse(0, 0, 58, 15, 0x9fb7c6, 0.9).setStrokeStyle(2, 0x526b78, 0.72));
  body.add(s.add.rectangle(0, -5, 34, 7, 0x9fb7c6, 0.9));
  body.add(s.add.ellipse(0, 4, 72, 12, 0x596f7a, 0.84));
  body.add(s.add.ellipse(0, 7, 42, 6, 0x2b414b, 0.72));
  for (let i = -1; i <= 1; i += 1) blink.add(s.add.circle(i * 17, 3, 3, i ? 0xffd06a : 0xb8ff6a, 0.9));
  body.add(blink);
  s.skyFlyers.push({ body, blink, beam, vx: (left ? 1 : -1) * Phaser.Math.FloatBetween(0.72, 1.05), baseY: body.y, phase: Math.random() * 6 });
}

function killTarget(t) {
  t.body.destroy();
}

function normalizeScoreEntry(v) {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return { name: 'CPU', score: v };
  if (!v || typeof v !== 'object') return null;
  const score = Number(v.score);
  if (!Number.isFinite(score) || score < 0) return null;
  const raw = typeof v.name === 'string' ? v.name.replace(/\s+/g, ' ').trim().slice(0, 12) : 'CPU';
  return { name: raw || 'CPU', score };
}

function keepScores(list, entry) {
  const next = Array.isArray(list) ? list.map(normalizeScoreEntry).filter(Boolean) : [];
  const row = normalizeScoreEntry(entry);
  if (row) next.push(row);
  next.sort((a, b) => b.score - a.score);
  return next.slice(0, MAX_HIGH_SCORES);
}

function qualifiesForHighScore(list, score) {
  const rows = keepScores(list);
  return rows.length < MAX_HIGH_SCORES || score > rows[rows.length - 1].score;
}

function formatHighScoreTable(list) {
  const rows = keepScores(list);
  const out = ['TOP 5 BUILD'];
  for (let i = 0; i < MAX_HIGH_SCORES; i += 1) {
    const row = rows[i];
    out.push((i + 1) + '. ' + (row ? row.name.padEnd(12, ' ') : '------------') + ' ' + String(row ? row.score : 0).padStart(4, '0'));
  }
  return out.join('\n');
}

function showNameInput(s) {
  if (!s.nameUi) return;
  s.nameUi.wrap.style.display = 'flex';
  s.nameUi.input.value = '';
  setTimeout(() => s.nameUi && s.nameUi.input.focus(), 0);
}

function hideNameInput(s) {
  if (!s.nameUi) return;
  s.nameUi.wrap.style.display = 'none';
}

function finishNameEntry(s) {
  if (!s.nameUi || s.state.phase !== 'naming') return;
  const clean = s.nameUi.input.value.replace(/\s+/g, ' ').trim().slice(0, 12) || 'CPU';
  if (qualifiesForHighScore(s.state.hi, s.state.score)) {
    s.state.hi = keepScores(s.state.hi, { name: clean, score: s.state.score });
    saveScores(s);
  }
  hideNameInput(s);
  s.state.phase = 'over';
  s.overScore.setText(s.state.pendingScore || String(s.state.score).padStart(4, '0'));
  s.overMetrics.setText('PLAYER ' + clean + '\n' + (s.state.pendingMetrics || ''));
  s.overTable.setText(formatHighScoreTable(s.state.hi));
  s.over.setVisible(true);
}

async function loadScores(s) {
  try {
    if (!window.platanusArcadeStorage) return;
    const result = await window.platanusArcadeStorage.get(STORAGE_KEY);
    if (result && result.found && Array.isArray(result.value)) s.state.hi = keepScores(result.value);
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

function weaponBlast(s, freq, dur) {
  const ctx = s.sound && s.sound.context;
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(freq, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(120, freq * 0.38), now + dur);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.08, now + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.012, now + dur * 0.45);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + dur + 0.02);
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
