/* Rat Run / Midnight Escape
 * Procedural canvas runner: no external assets, no build step, safe to host anywhere.
 */
(() => {
  'use strict';

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const W = 1280;
  const H = 720;
  const TAU = Math.PI * 2;
  const lanes = [-1, 0, 1];
  const laneX = (lane, z = 1) => W / 2 + lane * (92 + z * 86);
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => t * t * (3 - 2 * t);
  const random = (min, max) => Math.random() * (max - min) + min;
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

  const ui = {
    hud: document.getElementById('hud'),
    start: document.getElementById('startPanel'),
    pause: document.getElementById('pausePanel'),
    over: document.getElementById('gameOverPanel'),
    startButton: document.getElementById('startButton'),
    resumeButton: document.getElementById('resumeButton'),
    quitButton: document.getElementById('quitButton'),
    retryButton: document.getElementById('retryButton'),
    sound: document.getElementById('soundToggle'),
    fullscreen: document.getElementById('fullscreenButton'),
    score: document.getElementById('scoreValue'),
    distance: document.getElementById('distanceValue'),
    catMeter: document.getElementById('catMeter'),
    catStatus: document.getElementById('catStatus'),
    finalScore: document.getElementById('finalScore'),
    finalDistance: document.getElementById('finalDistance'),
    bestScore: document.getElementById('bestScore'),
    flash: document.getElementById('flashLayer'),
    tip: document.getElementById('runTip')
  };

  let scale = 1;
  let audio = null;
  let raf = 0;
  let last = 0;

  class AudioBed {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.enabled = true;
      this.ambience = [];
    }
    unlock() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.13;
      this.master.connect(this.ctx.destination);
      const hum = this.ctx.createOscillator();
      const humGain = this.ctx.createGain();
      hum.type = 'sine'; hum.frequency.value = 53; humGain.gain.value = .09;
      hum.connect(humGain).connect(this.master); hum.start();
      const air = this.ctx.createOscillator();
      const airGain = this.ctx.createGain();
      air.type = 'triangle'; air.frequency.value = 117; airGain.gain.value = .015;
      air.connect(airGain).connect(this.master); air.start();
      this.ambience = [hum, air];
    }
    setEnabled(enabled) {
      this.enabled = enabled;
      if (this.master) this.master.gain.setTargetAtTime(enabled ? .13 : 0, this.ctx.currentTime, .04);
    }
    blip(kind = 'dodge') {
      if (!this.ctx || !this.enabled) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();
      osc.type = kind === 'hit' ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(kind === 'hit' ? 135 : kind === 'jump' ? 420 : 250, now);
      osc.frequency.exponentialRampToValueAtTime(kind === 'hit' ? 48 : 720, now + (kind === 'hit' ? .42 : .13));
      filter.type = 'lowpass'; filter.frequency.value = kind === 'hit' ? 720 : 2400;
      gain.gain.setValueAtTime(kind === 'hit' ? .22 : .08, now);
      gain.gain.exponentialRampToValueAtTime(.001, now + (kind === 'hit' ? .45 : .18));
      osc.connect(filter).connect(gain).connect(this.master); osc.start(now); osc.stop(now + .5);
    }
  }

  class Game {
    constructor() {
      this.state = 'menu';
      this.elapsed = 0;
      this.runTime = 0;
      this.distance = 0;
      this.score = 0;
      this.best = Number(localStorage.getItem('rat-run-best') || 0);
      this.speed = 0;
      this.catPressure = 0.22;
      this.spawnClock = 0;
      this.obstacles = [];
      this.particles = [];
      this.streaks = [];
      this.floatingText = [];
      this.lights = [];
      this.screenShake = 0;
      this.flash = 0;
      this.tipTimer = 0;
      this.worldScroll = 0;
      this.lastObstacleType = '';
      this.rat = { lane: 0, visualLane: 0, jump: 0, slide: 0, run: 0, tilt: 0, invulnerable: 0 };
      this.cat = { run: 0, lunge: 0 };
      this.seedWorld();
      this.bind();
      this.resize();
      this.showOverlay('menu');
    }

    seedWorld() {
      this.lights = [];
      for (let i = 0; i < 16; i++) this.lights.push({ z: i / 16, flicker: random(0, TAU), side: i % 2 ? 1 : -1 });
      this.streaks = Array.from({ length: 85 }, () => ({ x: random(0, W), y: random(0, H), len: random(2, 12), speed: random(.4, 1.4), alpha: random(.08, .3) }));
      this.particles = Array.from({ length: 46 }, () => ({ x: random(0, W), y: random(0, H), size: random(1, 3), alpha: random(.1, .42), speed: random(5, 17), phase: random(0, TAU) }));
    }

    bind() {
      ui.startButton.addEventListener('click', () => this.start());
      ui.retryButton.addEventListener('click', () => this.start());
      ui.resumeButton.addEventListener('click', () => this.resume());
      ui.quitButton.addEventListener('click', () => this.toMenu());
      ui.sound.addEventListener('click', () => {
        audio.unlock(); audio.setEnabled(!audio.enabled);
        ui.sound.setAttribute('aria-pressed', String(audio.enabled));
        ui.sound.setAttribute('aria-label', audio.enabled ? 'Turn sound off' : 'Turn sound on');
        ui.sound.textContent = audio.enabled ? '◖' : '◌';
      });
      ui.fullscreen.addEventListener('click', () => {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
        else document.exitFullscreen?.();
      });
      window.addEventListener('resize', () => this.resize());
      window.addEventListener('keydown', (event) => this.keydown(event));
      document.querySelectorAll('[data-action]').forEach((button) => {
        button.addEventListener('pointerdown', (event) => { event.preventDefault(); this.action(button.dataset.action); });
      });
      let touchStart = null;
      canvas.addEventListener('touchstart', (event) => { touchStart = event.changedTouches[0]; }, { passive: true });
      canvas.addEventListener('touchend', (event) => {
        if (!touchStart || this.state !== 'playing') return;
        const touch = event.changedTouches[0];
        const dx = touch.clientX - touchStart.clientX;
        const dy = touch.clientY - touchStart.clientY;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
        if (Math.abs(dx) > Math.abs(dy)) this.action(dx > 0 ? 'right' : 'left');
        else this.action(dy > 0 ? 'slide' : 'jump');
        touchStart = null;
      }, { passive: true });
    }

    keydown(event) {
      const key = event.key.toLowerCase();
      if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' ', 'p', 'escape', 'a', 'd', 'w', 's'].includes(key)) event.preventDefault();
      if (key === 'p' || key === 'escape') {
        if (this.state === 'playing') this.pause();
        else if (this.state === 'paused') this.resume();
        return;
      }
      if (this.state !== 'playing') return;
      if (key === 'arrowleft' || key === 'a') this.action('left');
      if (key === 'arrowright' || key === 'd') this.action('right');
      if (key === 'arrowup' || key === 'w' || key === ' ') this.action('jump');
      if (key === 'arrowdown' || key === 's') this.action('slide');
    }

    action(type) {
      if (this.state !== 'playing') return;
      if (type === 'left' || type === 'right') {
        const delta = type === 'left' ? -1 : 1;
        const oldLane = this.rat.lane;
        this.rat.lane = clamp(this.rat.lane + delta, -1, 1);
        if (oldLane !== this.rat.lane) { audio.blip('dodge'); this.rat.tilt = delta * .14; }
      }
      if (type === 'jump' && this.rat.jump <= 0.02 && this.rat.slide <= 0.02) {
        this.rat.jump = 1; audio.blip('jump'); this.emitBurst(0, -1, 8, '#c9ee84');
      }
      if (type === 'slide' && this.rat.jump <= 0.02) { this.rat.slide = .62; audio.blip('dodge'); }
    }

    start() {
      audio.unlock();
      this.state = 'playing'; this.elapsed = 0; this.runTime = 0; this.distance = 0; this.score = 0; this.speed = 330;
      this.catPressure = .22; this.spawnClock = .52; this.obstacles = []; this.particles.length = 46; this.floatingText = [];
      this.rat = { lane: 0, visualLane: 0, jump: 0, slide: 0, run: 0, tilt: 0, invulnerable: 0 };
      this.cat = { run: 0, lunge: 0 }; this.screenShake = 0; this.flash = 0; this.tipTimer = 0;
      ui.tip.classList.remove('hidden');
      this.showOverlay(null);
      this.spawnIntroSet();
      audio.blip('jump');
    }

    pause() { if (this.state !== 'playing') return; this.state = 'paused'; this.showOverlay('pause'); }
    resume() { if (this.state !== 'paused') return; audio.unlock(); this.state = 'playing'; this.showOverlay(null); last = performance.now(); }
    toMenu() { this.state = 'menu'; this.showOverlay('menu'); this.seedWorld(); }

    gameOver(reason = 'collision') {
      if (this.state !== 'playing') return;
      this.state = 'gameover'; audio.blip('hit'); this.screenShake = .5; this.flash = .8;
      const score = Math.floor(this.score);
      if (score > this.best) { this.best = score; localStorage.setItem('rat-run-best', String(score)); }
      ui.finalScore.textContent = this.format(score); ui.finalDistance.textContent = `${Math.floor(this.distance)}m`; ui.bestScore.textContent = this.format(this.best);
      document.getElementById('gameOverBlurb').textContent = reason === 'cat' ? 'The shadow got a paw around the corner. Next time, trust the light.' : 'One bad step in the dark. The sewer keeps your secret.';
      this.showOverlay('over');
    }

    showOverlay(name) {
      [ui.start, ui.pause, ui.over].forEach((panel) => panel.classList.remove('active'));
      if (name === 'menu') ui.start.classList.add('active');
      if (name === 'pause') ui.pause.classList.add('active');
      if (name === 'over') ui.over.classList.add('active');
      ui.hud.classList.toggle('visible', name === null || name === 'pause');
    }

    spawnIntroSet() {
      this.obstacles.push({ lane: -1, z: .73, type: 'crate', checked: false, sway: random(0, TAU) });
      this.obstacles.push({ lane: 1, z: .49, type: 'puddle', checked: false, sway: random(0, TAU) });
    }

    spawnObstacle() {
      const z = .04;
      let type = pick(['crate', 'puddle', 'barrier', 'pipe']);
      if (type === this.lastObstacleType && Math.random() < .48) type = pick(['crate', 'puddle', 'barrier']);
      this.lastObstacleType = type;
      const lane = pick(lanes);
      this.obstacles.push({ lane, z, type, checked: false, sway: random(0, TAU), age: 0 });
      if (this.runTime > 16 && Math.random() < .19) {
        const secondLane = pick(lanes.filter((value) => value !== lane));
        this.obstacles.push({ lane: secondLane, z: z - .1, type: Math.random() < .5 ? 'puddle' : 'crate', checked: false, sway: random(0, TAU), age: 0 });
      }
    }

    update(dt) {
      if (this.state !== 'playing') { this.updateAmbient(dt * .35); return; }
      dt = Math.min(dt, .034);
      this.elapsed += dt; this.runTime += dt; this.speed = 330 + Math.min(250, this.runTime * 5.2);
      this.distance += this.speed * dt * .0165; this.score += dt * (42 + this.speed * .075);
      this.worldScroll = (this.worldScroll + this.speed * dt) % 10000;
      this.catPressure = clamp(this.catPressure + dt * (.0032 + this.runTime * .000035), 0.1, .97);
      this.spawnClock -= dt;
      if (this.spawnClock <= 0) { this.spawnObstacle(); this.spawnClock = Math.max(.54, 1.12 - this.runTime * .009) + random(-.15, .16); }
      this.rat.visualLane += (this.rat.lane - this.rat.visualLane) * Math.min(1, dt * 14);
      this.rat.run += dt * (9 + this.speed * .008); this.rat.tilt *= Math.pow(.02, dt);
      this.rat.jump = this.rat.jump > 0 ? this.rat.jump + dt * 2.05 : 0;
      if (this.rat.jump >= 2) this.rat.jump = 0;
      this.rat.slide = Math.max(0, this.rat.slide - dt); this.rat.invulnerable = Math.max(0, this.rat.invulnerable - dt);
      this.cat.run += dt * (8 + this.speed * .007); this.cat.lunge = Math.max(0, this.cat.lunge - dt);
      this.updateObstacles(dt); this.updateParticles(dt); this.updateFloating(dt); this.updateAmbient(dt);
      this.screenShake = Math.max(0, this.screenShake - dt * 2.4); this.flash = Math.max(0, this.flash - dt * 2.8);
      this.tipTimer += dt; if (this.tipTimer > 5) ui.tip.classList.add('hidden');
      this.updateUI();
    }

    updateObstacles(dt) {
      const ratZ = .91;
      for (const obstacle of this.obstacles) {
        obstacle.z += dt * (this.speed / 580) * (.72 + obstacle.z * .42); obstacle.age += dt;
        if (!obstacle.checked && obstacle.z > .86) {
          obstacle.checked = true;
          const sameLane = Math.abs(obstacle.lane - this.rat.lane) < .2;
          const jumping = this.rat.jump > .24 && this.rat.jump < 1.73;
          const sliding = this.rat.slide > .04;
          const cleared = obstacle.type === 'puddle' ? !sameLane || jumping : obstacle.type === 'pipe' ? !sameLane || sliding : !sameLane || jumping;
          if (sameLane && !cleared && this.rat.invulnerable <= 0) { this.gameOver('collision'); return; }
          if (cleared || !sameLane) { this.score += 22; this.floatingText.push({ text: sameLane ? 'CLEAN' : 'NEAR MISS', x: laneX(this.rat.visualLane, 1), y: 470, life: 1, color: sameLane ? '#c9ee84' : '#73d6bd' }); this.emitBurst(laneX(obstacle.lane, obstacle.z), 555, 6, '#b8d6bf'); }
        }
      }
      this.obstacles = this.obstacles.filter((obstacle) => obstacle.z < 1.14);
      if (this.catPressure > .94 && Math.random() < dt * .7) { this.cat.lunge = .44; if (this.rat.lane === 0 && this.rat.jump === 0) this.catPressure += .015; }
      if (this.catPressure >= .99) this.gameOver('cat');
    }

    updateParticles(dt) {
      for (const p of this.particles) { p.y += p.speed * dt * (1 + this.speed / 500); p.x += Math.sin(this.elapsed + p.phase) * dt * 5; if (p.y > H + 15) { p.y = -10; p.x = random(0, W); } }
      for (const p of this.floatingText) { p.life -= dt; p.y -= dt * 29; }
      this.floatingText = this.floatingText.filter((p) => p.life > 0);
    }

    updateFloating() { if (this.flash > 0) ui.flash.style.opacity = String(this.flash * .4); else ui.flash.style.opacity = '0'; }
    updateAmbient() { this.worldScroll = (this.worldScroll + .45) % 10000; }
    updateUI() {
      ui.score.textContent = this.format(Math.floor(this.score)); ui.distance.textContent = Math.floor(this.distance); ui.catMeter.style.width = `${Math.round(this.catPressure * 100)}%`;
      ui.catStatus.textContent = this.catPressure > .79 ? 'CLOSE' : this.catPressure > .55 ? 'TRACKING' : 'CLEAR';
      ui.catStatus.style.color = this.catPressure > .79 ? '#ee8d6f' : '';
    }
    format(value) { return String(Math.max(0, value)).padStart(6, '0'); }

    emitBurst(x, y, amount, color) { for (let i = 0; i < amount; i++) this.floatingText.push({ particle: true, x, y, vx: random(-60, 60), vy: random(-120, -30), life: random(.25, .55), color, size: random(1, 3) }); }

    resize() {
      const rect = canvas.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr)); canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      scale = rect.width / W; ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    }

    draw() {
      const shakeX = random(-1, 1) * this.screenShake * 8; const shakeY = random(-1, 1) * this.screenShake * 5;
      ctx.save(); ctx.translate(shakeX, shakeY); this.drawBackground(); this.drawTunnel(); this.drawObstacles(); this.drawCat(); this.drawRat(); this.drawAtmosphere(); ctx.restore();
      for (const item of this.floatingText) { if (item.particle) this.drawParticle(item); else this.drawFloat(item); }
    }

    drawBackground() {
      const sky = ctx.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#0c2829'); sky.addColorStop(.38, '#07191c'); sky.addColorStop(1, '#02080a'); ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
      const moon = ctx.createRadialGradient(W * .5, 118, 4, W * .5, 118, 115); moon.addColorStop(0, 'rgba(207,242,183,.28)'); moon.addColorStop(.26, 'rgba(122,199,168,.1)'); moon.addColorStop(1, 'transparent'); ctx.fillStyle = moon; ctx.fillRect(0, 0, W, 330);
      ctx.fillStyle = 'rgba(112,177,150,.08)'; ctx.beginPath(); ctx.arc(W * .5, 112, 22, 0, TAU); ctx.fill();
      ctx.fillStyle = '#102d2d';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 365); ctx.lineTo(225, 305); ctx.lineTo(420, 255); ctx.lineTo(520, 235); ctx.lineTo(520, 0); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(W, 0); ctx.lineTo(W, 365); ctx.lineTo(W - 225, 305); ctx.lineTo(W - 420, 255); ctx.lineTo(W - 520, 235); ctx.lineTo(W - 520, 0); ctx.closePath(); ctx.fill();
      this.drawBricks();
    }

    drawBricks() {
      ctx.save(); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(118,171,148,.11)';
      for (let side = -1; side <= 1; side += 2) {
        for (let row = 0; row < 6; row++) {
          const y = 30 + row * 47; const farX = W / 2 + side * (470 - row * 27); const nearX = W / 2 + side * (645 - row * 34);
          for (let col = 0; col < 4; col++) { const x = lerp(farX, nearX, col / 4); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + side * 58, y + 29); ctx.stroke(); }
        }
      }
      ctx.restore();
    }

    drawTunnel() {
      const vanX = W / 2; const horizon = 252;
      ctx.fillStyle = '#071113'; ctx.beginPath(); ctx.moveTo(0, 720); ctx.lineTo(0, 392); ctx.lineTo(vanX - 110, horizon); ctx.lineTo(vanX + 110, horizon); ctx.lineTo(W, 392); ctx.lineTo(W, 720); ctx.closePath(); ctx.fill();
      // Side ledges and water channels.
      const leftWall = ctx.createLinearGradient(0, 300, 0, 720); leftWall.addColorStop(0, '#102a2a'); leftWall.addColorStop(1, '#061113'); ctx.fillStyle = leftWall; ctx.beginPath(); ctx.moveTo(0, 370); ctx.lineTo(vanX - 110, horizon); ctx.lineTo(vanX - 81, horizon); ctx.lineTo(285, 720); ctx.lineTo(0, 720); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#102222'; ctx.beginPath(); ctx.moveTo(W, 370); ctx.lineTo(vanX + 110, horizon); ctx.lineTo(vanX + 81, horizon); ctx.lineTo(W - 285, 720); ctx.lineTo(W, 720); ctx.closePath(); ctx.fill();
      // Perspective lane boundaries.
      ctx.save(); ctx.lineCap = 'round';
      for (let i = -2; i <= 2; i++) { const bottomX = vanX + i * 180; ctx.strokeStyle = i === -2 || i === 2 ? 'rgba(103,164,140,.3)' : 'rgba(92,151,132,.2)'; ctx.lineWidth = i === -2 || i === 2 ? 5 : 2; ctx.beginPath(); ctx.moveTo(vanX + i * 40, horizon); ctx.lineTo(bottomX, H); ctx.stroke(); }
      ctx.restore();
      // Wet center lane with animated highlights.
      const road = ctx.createLinearGradient(0, horizon, 0, H); road.addColorStop(0, 'rgba(75,143,121,.03)'); road.addColorStop(1, 'rgba(103,180,147,.13)'); ctx.fillStyle = road; ctx.beginPath(); ctx.moveTo(vanX - 95, horizon); ctx.lineTo(vanX + 95, horizon); ctx.lineTo(vanX + 225, H); ctx.lineTo(vanX - 225, H); ctx.closePath(); ctx.fill();
      for (let i = 0; i < 11; i++) { const z = ((i / 11 + (this.worldScroll * .0007)) % 1); const y = horizon + Math.pow(z, 1.8) * (H - horizon); const width = 5 + z * 60; ctx.fillStyle = `rgba(133,212,177,${.03 + z * .045})`; ctx.fillRect(vanX - width / 2, y, width, 1 + z * 2); }
      // Catwalk edge stripes.
      for (let i = 0; i < 13; i++) { const z = ((i / 13 + this.worldScroll * .00045) % 1); const y = horizon + Math.pow(z, 1.7) * (H - horizon); const x = 90 + z * 110; ctx.fillStyle = `rgba(193,224,164,${.06 + z * .12})`; ctx.fillRect(x, y, 38 + z * 50, 2 + z * 5); ctx.fillRect(W - x - 38 - z * 50, y, 38 + z * 50, 2 + z * 5); }
      this.drawPipes(); this.drawLights();
    }

    drawPipes() {
      ctx.save(); ctx.lineCap = 'round';
      for (let side = -1; side <= 1; side += 2) {
        ctx.strokeStyle = 'rgba(31,76,69,.75)'; ctx.lineWidth = 19; ctx.beginPath(); ctx.moveTo(W / 2 + side * 445, 0); ctx.bezierCurveTo(W / 2 + side * 430, 70, W / 2 + side * 400, 154, W / 2 + side * 265, 267); ctx.stroke();
        ctx.strokeStyle = 'rgba(101,151,116,.18)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(W / 2 + side * 439, 0); ctx.bezierCurveTo(W / 2 + side * 424, 70, W / 2 + side * 394, 154, W / 2 + side * 259, 267); ctx.stroke();
        ctx.strokeStyle = 'rgba(23,62,58,.85)'; ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(W / 2 + side * 575, 0); ctx.bezierCurveTo(W / 2 + side * 560, 120, W / 2 + side * 455, 210, W / 2 + side * 330, 300); ctx.stroke();
      }
      ctx.restore();
    }

    drawLights() {
      for (const light of this.lights) {
        const z = (light.z + this.worldScroll * .00022) % 1; const y = 62 + z * 260; const x = W / 2 + light.side * (410 - z * 285); const size = 6 + z * 17; const flicker = .72 + Math.sin(this.elapsed * 9 + light.flicker) * .12;
        const glow = ctx.createRadialGradient(x, y, 0, x, y, size * 5); glow.addColorStop(0, `rgba(201,238,132,${.25 * flicker})`); glow.addColorStop(1, 'transparent'); ctx.fillStyle = glow; ctx.fillRect(x - size * 5, y - size * 5, size * 10, size * 10); ctx.fillStyle = `rgba(201,238,132,${.45 * flicker})`; ctx.fillRect(x - size * .4, y - size * .18, size * .8, size * .35);
      }
    }

    drawObstacles() {
      const sorted = [...this.obstacles].sort((a, b) => a.z - b.z);
      for (const item of sorted) { const z = clamp(item.z, .04, 1.08); const x = laneX(item.lane, z); const y = 252 + Math.pow(z, 1.75) * 468; const s = .3 + z * 1.12; ctx.save(); ctx.translate(x, y); ctx.scale(s, s); this.drawObstacleShape(item.type, item.sway); ctx.restore(); }
    }

    drawObstacleShape(type, sway) {
      ctx.save(); ctx.translate(Math.sin(this.elapsed * 2 + sway) * 1.2, 0);
      ctx.fillStyle = 'rgba(0,0,0,.48)'; ctx.beginPath(); ctx.ellipse(0, 9, type === 'pipe' ? 48 : 37, 9, 0, 0, TAU); ctx.fill();
      if (type === 'crate') {
        const g = ctx.createLinearGradient(-35, -50, 35, 12); g.addColorStop(0, '#9e5f32'); g.addColorStop(.46, '#63391f'); g.addColorStop(1, '#291a15'); ctx.fillStyle = g; ctx.fillRect(-35, -50, 70, 58); ctx.strokeStyle = 'rgba(213,153,84,.44)'; ctx.lineWidth = 3; ctx.strokeRect(-35, -50, 70, 58); ctx.beginPath(); ctx.moveTo(-31, -46); ctx.lineTo(31, 2); ctx.moveTo(31, -46); ctx.lineTo(-31, 2); ctx.stroke();
      } else if (type === 'puddle') {
        const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 62); g.addColorStop(0, 'rgba(160,225,191,.28)'); g.addColorStop(1, 'rgba(52,123,117,.04)'); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 4, 67, 17, 0, 0, TAU); ctx.fill(); ctx.strokeStyle = 'rgba(119,207,187,.34)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(0, 4, 48, 8, 0, 0, TAU); ctx.stroke();
      } else if (type === 'barrier') {
        ctx.fillStyle = '#c56e48'; ctx.fillRect(-42, -22, 84, 17); ctx.fillStyle = '#e6b274'; for (let i = -34; i < 35; i += 18) { ctx.save(); ctx.translate(i, -13); ctx.rotate(-.7); ctx.fillRect(-4, -9, 8, 19); ctx.restore(); } ctx.fillStyle = '#3a2520'; ctx.fillRect(-34, -5, 9, 18); ctx.fillRect(25, -5, 9, 18);
      } else {
        ctx.strokeStyle = '#7d5340'; ctx.lineWidth = 15; ctx.beginPath(); ctx.moveTo(-50, -4); ctx.bezierCurveTo(-25, -50, 22, -50, 44, -3); ctx.stroke(); ctx.strokeStyle = '#c08358'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-50, -10); ctx.bezierCurveTo(-25, -56, 22, -56, 44, -9); ctx.stroke(); ctx.fillStyle = '#e4bd7f'; ctx.fillRect(-57, -16, 14, 24); ctx.fillRect(37, -15, 14, 24);
      }
      ctx.restore();
    }

    drawCat() {
      const p = clamp(this.catPressure, 0, 1); const x = W / 2 + Math.sin(this.elapsed * 1.8) * 17; const y = 570 + p * 56; const s = .95 + p * .35; ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.globalAlpha = .15 + p * .32; ctx.filter = `blur(${Math.max(0, 3 - p * 3)}px)`; this.drawCatShape(); ctx.filter = 'none'; ctx.restore();
      if (p > .72) { ctx.save(); ctx.globalAlpha = (p - .72) * 1.6; ctx.fillStyle = '#ee8d6f'; ctx.beginPath(); ctx.arc(x - 15, y - 47, 3.5, 0, TAU); ctx.arc(x + 15, y - 47, 3.5, 0, TAU); ctx.fill(); ctx.restore(); }
    }

    drawCatShape() {
      ctx.fillStyle = '#020708'; ctx.beginPath(); ctx.ellipse(0, 21, 66, 45, 0, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.ellipse(0, -29, 40, 38, 0, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.moveTo(-35, -53); ctx.lineTo(-32, -93); ctx.lineTo(-8, -64); ctx.lineTo(8, -64); ctx.lineTo(32, -93); ctx.lineTo(36, -53); ctx.closePath(); ctx.fill(); ctx.strokeStyle = 'rgba(121,180,146,.22)'; ctx.lineWidth = 2; ctx.stroke(); ctx.strokeStyle = '#020708'; ctx.lineWidth = 16; ctx.beginPath(); ctx.moveTo(47, 19); ctx.bezierCurveTo(105, -5, 99, -72, 65, -80); ctx.stroke();
      ctx.fillStyle = '#ddf3ad'; ctx.beginPath(); ctx.arc(-14, -33, 4, 0, TAU); ctx.arc(14, -33, 4, 0, TAU); ctx.fill();
    }

    drawRat() {
      const lane = this.rat.visualLane; const x = laneX(lane, 1); const jumpHeight = this.rat.jump > 0 ? Math.sin((this.rat.jump / 2) * Math.PI) * 126 : 0; const y = 618 - jumpHeight; const squash = this.rat.slide > 0 ? .58 : 1; const bob = Math.sin(this.rat.run) * 3; ctx.save(); ctx.translate(x, y + bob); ctx.rotate(this.rat.tilt); ctx.scale(1, squash); if (this.rat.invulnerable > 0 && Math.floor(this.elapsed * 15) % 2 === 0) ctx.globalAlpha = .4; this.drawRatShadow(jumpHeight); this.drawRatShape(); ctx.restore();
    }

    drawRatShadow(jumpHeight) { ctx.save(); ctx.scale(1, .22); ctx.translate(0, 38 + jumpHeight * .5); const alpha = Math.max(.08, .35 - jumpHeight / 500); ctx.fillStyle = `rgba(0,0,0,${alpha})`; ctx.beginPath(); ctx.ellipse(0, 0, 48 - jumpHeight * .1, 18, 0, 0, TAU); ctx.fill(); ctx.restore(); }

    drawRatShape() {
      // Tail first for depth.
      ctx.strokeStyle = '#b26f53'; ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-31, 18); ctx.bezierCurveTo(-73, 42, -82, -8, -54, -36); ctx.bezierCurveTo(-39, -50, -59, -60, -67, -48); ctx.stroke(); ctx.strokeStyle = '#e39b73'; ctx.lineWidth = 2; ctx.stroke();
      const body = ctx.createLinearGradient(-35, -38, 33, 35); body.addColorStop(0, '#c78965'); body.addColorStop(.5, '#875344'); body.addColorStop(1, '#482d2b'); ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(0, 12, 39, 27, -.1, 0, TAU); ctx.fill();
      ctx.fillStyle = '#9d614c'; ctx.beginPath(); ctx.ellipse(31, -14, 27, 22, -.12, 0, TAU); ctx.fill();
      ctx.fillStyle = '#d58d73'; ctx.beginPath(); ctx.arc(48, -25, 10, 0, TAU); ctx.arc(24, -34, 10, 0, TAU); ctx.fill(); ctx.fillStyle = '#8f4b47'; ctx.beginPath(); ctx.arc(49, -25, 6, 0, TAU); ctx.arc(24, -34, 6, 0, TAU); ctx.fill();
      ctx.fillStyle = '#f0f4cb'; ctx.beginPath(); ctx.arc(42, -17, 4, 0, TAU); ctx.fill(); ctx.fillStyle = '#142018'; ctx.beginPath(); ctx.arc(43, -17, 2, 0, TAU); ctx.fill();
      ctx.fillStyle = '#d28676'; ctx.beginPath(); ctx.arc(57, -9, 5, 0, TAU); ctx.fill(); ctx.strokeStyle = 'rgba(231,188,145,.58)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(56, -8); ctx.lineTo(82, -13); ctx.moveTo(56, -6); ctx.lineTo(83, -2); ctx.stroke();
      ctx.strokeStyle = '#3b2927'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(-18, 28); ctx.lineTo(-25, 48); ctx.moveTo(12, 32); ctx.lineTo(22, 50); ctx.stroke(); ctx.strokeStyle = '#dfaa7e'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-30, 49); ctx.lineTo(-18, 49); ctx.moveTo(18, 50); ctx.lineTo(30, 50); ctx.stroke();
      ctx.strokeStyle = 'rgba(244,198,153,.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-9, -5); ctx.lineTo(10, 4); ctx.stroke();
    }

    drawAtmosphere() {
      ctx.save();
      for (const streak of this.streaks) { const y = (streak.y + this.worldScroll * streak.speed * .08) % (H + 30); ctx.strokeStyle = `rgba(185,231,202,${streak.alpha})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(streak.x, y); ctx.lineTo(streak.x - 1, y + streak.len); ctx.stroke(); }
      for (const p of this.particles) { ctx.fillStyle = `rgba(179,225,191,${p.alpha})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill(); }
      const mist = ctx.createLinearGradient(0, 430, 0, 690); mist.addColorStop(0, 'transparent'); mist.addColorStop(1, 'rgba(118,185,155,.06)'); ctx.fillStyle = mist; ctx.fillRect(0, 400, W, 320); ctx.restore();
    }

    drawParticle(item) { ctx.save(); ctx.globalAlpha = clamp(item.life * 2, 0, 1); ctx.fillStyle = item.color; ctx.beginPath(); ctx.arc(item.x, item.y, item.size || 2, 0, TAU); ctx.fill(); ctx.restore(); }
    drawFloat(item) { ctx.save(); ctx.globalAlpha = clamp(item.life * 1.7, 0, 1); ctx.fillStyle = item.color; ctx.font = '600 14px DM Mono, monospace'; ctx.textAlign = 'center'; ctx.fillText(item.text, item.x, item.y); ctx.restore(); }
  }

  audio = new AudioBed();
  const game = new Game();
  function frame(time) { const dt = last ? (time - last) / 1000 : 0; last = time; game.update(dt); game.draw(); raf = requestAnimationFrame(frame); }
  raf = requestAnimationFrame(frame);
  window.addEventListener('beforeunload', () => cancelAnimationFrame(raf));
})();
