// ================= Aqua Run =================
const $ = (s) => document.querySelector(s);

// ---- Constants (tweak these to balance the game) ----
const W = 960, H = 540;
const ROUND_DURATION = 120;   // seconds
const TARGET_WATER = 10;
const MAX_LIVES = 3;
const PLAYER_SPEED = 220;     // px/sec
const ANIMAL_SPEED = 110;     // must stay below PLAYER_SPEED
const FILL_TIME = 1;          // seconds frozen while filling
const STUN_TIME = 1;
const INVULN_TIME = 2;
const FIRST_SPAWN = 15;
const SPAWN_MIN = 10, SPAWN_MAX = 20;
const ANIMAL_LIFETIME = 10;

// ---- World layout (game coordinates) ----
const riverZone = { x: 20,  y: 20,  w: 260, h: 300 };
const huts      = { x: 740, y: 60,  w: 190, h: 170 };
const well      = { x: 780, y: 340, w: 110, h: 120 };
const wellZone  = { x: well.x - 30, y: well.y - 30, w: well.w + 60, h: well.h + 60 };
const solids = [huts, well];
const START_POS = { x: 200, y: 300 };

// ---- Elements ----
const stage = $('#stage');
const el = {
  river: $('#river'), huts: $('#huts'), well: $('#well'), sun: $('#sun'),
  player: $('#player'), bucket: $('#bucket'), animals: $('#animals'),
  popups: $('#popups'), night: $('#night'), flash: $('#flash'),
  hud: $('#hud'), water: $('#water'), target: $('#target'), lives: $('#lives'),
  objective: $('#modal-objective'), howto: $('#panel-howto'),
  settings: $('#panel-settings'), win: $('#screen-win'), lose: $('#screen-lose'),
  soundBtn: $('#btn-sound')
};

// ---- Optional art: drop PNGs in /img and they replace the fallback boxes ----
const art = [
  [el.river, 'img/river.png'], [el.huts, 'img/huts.png'], [el.well, 'img/well.png'],
  [el.sun, 'img/sun.png'], [el.player, 'img/player.png'],
  [$('#scene'), 'img/ground.png', true]
];
art.forEach(([node, url, isBg]) => {
  const img = new Image();
  img.onload = () => {
    node.style.backgroundImage = `url(${url})`;
    if (!isBg) node.classList.add('art');
  };
  img.src = url;
});
function loadBucketArt(cls, url) {
  const img = new Image();
  img.onload = () => { bucketArt[cls] = url; el.bucket.classList.add('art'); renderBucket(); };
  img.src = url;
}
const bucketArt = {};
loadBucketArt('empty', 'img/bucket-empty.png');
loadBucketArt('full', 'img/bucket-full.png');
const animalArt = { url: null };
{ const img = new Image(); img.onload = () => (animalArt.url = 'img/animal.png'); img.src = 'img/animal.png'; }

// ---- Sound (files are optional; missing files are ignored) ----
let muted = false;
const sounds = {};
['fill', 'deposit', 'hit', 'spill', 'win', 'lose'].forEach((n) => {
  sounds[n] = new Audio(`sounds/${n}.mp3`);
});
const ambience = new Audio('sounds/ambience.mp3');
ambience.loop = true;
function play(name) {
  if (muted || !sounds[name]) return;
  sounds[name].currentTime = 0;
  sounds[name].play().catch(() => {});
}

// ---- State ----
let state = 'START';          // START | PLAYING | PAUSED | WIN | LOSE
let player, bucketFull, water, lives, elapsed;
let fillTimer, filling, stunTimer, invulnTimer, spawnTimer, animals;
const keys = { left: false, right: false, up: false, down: false };

function resetGame() {
  player = { x: START_POS.x, y: START_POS.y, w: 40, h: 56 };
  bucketFull = false;
  water = 0;
  lives = MAX_LIVES;
  elapsed = 0;
  fillTimer = 0;
  filling = false;
  stunTimer = 0;
  invulnTimer = 0;
  spawnTimer = FIRST_SPAWN;
  animals.forEach((a) => a.el.remove());
  animals = [];
  Object.keys(keys).forEach((k) => (keys[k] = false));
  el.player.classList.remove('invuln');
  hideAll();
  el.hud.classList.add('hidden');
  el.objective.classList.remove('hidden');
  state = 'START';
  render();
}

function hideAll() {
  [el.objective, el.howto, el.settings, el.win, el.lose].forEach((o) => o.classList.add('hidden'));
}

