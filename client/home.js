import { hudIcon } from './combat-hud.js';

const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );

export function homeMarkup({ mode = 'create', name = '', code = '', busy = false } = {}) {
  const joining = mode === 'join';
  const label = joining ? 'Entrar a la sala →' : 'Crear sala privada →';
  return `<main class="home" aria-labelledby="home-title">
    <header class="home-masthead">
      <a class="home-brand" href="/" aria-label="Lombrices de guardia, inicio"><img src="/crest.svg" alt="" width="52" height="52"><span>LOMBRICES<small>DE GUARDIA</small></span></a>
      <button class="home-tool" data-settings aria-label="Ajustes">${hudIcon('settings')}</button>
    </header>
    <div class="home-layout">
      <section class="home-intro" aria-label="Artillería entre amigos">
        <div class="home-intro-copy"><h1 id="home-title">Pequeños.<br>Pero con<br><em>dinamita.</em></h1><p>Elige terreno, reúne a tu grupo y calcula el tiro. Aquí hasta el suelo puede dejar de estar de tu lado.</p></div>
        <div class="home-crew" aria-hidden="true"><img src="/crest.svg" alt="" width="420" height="320"><span>Que no te pille el agua.</span></div>
      </section>
      <section class="home-entry" aria-labelledby="entry-title">
        <div class="home-entry-heading"><span class="home-entry-mark" aria-hidden="true">${hudIcon('end')}</span><h2 id="entry-title">Se arma<br> la partida.</h2></div>
        <div class="home-tabs" role="tablist" aria-label="Entrar al juego">${[
          ['create', 'Crear sala'],
          ['join', 'Tengo un código'],
        ]
          .map(
            ([value, text]) =>
              `<button type="button" role="tab" id="${value}-tab" data-home-mode="${value}" aria-selected="${mode === value}" aria-controls="home-entry-body" tabindex="${mode === value ? '0' : '-1'}" ${busy ? 'disabled' : ''}>${text}</button>`,
          )
          .join('')}</div>
        <div id="home-entry-body" role="tabpanel" aria-labelledby="${mode}-tab">
          <form id="entry-form" class="home-form" aria-busy="${busy}">
            <div class="home-field"><label for="player-name">Tu nombre en el campo</label><input id="player-name" name="name" maxlength="20" required autocomplete="nickname" enterkeyhint="${joining ? 'next' : 'go'}" placeholder="¿Cómo te llaman?" value="${escape(name)}" ${busy ? 'disabled' : ''}></div>
            <div id="code-field" class="home-field" ${joining ? '' : 'hidden'}><label for="room-code">Código de la sala</label><input id="room-code" name="code" maxlength="8" autocapitalize="characters" autocomplete="off" spellcheck="false" enterkeyhint="go" placeholder="ABC123" value="${escape(code)}" ${joining ? 'required' : 'disabled'} ${busy && joining ? 'disabled' : ''}></div>
            <button class="home-connect" data-connect data-label="${label}" type="submit" ${busy ? 'disabled' : ''}><span data-connect-label>${busy ? 'Conectando…' : label}</span><span class="home-connecting" aria-hidden="true"></span></button>
          </form>
          <p class="home-entry-note">De 2 a 6 personas · Cada quien en su dispositivo.<br>Entra con tu nombre. Sin cuentas.</p>
        </div>
        <dl class="home-field-notes"><div><dt>Tiempo por turno</dt><dd>30–60 <small>s</small></dd></div><div><dt>Armas</dt><dd>12</dd></div><div><dt>Terrenos</dt><dd>3</dd></div></dl>
      </section>
    </div>
    <footer class="home-bottom"><span>UN POCO DE ESTRATEGIA.<br> UN POCO DE CAOS.</span><button class="home-guide" id="home-rules">${hudIcon('help')}<span>Cómo se juega</span></button></footer>
  </main>`;
}
