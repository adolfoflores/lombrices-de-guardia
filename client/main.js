import { playFinale } from './ui/finale.js';
import { createInputChannel } from './session/input-channel.js';
import { showSettings } from './ui/settings.js';
import { createSession } from './session/session.js';
import { read, save, readPreferences } from './session/storage.js';
import { escape } from './ui/text.js';
import { finaleCopy } from './ui/results.js';
import { createGameDialogs } from './ui/game-dialogs.js';
import './style.css';
import './arsenal.css';
import './combat-hud.css';
import './lobby.css';
import './home.css';
import { WEAPONS, CONFIG } from '../shared/config.js';
import { aimFacing, aimForFacing, normalizeAngle } from '../shared/aim.js';
import { Renderer, prepareRenderer } from './renderer.js';
import { AudioEngine } from './audio.js';
import { createMobileJoystick } from './mobile-controls.js';
import { controlMode, advanceAim } from './combat-controls.js';
import { createChargeIndicator } from './charge-control.js';
import { arsenalMarkup, mountArsenal } from './arsenal.js';
import { combatHudMarkup, gameMenuMarkup } from './combat-hud.js';
import { mountHome, mountLobby } from './ui/entry.js';
import { bindKeyboard } from './keyboard.js';
import { bindAimControl } from './aim-control.js';

const $ = (s) => document.querySelector(s);
const prefs = readPreferences(matchMedia('(prefers-reduced-motion: reduce)').matches);
const audio = new AudioEngine();
let room = null,
  state = null,
  renderer = null,
  me = null,
  screen = '',
  busy = false;
let angle = -Math.PI / 4,
  weapon = 'bazooka',
  power = 0.45,
  target = null,
  chargeAt = 0,
  chargePointer = null,
  lastTurn = null,
  lastEvent = 0,
  input = { move: 0, thrustX: 0, thrustY: 0, reel: 0 },
  keys = new Set();
let aimControl = null,
  facing = 1,
  joysticks = [],
  chargeIndicator = null,
  stick = { x: 0, y: 0 },
  resettingInputs = false;
let killingBlowAt = 0;
// Slingshot pull in progress on the field, and the smoothed command round trip that aligns prediction with snapshots.
let slingshot = null,
  latency = 0;
const holds = new Map();
let loadingGeneration = 0;
let arsenalPanel = null;
let replaying = false;
const inviteCode = new URL(location.href).searchParams.get('sala')?.toUpperCase() || '';
let homeMode = inviteCode ? 'join' : 'create';
let draftName = read('ldg-name', ''),
  draftCode = inviteCode;
const weaponInfo = () => WEAPONS.find((w) => w.id === weapon) || WEAPONS[0];
const active = () => state?.worms.find((w) => w.id === state.turn?.wormId);
const mine = () => state?.turn?.playerId === me && state.phase === 'playing';
const portrait = () => matchMedia('(orientation: portrait)').matches;
const canAct = () =>
  mine() &&
  state.turn.stage !== 'settling' &&
  active()?.hp > 0 &&
  !document.hidden &&
  !portrait() &&
  !$('dialog[open]') &&
  connection.isOpen;

