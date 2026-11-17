import { mobileJoystickMarkup } from './mobile-controls.js';
import { chargeIndicatorMarkup } from './charge-control.js';
import { CONFIG } from '../shared/config.js';

const paths = {
  overview:
    '<path d="m4 7 8-3 8 3 8-3v21l-8 3-8-3-8 3Z"/><path d="M12 4v21m8-18v21"/><path d="m6 17 4-3m12 2 4-4"/>',
  focus:
    '<path d="M11 4H5v6m16-6h6v6M5 22v6h6m16-6v6h-6"/><path d="M13 23c-5 0-5-5-2-6l2-1v-5a4 4 0 0 1 8 0v7c0 3-3 5-8 5Z"/><path d="M17 11h.1M18 16h3"/>',
  zoomIn: '<circle cx="14" cy="13" r="9"/><path d="m21 20 7 8M9 13h10m-5-5v10"/>',
  zoomOut: '<circle cx="14" cy="13" r="9"/><path d="m21 20 7 8M9 13h10"/>',
  menu: '<rect x="4" y="5" width="24" height="22" rx="4"/><path d="M10 11h12M10 16h12M10 21h8"/>',
  clock: '<circle cx="16" cy="18" r="11"/><path d="M12 3h8M16 3v4m8 2 3-3M16 11v7l4 3"/>',
  wind: '<path d="M6 28V4m0 2h19l-4 5 4 5H6m6-10v10m6-10v10M2 28h9"/>',
  jump: '<path d="M5 27h22M7 22c-4-1-3-5 1-5h2v-5a4 4 0 0 1 8 0v5c0 4-3 5-11 5Z"/><path d="M14 12h.1M21 15V4m-4 4 4-4 4 4"/>',
  backjump:
    '<path d="M5 27h22M19 22c5 0 6-5 1-5h-2v-5a4 4 0 0 0-8 0v5c0 3 3 5 9 5Z"/><path d="M14 12h.1M24 12c0-9-16-10-18 0m0-7v7h7"/>',
  release:
    '<path d="m12 9 3-3a6 6 0 0 1 9 9l-3 3m-2 5-3 3a6 6 0 0 1-9-9l3-3M13 14l5 5M8 4v4M3 9h4m17 15v4m1-5h4"/>',
  power: '<path d="M16 3v12M9 7a11 11 0 1 0 14 0"/>',
  end: '<path d="M5 27V5m0 1c7-5 13 5 22 0v13c-9 5-15-5-22 0M11 26h16m-5-4 5 4-5 4"/>',
  left: '<path d="m20 5-11 11 11 11"/>',
  right: '<path d="m12 5 11 11-11 11"/>',
  up: '<path d="m5 21 11-11 11 11"/>',
  down: '<path d="m5 11 11 11 11-11"/>',
  chevron: '<path d="m9 19 7-7 7 7"/>',
  resume: '<path d="m11 6 15 10-15 10Z"/>',
  score: '<path d="m16 3 12 5v9c0 6-8 11-12 13C12 28 4 23 4 17V8Z"/><path d="M10 18v4m6-10v10m6-7v7"/>',
  settings:
    '<path d="M5 8h22M5 16h22M5 24h22"/><rect x="10" y="4" width="5" height="8" rx="1"/><rect x="21" y="12" width="5" height="8" rx="1"/><rect x="7" y="20" width="5" height="8" rx="1"/>',
  help: '<path d="M16 7C11 3 6 4 3 5v21c5-2 9-1 13 2 4-3 8-4 13-2V5c-3-1-8-2-13 2Zm0 0v21M7 11l5 1m-5 4 5 1m9-6 4-1m-4 6 4-1"/>',
};

export function hudIcon(name) {
  return `<svg class="hud-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.menu}</svg>`;
}

