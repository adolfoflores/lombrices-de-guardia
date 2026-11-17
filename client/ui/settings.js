export function showSettings({ openDialog, prefs, getRenderer, inRoom, onChange, onLeave, onUnlock }) {
  const $ = (selector) => document.querySelector(selector);
  function qualityNote() {
    if (prefs.quality !== 'auto') return '';
    const now = getRenderer()?.quality;
    return now
      ? `Ahora: ${now === 'low' ? 'ligera' : 'completa'}.`
      : 'En la partida baja a ligera si el dibujo se vuelve lento y vuelve a completa al recuperarse.';
  }
  const dialog = openDialog(
    'A tu manera.',
    `<div class="settings-grid"><label>Mano dominante<select id="hand"><option value="right" ${prefs.hand === 'right' ? 'selected' : ''}>Derecha</option><option value="left" ${prefs.hand === 'left' ? 'selected' : ''}>Izquierda</option></select></label><label>Sensibilidad de apuntado<input id="sensitivity" type="range" min="0.4" max="2" step="0.1" value="${prefs.sensitivity}"></label><label>Música<input id="music" type="range" min="0" max="1" step="0.05" value="${prefs.music}"></label><label>Efectos de sonido<input id="sfx" type="range" min="0" max="1" step="0.05" value="${prefs.sfx}"></label><label>Calidad visual<select id="quality"><option value="auto" ${prefs.quality === 'auto' ? 'selected' : ''}>Automática · según el rendimiento</option><option value="high" ${prefs.quality === 'high' ? 'selected' : ''}>Completa</option><option value="low" ${prefs.quality === 'low' ? 'selected' : ''}>Ligera · menos partículas</option></select></label><label class="check-label"><input id="motion" type="checkbox" ${prefs.reducedMotion ? 'checked' : ''}> Reducir sacudidas y efectos intensos</label></div><p class="context-note">Tus ajustes se guardan en este navegador. La calidad visual no cambia las reglas. <span id="quality-now">${qualityNote()}</span></p>${inRoom ? '<button class="text-btn" id="leave-settings">Abandonar la partida y salir</button>' : ''}`,
  );
  for (const id of ['hand', 'sensitivity', 'music', 'sfx', 'quality', 'motion'])
    $(`#${id}`).oninput = () => {
      onUnlock();
      prefs.hand = $('#hand').value;
      prefs.sensitivity = +$('#sensitivity').value;
      prefs.music = +$('#music').value;
      prefs.sfx = +$('#sfx').value;
      prefs.quality = $('#quality').value;
      prefs.reducedMotion = $('#motion').checked;
      onChange(prefs);
      $('#quality-now').textContent = qualityNote();
    };
  const qualityTimer = setInterval(() => {
    const note = $('#quality-now');
    if (note) note.textContent = qualityNote();
    else clearInterval(qualityTimer);
  }, 1000);
  dialog.addEventListener('close', () => clearInterval(qualityTimer));
  if ($('#leave-settings'))
    $('#leave-settings').onclick = () => {
      dialog.close();
      onLeave();
    };
}