// ---- Helpers ----
const rand = (a, b) => a + Math.random() * (b - a);
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function setRect(node, r) {
  node.style.left = r.x + 'px';
  node.style.top = r.y + 'px';
  node.style.width = r.w + 'px';
  node.style.height = r.h + 'px';
}

// ---- Movement with solid collision (X then Y avoids sticking) ----
function movePlayer(dt) {
  let dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  let dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
  if (dx === 0 && dy === 0) return;
  const len = Math.hypot(dx, dy); // normalize so diagonals aren't faster
  dx /= len; dy /= len;

  const oldX = player.x;
  player.x = clamp(player.x + dx * PLAYER_SPEED * dt, 0, W - player.w);
  if (solids.some((s) => overlap(player, s))) player.x = oldX;

  const oldY = player.y;
  player.y = clamp(player.y + dy * PLAYER_SPEED * dt, 0, H - player.h);
  if (solids.some((s) => overlap(player, s))) player.y = oldY;
}

// ---- Animals ----
function spawnAnimal() {
  const side = Math.floor(Math.random() * 4);
  let x, y;
  if (side === 0) { x = rand(0, W); y = -40; }
  else if (side === 1) { x = W; y = rand(0, H); }
  else if (side === 2) { x = rand(0, W); y = H; }
  else { x = -50; y = rand(0, H); }
  const node = document.createElement('div');
  node.className = 'animal';
  if (animalArt.url) {
    node.style.backgroundImage = `url(${animalArt.url})`;
    node.classList.add('art');
  }
  el.animals.appendChild(node);
  animals.push({ x, y, w: 50, h: 40, life: ANIMAL_LIFETIME, el: node });
}

function updateAnimals(dt) {
  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnAnimal();
    spawnTimer = rand(SPAWN_MIN, SPAWN_MAX);
  }

  const px = player.x + player.w / 2;
  const py = player.y + player.h / 2;

  animals = animals.filter((a) => {
    a.life -= dt;
    const ax = a.x + a.w / 2, ay = a.y + a.h / 2;
    const dist = Math.hypot(px - ax, py - ay) || 1;
    a.x += ((px - ax) / dist) * ANIMAL_SPEED * dt;
    a.y += ((py - ay) / dist) * ANIMAL_SPEED * dt;

    let remove = a.life <= 0;

    if (!remove && invulnTimer <= 0 && overlap(a, player)) {
      hitPlayer();
      remove = true; // the animal runs off after a hit
    }
    if (remove) a.el.remove();
    return !remove;
  });
}

function hitPlayer() {
  if (bucketFull) {
    bucketFull = false;
    play('spill');
  }
  lives -= 1;
  stunTimer = STUN_TIME;
  invulnTimer = INVULN_TIME;
  filling = false;
  fillTimer = 0;
  play('hit');
  el.flash.classList.remove('on');
  void el.flash.offsetWidth; // restart animation
  el.flash.classList.add('on');
}

// ---- Zones ----
function checkZones() {
  if (!bucketFull && !filling && overlap(player, riverZone)) {
    filling = true;
    fillTimer = FILL_TIME;
    play('fill');
  }
  if (bucketFull && overlap(player, wellZone)) {
    bucketFull = false;
    water += 1;
    play('deposit');
    showPlusOne();
  }
}

function showPlusOne() {
  const p = document.createElement('div');
  p.className = 'popup';
  p.textContent = '+1';
  p.style.left = well.x + well.w / 2 - 12 + 'px';
  p.style.top = well.y - 20 + 'px';
  el.popups.appendChild(p);
  setTimeout(() => p.remove(), 800);
}

// ---- Main update (all timers run on dt, so pausing freezes everything) ----
function update(dt) {
  if (state !== 'PLAYING') return;

  elapsed += dt;
  if (fillTimer > 0) {
    fillTimer -= dt;
    if (fillTimer <= 0) { filling = false; bucketFull = true; }
  }
  if (stunTimer > 0) stunTimer -= dt;
  if (invulnTimer > 0) invulnTimer -= dt;

  const frozen = filling || stunTimer > 0;
  if (!frozen) movePlayer(dt);
  checkZones();
  updateAnimals(dt);

  // Win/lose checks (win first, so a last-second deposit counts)
  if (water >= TARGET_WATER) return endGame(true);
  if (lives <= 0) return endGame(false, 'Caught by animals');
  if (elapsed >= ROUND_DURATION) return endGame(false, 'Sunset');
}

