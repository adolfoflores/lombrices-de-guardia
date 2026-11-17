import { MAPS, MODES, TURN_DURATIONS } from '../shared/config.js';

const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
const teamName = (number) => ['▲ Brasa', '◆ Marea', '● Musgo'][number] || '▲ Brasa';
const mapTags = { hills: 'A cielo abierto', cavern: 'Bajo tierra', islands: 'Entre mareas' };
const icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" class="lobby-icon" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${
    {
      exit: '<path d="M10 5H5v14h5M13 8l4 4-4 4M9 12h12"/>',
      settings:
        '<path d="m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
      copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/>',
      share: '<path d="M12 15V3m-4 4 4-4 4 4M5 12v8h14v-8"/>',
      flag: '<path d="M5 21V3m0 1c5-4 9 4 14 0v10c-5 4-9-4-14 0"/>',
      check: '<path d="m5 12 4 4 10-10"/>',
      arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
    }[name] || ''
  }</svg>`;

/** Room preparation only: handlers and authoritative state remain in main.js. */
export function lobbyMarkup({ room, me }) {
  const host = room.hostId === me;
  const self = room.players.find((player) => player.id === me);
  const settings = room.settings;
  const map = MAPS.find((item) => item.id === settings.mapId) || MAPS[0];
  const mode = MODES.find((item) => item.id === settings.mode) || MODES[0];
  const readyCount = room.players.filter((player) => player.ready && player.connected).length;
  const validCount = mode.players.includes(room.players.length);
  const requiredTeams = settings.mode === '2v2' ? [2, 2, 0] : settings.mode === '3v3' ? [3, 3, 0] : [2, 2, 2];
  const validTeams =
    settings.mode === 'ffa' ||
    requiredTeams.every(
      (count, team) => room.players.filter((player) => player.team === team).length === count,
    );
  const canStart =
    validCount && validTeams && room.players.every((player) => player.ready && player.connected);
  const turnSeconds = TURN_DURATIONS.includes(settings.turnSeconds) ? settings.turnSeconds : 30;
  const waitText = !validCount
    ? settings.mode === 'ffa'
      ? 'Invita a alguien más para comenzar.'
      : `Esta modalidad necesita ${mode.players.join(' o ')} jugadores.`
    : !validTeams
      ? settings.mode === '2v2v2'
        ? 'Repartan las alianzas: tres equipos de dos.'
        : `Repartan las alianzas: dos equipos de ${settings.mode === '2v2' ? 'dos' : 'tres'}.`
      : readyCount < room.players.length
        ? `Faltan ${room.players.length - readyCount} por confirmar.`
        : 'Todo el grupo está listo. ¡Al campo!';
  const hostDisabled = host ? '' : 'disabled';

  return `<main class="lobby" data-map="${map.id}" aria-labelledby="lobby-title">
    <header class="lobby-masthead">
      <a class="lobby-brand" href="/" aria-label="Lombrices de guardia, inicio"><img src="/crest.svg" alt="" width="52" height="52"><span>LOMBRICES<small>DE GUARDIA</small></span></a>
      <div class="lobby-tools"><button class="lobby-button lobby-leave" id="leave" aria-label="Salir de la sala">${icon('exit')}<span>Salir</span></button><button class="lobby-button lobby-settings" data-settings aria-label="Ajustes">${icon('settings')}</button></div>
    </header>
    <div class="lobby-briefing">
      <div class="lobby-title"><span class="lobby-kicker">SALA PRIVADA · ${host ? 'TÚ ORGANIZAS' : 'PREPARANDO LA PARTIDA'}</span><h1 id="lobby-title">Antes del<br><em>estruendo.</em></h1><p>Reúne al grupo. Elige terreno. Haz historia.</p></div>
      <section class="lobby-invite" aria-label="Invitar a la sala"><span class="lobby-kicker">PASA EL CÓDIGO</span><button id="copy-code" aria-label="Copiar código de sala ${escape(room.code)}"><span>${escape(room.code)}</span>${icon('copy')}</button><button id="share" class="lobby-button">${icon('share')}<span>Invitar al grupo</span></button></section>
    </div>
    <div class="lobby-deployment">
      <section class="lobby-terrain lobby-panel" aria-labelledby="terrain-title">
        <div class="lobby-panel-heading"><div class="lobby-section-title">${icon('flag')}<h2 id="terrain-title">El terreno</h2></div><span class="lobby-stamp">${host ? 'ELIGE TU CAMPO' : 'ELIGE QUIEN ORGANIZA'}</span></div>
        <div class="lobby-map-picker" role="group" aria-label="Terreno de la partida">${MAPS.map((item, index) => `<button class="lobby-map ${item.id === map.id ? 'selected' : ''}" data-map="${item.id}" ${hostDisabled} aria-pressed="${item.id === map.id}" aria-label="${escape(item.name)}${item.id === map.id ? ', seleccionado' : ''}"><span class="lobby-map-art"><img src="/art/previews/${item.id}-backdrop.webp" alt="" width="480" height="320"><span class="lobby-map-number" aria-hidden="true">0${index + 1}</span><span class="lobby-map-check" aria-hidden="true">${icon('check')}</span></span><span class="lobby-map-copy"><strong>${escape(item.name)}</strong><small>${mapTags[item.id]}</small></span></button>`).join('')}</div>
        <p class="lobby-map-description">${escape(map.description)}${map.airstrike === false ? ' Aquí no hay ataque aéreo.' : ''}</p>
        <div class="lobby-settings-fields">
          <label class="lobby-mode-label">Modalidad<select id="mode" ${hostDisabled}>${MODES.map((item) => `<option value="${item.id}" ${item.id === settings.mode ? 'selected' : ''}>${escape(item.name)}</option>`).join('')}</select></label>
          <label>Gusanos por persona<select id="worms" ${hostDisabled}>${[2, 3, 4].map((number) => `<option value="${number}" ${number === settings.worms ? 'selected' : ''}>${number} gusanos</option>`).join('')}</select></label>
          <label>Tiempo por turno<select id="turn-seconds" ${hostDisabled}>${TURN_DURATIONS.map((seconds) => `<option value="${seconds}" ${seconds === turnSeconds ? 'selected' : ''}>${seconds} s</option>`).join('')}</select></label>
        </div>
        <div class="lobby-rules-row"><p>${settings.mode === 'ffa' ? 'Cada quien por su cuenta. Gana el último en pie.' : 'Elijan sus alianzas. Los turnos alternan entre equipos.'}</p><button class="lobby-button" id="rules">Reglas y controles ${icon('arrow')}</button></div>
      </section>
      <section class="lobby-squad lobby-panel" aria-labelledby="squad-title">
        <div class="lobby-panel-heading"><div class="lobby-section-title"><h2 id="squad-title">El escuadrón</h2></div><span class="lobby-headcount"><strong>${room.players.length}</strong><span>/ 6</span></span></div>
        <ol class="lobby-roster">${room.players.map((player, index) => `<li class="${player.id === me ? 'is-self ' : ''}${!player.connected ? 'is-offline' : ''}"><span class="lobby-player-number" style="--player:${/^#[0-9a-f]{3,8}$/i.test(player.color || '') ? player.color : 'var(--accent)'}" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span><div class="lobby-player-copy"><strong>${escape(player.name)}${player.id === me ? '<small>TÚ</small>' : ''}</strong><span>${room.hostId === player.id ? 'Organiza · ' : ''}${!player.connected ? 'Reconectando…' : player.ready ? 'Listo para jugar' : 'Preparándose'}${settings.mode !== 'ffa' ? ` · ${teamName(player.team)}` : ''}</span></div><span class="lobby-ready-mark ${player.ready && player.connected ? 'is-ready' : ''}" aria-label="${player.ready && player.connected ? 'Listo' : 'Esperando'}">${player.ready && player.connected ? icon('check') : '<span aria-hidden="true">···</span>'}</span></li>`).join('')}${room.players.length < 2 ? '<li class="lobby-empty-seat"><span aria-hidden="true">+</span><p>Se busca buena puntería.<small>Comparte el código para sumar a alguien.</small></p></li>' : ''}</ol>
        ${settings.mode !== 'ffa' ? `<label class="lobby-team-label">Tu alianza<select id="team">${Array.from({ length: settings.mode === '2v2v2' ? 3 : 2 }, (_, number) => `<option value="${number}" ${self?.team === number ? 'selected' : ''}>${teamName(number)}</option>`).join('')}</select></label>` : ''}
        <div class="lobby-launch"><button class="lobby-button lobby-ready ${self?.ready ? 'is-ready' : ''}" id="ready" aria-pressed="${Boolean(self?.ready)}">${icon('check')}<span>${self?.ready ? 'Listo · cambiar' : 'Estoy listo'}</span></button>${host ? `<button class="lobby-button lobby-start" id="start" ${!canStart ? 'disabled' : ''}><span>¡Al campo!</span>${icon('arrow')}</button>` : '<p class="lobby-guest-note">Quien organiza dará la salida.</p>'}<p class="lobby-wait-note" role="status">${waitText}</p></div>
      </section>
    </div>
    <footer class="lobby-footer"><span>QUE NO TE PILLE EL AGUA.</span><span>Los cambios de partida reinician los «listo».</span></footer>
  </main>`;
}