export function combatHudMarkup({ hand, reducedMotion }) {
  return `<main class="game ${hand === 'left' ? 'left-handed' : ''}" data-reduced-motion="${!!reducedMotion}" data-own-turn="false">
    <header class="game-top" aria-label="Estado de la partida">
      <div class="turn-block"><span id="turn-label">Preparando turno</span><strong id="turn-player">Al campo</strong></div>
      <div class="turn-instruments"><div class="timer-shell">${hudIcon('clock')}<div class="timer" id="timer" aria-label="Tiempo restante">${CONFIG.turnSeconds}</div><small>s</small></div><div class="wind">${hudIcon('wind')}<div><small>VIENTO</small><strong id="wind">→ 0</strong></div></div></div>
      <div class="game-actions"><button type="button" class="hud-button" id="hud-menu" aria-label="Menú de partida" title="Menú de partida">${hudIcon('menu')}</button></div>
    </header>
    <section class="battlefield" aria-label="Campo de batalla"><canvas id="field" aria-label="Terreno de juego. Arrastra para mover la cámara y usa dos dedos para ampliar."></canvas>
      <div class="camera-tools" aria-label="Cámara"><button class="hud-button" id="overview" aria-label="Vista general" title="Vista general">${hudIcon('overview')}</button><button class="hud-button" id="focus" aria-label="Volver al gusano activo" title="Centrar gusano">${hudIcon('focus')}</button><button class="hud-button" id="zoom-in" aria-label="Acercar cámara" title="Acercar">${hudIcon('zoomIn')}</button><button class="hud-button" id="zoom-out" aria-label="Alejar cámara" title="Alejar">${hudIcon('zoomOut')}</button></div>
      <div class="match-status" id="match-status"></div><div class="turn-notice" id="spectator" hidden></div><div id="target-hint" class="target-hint" hidden>Toca un destino en el terreno y confirma con Usar.</div>
    </section>
    <section class="control-deck" aria-label="Controles de combate"><div class="move-controls">${mobileJoystickMarkup('x')}${mobileJoystickMarkup('y')}<div class="move-row"><button data-hold="left" class="touch-btn hud-button" aria-label="Mover a la izquierda">${hudIcon('left')}</button><button data-hold="right" class="touch-btn hud-button" aria-label="Mover a la derecha">${hudIcon('right')}</button><button id="jump" class="touch-btn jump hud-button" aria-label="Saltar">${hudIcon('jump')}<small>SALTO</small></button><button id="backjump" class="touch-btn jump hud-button" aria-label="Salto hacia atrás">${hudIcon('backjump')}<small>ATRÁS</small></button></div><div class="tool-row"><button data-hold="up" class="hud-button" aria-label="Acortar cuerda o subir con jetpack">${hudIcon('up')}<span>Subir</span></button><button data-hold="down" class="hud-button" aria-label="Alargar cuerda o bajar con jetpack">${hudIcon('down')}<span>Bajar</span></button><button id="release" class="hud-button"><span class="release-rope">${hudIcon('release')}</span><span class="release-jetpack" hidden>${hudIcon('power')}</span><span id="release-label">Soltar</span></button></div></div>
      <div class="aim-controls"><div class="aim-label"><label for="aim">APUNTADO</label><button id="arsenal" class="weapon-button" aria-label="Abrir arsenal"><img id="equipped-art" src="/art/arsenal/bazooka.png" alt="" width="80" height="48"><span class="arsenal-current"><small>ARSENAL</small><strong id="equipped-name">Bazuca</strong></span><span id="equipped-ammo">∞</span>${hudIcon('chevron')}</button></div><input id="aim" type="range" min="-180" max="180" step="1" value="-45" aria-label="Ángulo de disparo"><span id="weapon-help"></span></div>
      <button id="fire" class="fire-btn">${chargeIndicatorMarkup()}<span id="fire-text">DISPARAR</span><small id="power-text">MANTÉN Y SUELTA</small></button>
    </section>
    <section class="rotate-overlay" aria-labelledby="rotate-title"><div class="rotate-card" data-slot="orientation-guide">
      <span class="rotate-kicker">POSICIÓN DE COMBATE</span>
      <div class="rotate-art" aria-hidden="true"><img src="/crest.svg" alt="" width="224" height="177"><svg class="rotate-signal" viewBox="0 0 120 120" fill="none"><g class="rotate-device"><rect x="38" y="23" width="44" height="74" rx="8"/><path d="M54 31h12M55 89h10"/></g><path class="rotate-arrow" d="M17 65a43 43 0 0 1 69-39m-1-13 2 14-14 1M103 55a43 43 0 0 1-69 39m1 13-2-14 14-1"/></svg></div>
      <h2 id="rotate-title">El campo<br>va de lado.</h2><p class="rotate-copy">Pon el teléfono en horizontal.<br>Dos pulgares. Todo el campo.</p>
      <p class="rotate-tip">Si no gira, desactiva el bloqueo de orientación.</p>
      <button type="button" id="rotate-menu">${hudIcon('menu')}<span>Menú de partida</span></button>
      <p class="rotate-clock">${hudIcon('clock')}El turno sigue corriendo.</p>
    </div></section>
  </main>`;
}

export function gameMenuMarkup() {
  return `<div class="game-menu-actions"><button id="menu-resume">${hudIcon('resume')}<span>Volver al campo</span></button><button id="score">${hudIcon('score')}<span>Estado del grupo</span></button><button data-settings>${hudIcon('settings')}<span>Ajustes</span></button><button id="game-help">${hudIcon('help')}<span>Cómo jugar</span></button><button id="menu-end" title="Terminar mi turno">${hudIcon('end')}<span>Pasar turno</span></button></div><p class="game-menu-note">La partida sigue mientras revisas el menú.</p>`;
}