function positionToast() {
  const deck = $('.control-deck');
  $('#toast').style.bottom = deck
    ? getComputedStyle(deck).position === 'absolute'
      ? getComputedStyle(deck).getPropertyValue('--combat-toast-bottom').trim() || '132px'
      : `${innerHeight - deck.getBoundingClientRect().top + 8}px`
    : '';
}
function notify(text) {
  positionToast();
  const n = $('#toast');
  n.textContent = text;
  n.hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => (n.hidden = true), 4400);
}
function status(text) {
  const n = $('#connection');
  n.textContent = text;
  n.hidden = !text;
}
function send(type, data = {}, quiet = false) {
  if (!connection.isOpen) {
    if (!quiet) notify('Sin conexión. Intentando recuperar la sala…');
    return null;
  }
  return connection.send(type, data, quiet);
}
function action(a, quiet = false) {
  if (!canAct()) return;
  if (a.type === 'input') return inputChannel.send(a);
  return send('action', { action: a }, quiet);
}
function setBusy(v) {
  busy = v;
  document.querySelectorAll('[data-connect]').forEach((b) => {
    b.disabled = v;
    b.querySelector('[data-connect-label]').textContent = v ? 'Conectando…' : b.dataset.label;
  });
  document.querySelectorAll('[data-home-mode]').forEach((b) => (b.disabled = v));
  if ($('#entry-form')) {
    $('#entry-form').setAttribute('aria-busy', String(v));
    $('#player-name').disabled = v;
    $('#room-code').disabled = v || homeMode !== 'join';
  }
}
const connection = createSession({
  url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/socket`,
  inviteCode,
  onReset: resetSession,
  onStatus: status,
  onMessage(m) {
    if (m.type === 'welcome') {
      me = m.playerId;
      setBusy(false);
      history.replaceState({}, '', `${location.pathname}?sala=${encodeURIComponent(m.code)}`);
    } else if (m.type === 'room') {
      room = m.room;
      setBusy(false);
      renderRoom();
    } else if (m.type === 'state') {
      const previous = state;
      state = m.state;
      if (!state.terrain && previous?.terrain && previous.mapId === state.mapId)
        state.terrain = previous.terrain;
      if (screen !== 'game') renderGame();
      renderer?.setState(m.state);
      if (lastTurn !== state.turn?.number) {
        lastTurn = state.turn?.number;
        cancelInputs(false);
        target = null;
        weapon = 'bazooka';
        facing = active()?.facing === -1 ? -1 : 1;
        angle = aimForFacing(active()?.aim ?? -Math.PI / 4, facing);
        renderer?.focus();
      }
      for (const e of state.events || []) {
        if (e.id > lastEvent) {
          audio.event(e);
          if (isKillingBlow(e)) killingBlowAt = performance.now();
          if (
            e.text &&
            e.type !== 'turn' &&
            e.type !== 'result' &&
            (e.type !== 'cratePickup' || e.playerId === me)
          )
            notify(e.type === 'cratePickup' ? `Caja recogida: ${e.text}` : e.text);
          lastEvent = Math.max(lastEvent, e.id);
        }
      }
      updateHud();
      if (state.phase === 'finished') finishMatch();
    } else if (m.type === 'error') {
      setBusy(false);
      notify(m.error || 'No se pudo entrar.');
    } else if (m.type === 'left') {
      resetSession();
    }
  },
  onAck(m, { quiet, type, rtt }) {
    if (!m.ok && !quiet) {
      setBusy(false);
      notify(m.error || 'No se pudo completar la acción.');
    }
    if (type === 'action') {
      latency = latency ? latency * 0.8 + rtt * 0.2 : rtt;
      renderer?.setLatency(latency);
    }
  },
  onDisconnect() {
    cancelInputs();
    setBusy(false);
  },
  onReplaced() {
    status('La sesión se abrió en otra ventana. Recarga para recuperarla.');
  },
  onError() {
    setBusy(false);
  },
});
const inputChannel = createInputChannel((input) => send('action', { action: input }, true));
const { showScore, showResult, openRules } = createGameDialogs({
  openDialog,
  getState: () => state,
  getRoom: () => room,
  getMe: () => me,
  isReplaying: () => replaying,
  send,
});

function resetSession() {
  cancelInputs();
  room = null;
  state = null;
  me = null;
  connection.reset();
  lastTurn = null;
  lastEvent = 0;
  history.replaceState({}, '', location.pathname);
  renderHome();
}
function teardown() {
  loadingGeneration++;
  arsenalPanel = null;
  clearFinale();
  replaying = false;
  cancelInputs();
  audio.setTension(0);
  killingBlowAt = 0;
  joysticks.forEach((control) => control.destroy());
  joysticks = [];
  chargeIndicator?.destroy();
  chargeIndicator = null;
  aimControl?.destroy();
  aimControl = null;
  renderer?.destroy();
  renderer = null;
  screen = '';
}
function bindSettings() {
  document.querySelectorAll('[data-settings]').forEach((b) => (b.onclick = openSettings));
}
function renderHome() {
  teardown();
  screen = 'home';
  mountHome({
    mode: homeMode,
    name: draftName,
    code: draftCode,
    busy,
    onName: (name) => {
      draftName = name;
    },
    onCode: (code) => {
      draftCode = code;
    },
    onMode: (mode) => {
      homeMode = mode;
      renderHome();
    },
    onSubmit({ name, code }) {
      if (busy || !name) return;
      audio.unlock();
      save('ldg-name', name);
      if (homeMode === 'join' && !code) {
        notify('Escribe el código de la sala.');
        return;
      }
      setBusy(true);
      const saved = connection.identity;
      connection.enter(homeMode === 'join' ? 'join' : 'create', {
        name,
        ...(homeMode === 'join' ? { code } : {}),
        ...(saved?.code === code ? { token: saved.token } : {}),
      });
    },
    onRules: openRules,
    onSettings: openSettings,
  });
}
function renderRoom() {
  if (!room) return;
  if (['playing', 'finished'].includes(room.phase)) {
    if (screen !== 'game') renderGame();
    if (room.phase === 'finished' && state?.result) showResult();
    return;
  }
  if (room.phase === 'loading') {
    if (screen !== 'loading') {
      document.querySelector('dialog')?.remove();
      audio.resetEvents?.();
      teardown();
      screen = 'loading';
      const generation = loadingGeneration;
      $('#app').innerHTML =
        `<main class="loading-screen"><img src="/crest.svg" width="100" alt=""><span class="eyebrow">PREPARANDO EL TERRENO</span><h1>Todos a sus puestos.</h1><p id="loading-progress"></p><p>La partida comienza cuando todo el grupo esté listo.</p></main>`;
      Promise.all([
        prepareRenderer(room.settings.mapId).catch(() => {}),
        document.fonts?.ready || Promise.resolve(),
        ...Array.from(document.images).map((img) => img.decode?.().catch(() => {}) || Promise.resolve()),
      ]).then(() => {
        if (room?.phase === 'loading' && generation === loadingGeneration) send('loaded');
      });
    }
    $('#loading-progress').textContent =
      `${room.players.filter((p) => p.loaded).length} de ${room.players.length} jugadores cargados`;
    return;
  }
  if (screen === 'game' || screen === 'loading') {
    document.querySelector('dialog')?.remove();
    teardown();
    state = null;
    lastTurn = null;
    lastEvent = 0;
  }
  screen = 'lobby';
  mountLobby({
    room,
    me,
    send,
    onUnlock: () => audio.unlock(),
    onCopy: copyText,
    onShare: shareRoom,
    onRules: openRules,
    onSettings: openSettings,
  });
}
async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    notify(message);
  } catch {
    openDialog(
      'Comparte con tu grupo',
      `<label>Copia este enlace o código<input readonly value="${escape(text)}" id="copy-fallback"></label>`,
    );
    $('#copy-fallback').select();
  }
}
async function shareRoom() {
  const url = `${location.origin}${location.pathname}?sala=${room.code}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Lombrices de guardia', text: `Únete a mi sala ${room.code}`, url });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  copyText(url, 'Enlace copiado');
}
function renderGame() {
  if (screen === 'game') return;
  teardown();
  screen = 'game';
  $('#app').innerHTML = combatHudMarkup(prefs);
  renderer = new Renderer($('#field'), {
    mapId: room?.settings.mapId || state?.mapId || 'hills',
    onFrame: updateControls,
    onTarget: (x, y) => {
      target = { x, y };
      notify('Destino seleccionado. Confirma con Usar.');
      updateView();
    },
    onReplayEvent: (e) => {
      if (!['turn', 'result', 'suddenDeath', 'forfeit'].includes(e.type)) audio.event({ ...e, id: null });
    },
    canAim: () =>
      canAct() &&
      state.turn.stage === 'action' &&
      !!weaponInfo().power &&
      !chargeAt &&
      chargePointer === null,
    onAimStart: startSlingshot,
    onAim: moveSlingshot,
    onAimEnd: endSlingshot,
  });
  renderer.setView({
    playerId: me,
    angle,
    facing,
    power,
    weapon,
    targeting: false,
    quality: prefs.quality,
    reducedMotion: prefs.reducedMotion,
    sensitivity: prefs.sensitivity,
  });
  renderer.setLatency(latency);
  renderer.setInput(input);
  $('#overview').onclick = () => renderer.overview();
  $('#focus').onclick = () => renderer.focus();
  $('#zoom-in').onclick = () => renderer.zoomBy(1.2);
  $('#zoom-out').onclick = () => renderer.zoomBy(1 / 1.2);
  $('#hud-menu').onclick = openGameMenu;
  $('#rotate-menu').onclick = openGameMenu;
  $('#arsenal').onclick = openArsenal;
  $('#jump').onclick = () => jump(false);
  $('#backjump').onclick = () => jump(true);
  $('#release').onclick = () => action({ type: 'release' });
  aimControl = bindAimControl($('#aim'), {
    canAct,
    getAngle: () => angle,
    onAim: setAim,
    refresh: updateView,
    onChange: updateFocus,
    sensitivity: () => prefs.sensitivity,
  });
  for (const b of document.querySelectorAll('[data-hold]')) {
    b.addEventListener('pointerdown', (e) => {
      if (!canAct()) return;
      e.preventDefault();
      audio.unlock();
      b.setPointerCapture(e.pointerId);
      holds.set(e.pointerId, b.dataset.hold);
      deriveInput();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
      b.addEventListener(type, (e) => {
        holds.delete(e.pointerId);
        deriveInput();
      });
  }
  $('#fire').addEventListener('pointerdown', (e) => {
    if (!canAct() || state.turn.stage !== 'action' || chargePointer !== null || slingshot) return;
    e.preventDefault();
    audio.unlock();
    e.currentTarget.setPointerCapture(e.pointerId);
    chargePointer = e.pointerId;
    chargeAt = performance.now();
    power = weaponInfo().power ? 0.08 : 0.5;
    updateView();
  });
  $('#fire').addEventListener('pointerup', (e) => {
    if (e.pointerId !== chargePointer) return;
    const was = !!chargeAt;
    chargePointer = null;
    chargeAt = 0;
    if (was) fire();
  });
  for (const event of ['pointercancel', 'lostpointercapture'])
    $('#fire').addEventListener(event, (e) => {
      if (e.pointerId === chargePointer) {
        chargeAt = 0;
        chargePointer = null;
        updateView();
      }
    });
  chargeIndicator = createChargeIndicator($('#fire'));
  joysticks = [
    ['#move-stick', 'x'],
    ['#aim-stick', 'y'],
  ].map(([selector, axis]) =>
    createMobileJoystick($(selector), {
      axis,
      canStart: canAct,
      onStart: () => {
        audio.unlock();
        updateFocus();
      },
      onChange: (value) => {
        stick[axis] = value[axis];
        if (!resettingInputs) deriveInput();
        updateFocus();
      },
    }),
  );
  bindSettings();
  updateHud();
}
function fire() {
  if (!canAct() || state.turn.stage !== 'action') return;
  const w = weaponInfo();
  if (w.target && !target) {
    notify('Primero toca un destino en el terreno.');
    return;
  }
  if (weapon === 'jetpack' && active()?.jetpack) {
    action({ type: 'release' });
    updateView();
    return;
  }
  deriveInput();
  inputChannel.flush();
  const shotPower = power,
    turn = state.turn.number;
  const request = action({ type: 'fire', weapon, angle, power, ...(target || {}) });
  if (request && w.power)
    connection.expect(request, (m) => {
      if (m.ok && screen === 'game' && state?.turn.number === turn && !chargeAt && !$('dialog[open]'))
        chargeIndicator?.release({ power: shotPower });
    });
  target = null;
  updateView();
}
function jump(back) {
  if (!canAct()) return;
  deriveInput();
  inputChannel.flush();
  if (action({ type: 'jump', back })) renderer?.predictJump(back, facing);
}
// Slingshot on the field: the renderer reports the pull; aim, power and the shot take their usual paths.
function startSlingshot() {
  audio.unlock();
  slingshot = { cancel: true };
  power = 0.08;
  updateView();
}
function moveSlingshot({ angle: value, power: pull, cancel }) {
  if (!slingshot) return;
  slingshot.cancel = cancel;
  power = pull;
  if (canAct()) setAim(value);
  else updateView();
}
function endSlingshot({ fire: shoot, angle: value, power: pull }) {
  if (!slingshot) return;
  slingshot = null;
  if (shoot && !chargeAt && canAct()) {
    power = pull;
    setAim(value);
    fire();
  }
  updateView();
}
function setAim(value) {
  if (!canAct()) return;
  value = normalizeAngle(value);
  facing = Math.sign(input.move) || aimFacing(value, facing);
  angle = aimForFacing(value, facing);
  updateView();
}
function updateControls(now, dt) {
  if (!canAct()) return;
  const aiming = controlMode(active(), weapon) === 'move';
  const direction = aiming ? Number(keys.has('ArrowDown')) - Number(keys.has('ArrowUp')) : 0;
  const vertical = aiming ? stick.y : 0;
  if (direction || vertical) angle = advanceAim(angle, facing, vertical, direction, dt, prefs.sensitivity);
  if (chargeAt && weaponInfo().power) power = Math.min(1, 0.08 + (now - chargeAt) / 1400);
  if (direction || vertical || chargeAt) updateView();
}
function deriveInput(sendNow = true) {
  const values = [...holds.values()];
  const left = values.includes('left') || keys.has('ArrowLeft') || keys.has('a');
  const right = values.includes('right') || keys.has('ArrowRight') || keys.has('d');
  const usingTool = controlMode(active(), weapon) !== 'move';
  const up = values.includes('up') || keys.has('w') || (usingTool && keys.has('ArrowUp'));
  const down = values.includes('down') || keys.has('s') || (usingTool && keys.has('ArrowDown'));
  const x = Math.max(-1, Math.min(1, stick.x + Number(right) - Number(left))),
    y = Math.max(-1, Math.min(1, (usingTool ? stick.y : 0) + Number(down) - Number(up)));
  const next = { move: x, thrustX: x, thrustY: y, reel: y },
    changed = Object.keys(next).some((key) => next[key] !== input[key]);
  input = next;
  renderer?.setInput(input);
  const side = Math.sign(input.move);
  if (canAct() && side && facing !== side) {
    facing = side;
    angle = aimForFacing(angle, facing);
    aimControl?.mirror(angle);
    updateView();
  }
  if (canAct() && (sendNow || changed)) action({ type: 'input', ...input, aim: angle, weapon }, true);
}
function cancelInputs(sendRelease = true) {
  inputChannel.reset();
  const had = Object.values(input).some(Boolean) || chargeAt;
  resettingInputs = true;
  joysticks.forEach((control) => control.reset());
  resettingInputs = false;
  stick = { x: 0, y: 0 };
  holds.clear();
  keys.clear();
  aimControl?.reset();
  slingshot = null;
  input = { move: 0, thrustX: 0, thrustY: 0, reel: 0 };
  chargeAt = 0;
  chargePointer = null;
  renderer?.cancelAim();
  renderer?.setInput(input);
  chargeIndicator?.cancel();
  if (sendRelease && had && connection.isOpen && me && state?.turn?.playerId === me)
    send('action', { action: { type: 'input', ...input, aim: angle } }, true);
  if (screen === 'game' && $('#aim')) updateView();
}
// The score tightens when the own clock is almost out, during sudden death and for two seconds after a killing blow.
function isKillingBlow(e) {
  if (!e.wormId || !['death', 'splash', 'drown'].includes(e.type)) return false;
  const victim = state?.worms.find((w) => w.id === e.wormId);
  return !!victim && victim.playerId !== state.turn?.playerId;
}
function updateTension() {
  if (screen !== 'game' || !state || state.phase !== 'playing') {
    audio.setTension(0);
    return;
  }
  const urgent = mine() && state.turn.stage === 'action' && state.turn.remaining <= 5;
  const blow = performance.now() - killingBlowAt < 2000;
  const sudden = (state.elapsed || 0) >= CONFIG.suddenDeathSeconds;
  audio.setTension(urgent || blow ? 1 : sudden ? 0.7 : 0);
}
// While a thumb holds a stick, a charge or an aim drag, the instruments step back visually.
function updateFocus() {
  const game = $('.game');
  if (game)
    game.classList.toggle(
      'is-aiming',
      canAct() &&
        (!!chargeAt ||
          !!aimControl?.active ||
          !!slingshot ||
          keys.has('ArrowUp') ||
          keys.has('ArrowDown') ||
          !!document.querySelector('.stick-pad.is-held')),
    );
}
function updateView() {
  const w = weaponInfo();
  renderer?.setView({
    playerId: me,
    angle,
    facing,
    power,
    weapon,
    charging: !!chargeAt || !!slingshot,
    targeting: !!w.target && mine(),
    target,
    quality: prefs.quality,
    reducedMotion: prefs.reducedMotion,
    sensitivity: prefs.sensitivity,
  });
  if (screen !== 'game') return;
  updateFocus();
  $('#aim').value = String(Math.round((angle * 180) / Math.PI));
  $('#target-hint').hidden = !w.target || !mine();
  chargeIndicator?.update({
    charging: (!!chargeAt || !!slingshot) && w.power,
    power,
    enabled: canAct(),
    reducedMotion: prefs.reducedMotion,
  });
  $('#power-text').textContent = slingshot
    ? slingshot.cancel
      ? 'SUELTA PARA CANCELAR'
      : 'SUELTA PARA DISPARAR'
    : chargeAt && w.power
      ? 'SUELTA'
      : w.power
        ? 'MANTÉN Y SUELTA'
        : 'TOCA PARA USAR';
  $('#fire-text').textContent = slingshot
    ? slingshot.cancel
      ? 'CANCELAR'
      : power >= 0.99
        ? '¡A TOPE!'
        : 'TENSANDO'
    : chargeAt && w.power
      ? power >= 0.99
        ? '¡A TOPE!'
        : 'CARGANDO'
      : w.target
        ? 'USAR'
        : w.id === 'rope'
          ? 'ENGANCHAR'
          : w.id === 'jetpack'
            ? active()?.jetpack
              ? 'APAGAR'
              : 'ACTIVAR'
            : 'DISPARAR';
}
function updateHud() {
  if (screen !== 'game' || !state) return;
  const p = state.players.find((p) => p.id === state.turn.playerId);
  const w = weaponInfo();
  const self = state.players.find((p) => p.id === me);
  const ammo = self?.ammo?.[weapon];
  const ownAlive = state.worms.filter((w) => w.playerId === me && w.hp > 0);
  $('#turn-label').textContent =
    state.turn.stage === 'retreat'
      ? 'RETÍRATE'
      : state.turn.stage === 'settling'
        ? 'RESOLVIENDO IMPACTOS'
        : mine()
          ? 'TU TURNO'
          : `TURNO ${state.turn.number}`;
  $('#turn-player').textContent = p?.name || 'Fin de la partida';
  $('.turn-block').style.setProperty('--player-color', p?.color || 'var(--accent)');
  $('#timer').textContent = Math.max(0, Math.ceil(state.turn.remaining));
  $('#timer').classList.toggle('urgent', state.turn.remaining <= 5);
  updateTension();
  $('#wind').textContent = `${state.wind < 0 ? '←' : '→'} ${Math.abs(state.wind).toFixed(0)}`;
  // Replacing a button's text node while a finger is down can cancel its
  // native click in WebKit. Snapshots must not rewrite unchanged labels.
  const ammoLabel = String(ammo === -1 ? '∞' : (ammo ?? '—'));
  if ($('#equipped-name').textContent !== w.name) $('#equipped-name').textContent = w.name;
  if ($('#equipped-ammo').textContent !== ammoLabel) $('#equipped-ammo').textContent = ammoLabel;
  const artPath = `/art/arsenal/${w.id}.png`;
  if ($('#equipped-art').getAttribute('src') !== artPath) $('#equipped-art').src = artPath;
  $('#arsenal').setAttribute(
    'aria-label',
    `Abrir arsenal. ${w.name}, ${ammo === -1 ? 'munición ilimitada' : ammoLabel + ' usos'}`,
  );
  const tool = active()?.jetpack ? 'jetpack' : active()?.rope ? 'rope' : 'move',
    mode = controlMode(active(), weapon);
  $('.game').dataset.ownTurn = String(mine());
  $('.control-deck').dataset.tool = tool;
  $('.control-deck').dataset.mode = mode;
  joysticks.forEach((control) => {
    control.setMode(mode);
    control.setEnabled(canAct());
  });
  deriveInput(false);
  $('#weapon-help').textContent =
    state.turn.stage === 'retreat'
      ? 'Aléjate del impacto'
      : state.turn.stage === 'settling'
        ? 'Resolviendo…'
        : tool === 'jetpack'
          ? `${Math.max(0, active().fuel).toFixed(1)} s de vuelo · ${mode === 'jetpack' ? '↑ Subir · ↓ Bajar' : '↑ / ↓ Apuntar'}`
          : mode === 'rope'
            ? '↑ Acortar · ↓ Alargar'
            : w.target
              ? 'Toca el destino en el campo'
              : tool === 'rope'
                ? '↑ / ↓ Apuntar · Cuerda enganchada'
                : '';
  const elapsed = Math.floor(state.elapsed || 0);
  $('#match-status').dataset.urgent = String(elapsed >= 600);
  $('#match-status').textContent =
    `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')} · ${elapsed >= 600 ? 'MUERTE SÚBITA · El agua sube' : 'Fuego amigo activo'}`;
  $('#spectator').hidden = mine() || state.phase === 'finished';
  $('#spectator').textContent = ownAlive.length
    ? 'Observa, mueve la cámara y prepara tu tiro.'
    : 'Sin gusanos · Sigues como espectador';
  const available =
    mine() &&
    state.turn.stage === 'action' &&
    (ammo !== 0 || (weapon === 'jetpack' && active()?.jetpack)) &&
    !(weapon === 'airstrike' && state.mapId === 'cavern');
  $('#fire').disabled = !available;
  $('#aim').disabled = !mine();
  document
    .querySelectorAll('[data-hold],#jump,#backjump,#release,#menu-end')
    .forEach((b) => (b.disabled = !mine() || state.turn.stage === 'settling'));
  $('#release').disabled = !canAct() || tool === 'move';
  const releaseLabel = tool === 'jetpack' ? 'Apagar' : 'Soltar';
  if ($('#release-label').textContent !== releaseLabel) $('#release-label').textContent = releaseLabel;
  $('.release-rope').hidden = tool === 'jetpack';
  $('.release-jetpack').hidden = tool !== 'jetpack';
  $('#release').setAttribute('aria-label', tool === 'jetpack' ? 'Apagar jetpack' : 'Soltar cuerda');
  updateView();
  if ($('.arsenal-dialog[open]')) arsenalPanel?.update(arsenalState());
}
function openDialog(title, body, cls = '') {
  const focusTarget =
    screen === 'game' ? $(cls === 'arsenal-dialog' ? '#arsenal' : '#hud-menu') : document.activeElement;
  cancelInputs();
  arsenalPanel = null;
  document.querySelector('dialog')?.remove();
  const dialog = document.createElement('dialog');
  dialog.className = ['game', 'home'].includes(screen)
    ? `${cls} game-dialog${screen === 'home' ? ' home-dialog' : ''}`
    : cls;
  dialog.setAttribute('aria-labelledby', 'dialog-title');
  dialog.innerHTML = `<header class="dialog-head"><h2 id="dialog-title">${escape(title)}</h2><button class="icon-btn" aria-label="Cerrar">×</button></header><div class="dialog-body">${body}</div>`;
  document.body.append(dialog);
  dialog.querySelector('.dialog-head button').onclick = () => dialog.close();
  dialog.addEventListener('close', () => {
    dialog.remove();
    const returnFocus = screen === 'game' && portrait() ? $('#rotate-menu') : focusTarget;
    if (!document.querySelector('dialog[open]') && returnFocus?.isConnected)
      returnFocus.focus({ preventScroll: true });
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        dialog.close();
    }
  });
  dialog.showModal();
  return dialog;
}
function openGameMenu() {
  const dialog = openDialog('EN EL CAMPO', gameMenuMarkup(), 'game-menu');
  $('#menu-resume').onclick = () => dialog.close();
  $('#score').onclick = showScore;
  $('#game-help').onclick = openRules;
  bindSettings();
  // Passing the turn lives in the menu so the deck only carries what aiming needs.
  $('#menu-end').disabled = !mine() || state?.turn?.stage === 'settling';
  $('#menu-end').onclick = () => {
    dialog.close();
    action({ type: 'end' });
  };
  $('#menu-resume').focus({ preventScroll: true });
}
function openArsenal() {
  if (!state) return;
  const options = arsenalState();
  const dialog = openDialog('ARSENAL', arsenalMarkup(WEAPONS, options), 'arsenal-dialog');
  arsenalPanel = mountArsenal(dialog, WEAPONS, options, (id) => {
    weapon = id;
    target = null;
    dialog.close();
    updateHud();
  });
}
function arsenalState() {
  return {
    ammo: state?.players.find((p) => p.id === me)?.ammo || {},
    selected: weapon,
    mapId: state?.mapId,
    jetpackActive: mine() && !!active()?.jetpack,
    remaining: state?.turn.remaining,
    ownTurn: mine(),
    reducedMotion: prefs.reducedMotion,
  };
}
// Each worm keeps its own nickname; the player heads the section, so a fallen worm reads as "fuera" instead of 0 PV.

// A live finish announces the verdict over the field, darkens into a REPETICIÓN title and
// replays the final blow at three-quarter speed; the summary opens afterwards. Without a
// blow to replay (forfeits, reconnection) the verdict alone precedes the summary.
let finale = null;
function clearFinale() {
  finale?.destroy();
  finale = null;
}
function finishMatch() {
  if (replaying) return;
  if ($('#result-dialog') || !renderer) {
    showResult();
    return;
  }
  replaying = true;
  document.querySelector('dialog')?.remove();
  clearFinale();
  finale = playFinale({
    renderer,
    copy: finaleCopy(state.result, state.players, me),
    reducedMotion: prefs.reducedMotion,
    onEnd() {
      finale = null;
      replaying = false;
      if (screen === 'game' && state?.phase === 'finished') showResult();
    },
  });
}

// The automatic mode reports which quality it is actually drawing with right now.
function openSettings() {
  showSettings({
    openDialog,
    prefs,
    getRenderer: () => renderer,
    inRoom: !!room,
    onUnlock: () => audio.unlock(),
    onLeave: () => send('leave'),
    onChange() {
      save('ldg-prefs', prefs);
      audio.setVolumes(prefs.music, prefs.sfx);
      $('.game')?.classList.toggle('left-handed', prefs.hand === 'left');
      if ($('.game')) $('.game').dataset.reducedMotion = String(prefs.reducedMotion);
      updateView();
    },
  });
}

bindKeyboard({
  isGame: () => screen === 'game',
  canAct,
  keys,
  onChange: deriveInput,
  onArsenal: openArsenal,
  onFocus: () => renderer?.focus(),
  onJump: jump,
  onRelease: () => action({ type: 'release' }),
  onChargeStart() {
    if (state.turn.stage !== 'action' || slingshot) return;
    audio.unlock();
    chargeAt = performance.now();
    power = weaponInfo().power ? 0.08 : 0.5;
  },
  onChargeEnd() {
    if (chargeAt) {
      chargeAt = 0;
      fire();
    }
  },
});
window.addEventListener('blur', cancelInputs);
window.addEventListener('pagehide', cancelInputs);
document.addEventListener('visibilitychange', () => {
  cancelInputs();
  if (!document.hidden) audio.unlock();
});
window.addEventListener('resize', () => {
  cancelInputs();
  renderer?.resize();
  positionToast();
});
window.screen?.orientation?.addEventListener?.('change', cancelInputs);
document.addEventListener('pointerdown', () => audio.unlock(), { passive: true });
setInterval(() => {
  if (screen !== 'game' || document.hidden) return;
  updateTension();
  if (canAct()) {
    action({ type: 'input', ...input, aim: angle, weapon }, true);
  }
}, 100);
audio.setVolumes(prefs.music, prefs.sfx);
renderHome();
connection.restore();
