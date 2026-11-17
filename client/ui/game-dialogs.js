import { CONFIG } from '../../shared/config.js';
import { escape, teamName } from './text.js';
import { resultSummary, plural } from './results.js';
import { rulesMarkup } from './rules.js';
const $ = (selector) => document.querySelector(selector);

export function createGameDialogs({ openDialog, getState, getRoom, getMe, isReplaying, send }) {
  function showScore() {
    const state = getState();
    if (!state) return;
    openDialog(
      'Siguen en el campo.',
      `<div class="score-list">${state.players
        .map((p) => {
          const worms = state.worms.filter((w) => w.playerId === p.id);
          return `<section><h3>${escape(p.name)} <small>${state.mode === 'ffa' ? '' : teamName(p.team)}</small></h3><p>${worms.map((w) => `<span class="${w.hp > 0 ? 'worm-alive' : 'worm-out'}">${escape(w.name)}: ${w.hp > 0 ? `${Math.ceil(w.hp)} PV` : 'fuera'}</span>`).join(' · ')}</p><meter min="0" max="${worms.length * 100}" value="${worms.reduce((n, w) => n + w.hp, 0)}"></meter></section>`;
        })
        .join('')}</div>`,
    );
  }
  function rematchVoteText() {
    const room = getRoom();
    const names = (room?.rematchRequests || [])
      .map((id) => room.players.find((p) => p.id === id)?.name)
      .filter(Boolean);
    return names.length ? `Quieren revancha: ${names.join(', ')}` : '';
  }
  function showResult() {
    const state = getState(),
      room = getRoom(),
      me = getMe(),
      replaying = isReplaying();
    if (replaying) return;
    if ($('#result-dialog') && $('#result-dialog').dataset.host !== (room?.hostId === me ? 'yes' : 'no'))
      $('#result-dialog').remove();
    if ($('#result-dialog')) {
      const votes = $('#rematch-votes');
      if (votes) votes.textContent = rematchVoteText();
      const ask = $('#ask-rematch');
      if (ask) {
        ask.disabled = !!room?.rematchRequests?.includes(me);
        ask.textContent = ask.disabled ? '✓ Revancha solicitada' : 'Pedir revancha';
      }
      return;
    }
    if (!state?.result) return;
    const result = state.result;
    const host = room?.hostId === me;
    const dialog = openDialog(
      result.draw ? 'Nadie quedó en pie.' : result.text || '¡Tenemos victoria!',
      `<div class="result-art"><img src="/crest.svg" alt="" width="100"></div>${resultSummary(result, state, me)}<p class="context-note">${result.draw ? 'Eliminación simultánea. Esta vez se lo lleva el terreno.' : 'El último grupo en pie se lleva la partida.'} · ${Math.floor(state.elapsed / 60)} min · ${plural(state.turn.number, 'turno', 'turnos')}</p>${host ? '<button class="primary wide" id="rematch">Preparar revancha →</button><button class="secondary wide" id="back-lobby">Volver a la sala</button>' : '<button class="primary wide" id="ask-rematch">Pedir revancha</button><p class="context-note">Quien organiza prepara la revancha sin perder el grupo.</p>'}<p id="rematch-votes" class="context-note">${escape(rematchVoteText())}</p><button class="text-btn" id="leave-result">Salir del grupo</button>`,
      'result-dialog',
    );
    dialog.id = 'result-dialog';
    dialog.dataset.host = host ? 'yes' : 'no';
    if ($('#ask-rematch')) $('#ask-rematch').onclick = () => send('rematch-request');
    if ($('#rematch'))
      $('#rematch').onclick = () => {
        send('rematch');
        dialog.close();
      };
    if ($('#back-lobby'))
      $('#back-lobby').onclick = () => {
        send('lobby');
        dialog.close();
      };
    $('#leave-result').onclick = () => {
      send('leave');
      dialog.close();
    };
  }
  function openRules() {
    const state = getState(),
      room = getRoom();
    openDialog(
      'Puntería, con un poco de malicia.',
      rulesMarkup(state?.turnSeconds || room?.settings.turnSeconds || CONFIG.turnSeconds),
    );
  }
  return { showScore, showResult, openRules };
}
