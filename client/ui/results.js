import { WEAPONS } from '../../shared/config.js';
import { escape } from './text.js';

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export function resultSummary(result, state, me) {
  const stats = result.stats || state?.stats || [];
  if (!stats.length || !state) return '';
  const player = (id) => state.players.find((p) => p.id === id);
  const color = (p) => (/^#[0-9a-f]{3,8}$/i.test(p?.color || '') ? p.color : 'var(--accent)');
  const mvp = player(result.mvpId),
    mvpStats = stats.find((s) => s.playerId === result.mvpId);
  const standout =
    mvp && mvpStats
      ? `<div class="result-mvp" style="--player-color:${color(mvp)}"><span class="result-swatch" aria-hidden="true"></span><div class="result-mvp-copy"><span class="result-kicker">JUGADOR DE LA PARTIDA</span><strong>${escape(mvp.name)}</strong><small>${mvpStats.damageDealt} PV infligidos · ${plural(mvpStats.kills, 'baja', 'bajas')}</small></div></div>`
      : `<div class="result-mvp is-empty"><div class="result-mvp-copy"><span class="result-kicker">JUGADOR DE LA PARTIDA</span><strong>Nadie destacó</strong><small>Ningún rival recibió daño.</small></div></div>`;
  const rows = stats
    .map((s) => {
      const p = player(s.playerId);
      const weapon = WEAPONS.find((w) => w.id === s.bestShot?.weapon);
      const classes = [
        result.winnerIds?.includes(s.playerId) ? 'is-winner' : '',
        s.playerId === me ? 'is-self' : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `<tr class="${classes}" data-player="${escape(s.playerId)}"><th scope="row"><span class="result-chip" style="--player-color:${color(p)}" aria-hidden="true"></span>${escape(p?.name || '—')}</th><td>${s.damageDealt}</td><td>${s.kills}${s.teamKills ? ` <small>+${s.teamKills} ${s.teamKills === 1 ? 'aliada' : 'aliadas'}</small>` : ''}</td><td>${s.shots}</td><td>${s.bestShot?.damage ? `${s.bestShot.damage} <small>${escape(weapon?.name || '')}</small>` : '—'}</td><td>${s.longestShot > 0 ? `${Math.round(s.longestShot / 10)} m` : '—'}</td></tr>`;
    })
    .join('');
  return `${standout}<table class="result-table"><caption>Resumen por jugador</caption><thead><tr><th scope="col">Jugador</th><th scope="col">Daño hecho</th><th scope="col">Bajas</th><th scope="col">Disparos</th><th scope="col">Mejor tiro</th><th scope="col">Tiro más largo</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function finaleCopy(result, players, me) {
  const winners = result?.winnerIds || [];
  if (result?.draw)
    return { tone: 'draw', title: 'EMPATE', sub: 'Eliminación simultánea. Esta vez se lo lleva el terreno.' };
  if (winners.includes(me)) return { tone: 'win', title: '¡GANASTE!', sub: 'Tu grupo es el último en pie.' };
  const names = winners.map((id) => players.find((p) => p.id === id)?.name).filter(Boolean);
  return {
    tone: 'loss',
    title: 'HAS PERDIDO EN GRANDE',
    sub: names.length ? `Gana ${names.join(' y ')}.` : 'El último grupo en pie se lleva la partida.',
  };
}