function endGame(won, reason) {
  const timeLeft = Math.max(0, Math.ceil(ROUND_DURATION - elapsed));
  state = won ? 'WIN' : 'LOSE';
  Object.keys(keys).forEach((k) => (keys[k] = false));
  ambience.pause();
  render();
  if (won) {
    $('#win-water').textContent = `${water} / ${TARGET_WATER}`;
    $('#win-time').textContent = timeLeft;
    el.win.classList.remove('hidden');
    play('win');
  } else {
    $('#lose-reason').textContent = reason;
    el.lose.classList.remove('hidden');
    play('lose');
  }
}

// ---- Rendering ----
function renderBucket() {
  const cls = bucketFull ? 'full' : 'empty';
  el.bucket.classList.toggle('full', bucketFull);
  el.bucket.style.backgroundImage = bucketArt[cls] ? `url(${bucketArt[cls]})` : '';
}

function render() {
  setRect(el.river, riverZone);
  setRect(el.huts, huts);
  setRect(el.well, well);

  el.player.style.left = player.x + 'px';
  el.player.style.top = player.y + 'px';
  el.player.style.width = player.w + 'px';
  el.player.style.height = player.h + 'px';
  el.player.classList.toggle('invuln', invulnTimer > 0);
  renderBucket();

  animals.forEach((a) => {
    a.el.style.left = a.x + 'px';
    a.el.style.top = a.y + 'px';
  });

  // Sun: quarter arc from top-center down to the right horizon
  const p = clamp(elapsed / ROUND_DURATION, 0, 1);
  const ang = p * (Math.PI / 2);
  const sunX = W / 2 + 380 * Math.sin(ang) - 55;
  const sunY = 20 + 200 * (1 - Math.cos(ang));
  el.sun.style.left = sunX + 'px';
  el.sun.style.top = sunY + 'px';
  el.night.style.opacity = (p * 0.7).toFixed(3);

  el.water.textContent = water;
  el.target.textContent = TARGET_WATER;
  el.lives.textContent = '\u2665'.repeat(Math.max(0, lives));
}

// ---- Loop ----
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); // clamp so tab-switching doesn't jump
  last = now;
  update(dt);
  render();
  requestAnimationFrame(frame);
}

// ---- State changes from UI ----
function startPlaying() {
  hideAll();
  el.hud.classList.remove('hidden');
  state = 'PLAYING';
  if (!muted) ambience.play().catch(() => {});
}

function openPanel(panel) {
  if (state === 'PLAYING') state = 'PAUSED';
  Object.keys(keys).forEach((k) => (keys[k] = false));
  panel.classList.remove('hidden');
}

function closePanel(panel) {
  panel.classList.add('hidden');
  if (state === 'PAUSED') state = 'PLAYING';
}

$('[data-close="objective"]').addEventListener('click', startPlaying);
$('[data-close="howto"]').addEventListener('click', () => closePanel(el.howto));
$('[data-close="settings"]').addEventListener('click', () => closePanel(el.settings));
$('#btn-howto').addEventListener('click', () => openPanel(el.howto));
$('#btn-settings').addEventListener('click', () => openPanel(el.settings));

el.soundBtn.addEventListener('click', () => {
  muted = !muted;
  el.soundBtn.innerHTML = muted ? '&#128263;' : '&#128266;';
  if (muted) ambience.pause();
  else if (state === 'PLAYING') ambience.play().catch(() => {});
});

['#btn-restart', '#btn-replay', '#btn-retry'].forEach((id) =>
  $(id).addEventListener('click', () => { ambience.pause(); resetGame(); })
);

// ---- Input ----
const keyMap = {
  ArrowLeft: 'left', a: 'left', A: 'left',
  ArrowRight: 'right', d: 'right', D: 'right',
  ArrowUp: 'up', w: 'up', W: 'up',
  ArrowDown: 'down', s: 'down', S: 'down'
};
window.addEventListener('keydown', (e) => {
  const k = keyMap[e.key];
  if (!k) return;
  if (state === 'PLAYING') e.preventDefault(); // stop arrow keys scrolling the page
  keys[k] = true;
});
window.addEventListener('keyup', (e) => {
  const k = keyMap[e.key];
  if (k) keys[k] = false;
});
window.addEventListener('blur', () => Object.keys(keys).forEach((k) => (keys[k] = false)));

// ---- Scale the stage to fit the window ----
function fitStage() {
  const s = Math.min(window.innerWidth / W, window.innerHeight / H);
  stage.style.setProperty('--s', s);
}
window.addEventListener('resize', fitStage);

// ---- Go ----
animals = [];
fitStage();
resetGame();
requestAnimationFrame(frame);
