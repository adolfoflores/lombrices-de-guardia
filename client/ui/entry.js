import { homeMarkup } from '../home.js';
import { lobbyMarkup } from '../lobby.js';

const $ = (selector) => document.querySelector(selector);
const settingsButtons = (onSettings) =>
  document.querySelectorAll('[data-settings]').forEach((button) => (button.onclick = onSettings));

/** Form bindings stay with their screen; the coordinator owns room/session state. */
export function mountHome({ mode, name, code, busy, onName, onCode, onMode, onSubmit, onRules, onSettings }) {
  $('#app').innerHTML = homeMarkup({ mode, name, code, busy });
  $('#player-name').oninput = (event) => onName(event.target.value);
  $('#room-code').oninput = (event) => onCode(event.target.value);
  const switchMode = (next) => {
    if (busy) return;
    onMode(next);
    $(`#${next}-tab`).focus({ preventScroll: true });
  };
  document.querySelectorAll('[data-home-mode]').forEach((button) => {
    button.onclick = () => switchMode(button.dataset.homeMode);
    button.onkeydown = (event) => {
      const next = {
        ArrowLeft: mode === 'create' ? 'join' : 'create',
        ArrowRight: mode === 'create' ? 'join' : 'create',
        Home: 'create',
        End: 'join',
      }[event.key];
      if (next) {
        event.preventDefault();
        switchMode(next);
      }
    };
  });
  $('#entry-form').onsubmit = (event) => {
    event.preventDefault();
    onSubmit({ name: $('#player-name').value.trim(), code: $('#room-code').value.trim().toUpperCase() });
  };
  $('#home-rules').onclick = onRules;
  settingsButtons(onSettings);
}

export function mountLobby({ room, me, send, onUnlock, onCopy, onShare, onRules, onSettings }) {
  const self = room.players.find((player) => player.id === me);
  $('#app').innerHTML = lobbyMarkup({ room, me });
  document.querySelectorAll('button[data-map]').forEach((button) => {
    button.onclick = () => send('settings', { settings: { mapId: button.dataset.map } });
  });
  for (const [id, key, convert] of [
    ['turn-seconds', 'turnSeconds', Number],
    ['mode', 'mode', String],
    ['worms', 'worms', Number],
  ])
    $(`#${id}`).onchange = (event) => send('settings', { settings: { [key]: convert(event.target.value) } });
  if ($('#team')) $('#team').onchange = (event) => send('team', { team: Number(event.target.value) });
  $('#ready').onclick = () => {
    onUnlock();
    send('ready', { ready: !self?.ready });
  };
  if ($('#start'))
    $('#start').onclick = () => {
      onUnlock();
      send('start');
    };
  $('#copy-code').onclick = () => onCopy(room.code, 'Código copiado');
  $('#share').onclick = onShare;
  $('#leave').onclick = () => send('leave');
  $('#rules').onclick = onRules;
  settingsButtons(onSettings);
}
