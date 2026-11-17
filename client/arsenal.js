const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const setText = (element, value) => {
  if (element.textContent !== value) element.textContent = value;
};

function availability(weapon, state) {
  if (weapon.id === 'airstrike' && state.mapId === 'cavern')
    return { stamp: 'SIN CIELO', reason: 'El techo de la gruta bloquea el ataque aéreo.' };
  if (state.ammo[weapon.id] === 0 && !(weapon.id === 'jetpack' && state.jetpackActive))
    return { stamp: 'AGOTADA', reason: 'Sin munición para esta partida.' };
  return null;
}

export function arsenalMarkup(weapons, state) {
  return `<div class="arsenal-grid" data-slot="arsenal-grid" role="group" aria-label="Armas y herramientas">${weapons
    .map((weapon, index) => {
      const blocked = availability(weapon, state),
        selected = weapon.id === state.selected;
      return `<button type="button" class="arsenal-item${selected ? ' selected equipped' : ''}${blocked ? ' unavailable' : ''}" data-slot="arsenal-weapon" data-weapon="${weapon.id}" aria-pressed="${selected}" data-unavailable="${!!blocked}">
      <span class="weapon-index" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>
      <span class="arsenal-ammo ammo" data-slot="arsenal-ammunition" aria-hidden="true"><small>USOS</small><b>${state.ammo[weapon.id] === -1 ? '∞' : (state.ammo[weapon.id] ?? '—')}</b></span>
      <span class="arsenal-illustration" data-slot="arsenal-illustration"><img src="/art/arsenal/${weapon.id}.png" alt="" width="320" height="192" draggable="false"><span class="arsenal-art-fallback" hidden aria-hidden="true">${escape(weapon.icon)}</span></span>
      <strong class="arsenal-name">${escape(weapon.name)}</strong>
      <span class="arsenal-state" aria-hidden="true">${blocked ? blocked.stamp : selected ? 'EQUIPADA' : ''}</span>
    </button>`;
    })
    .join('')}</div>`;
}

/** Native dialog behavior stays with main; this controller owns its arsenal presentation. */
export function mountArsenal(dialog, weapons, initialState, onSelect) {
  let state = initialState,
    inspected = initialState.selected;
  const trigger = document.querySelector('#arsenal');
  const header = dialog.querySelector('.dialog-head');
  const title = header.querySelector('h2');
  const heading = document.createElement('div');
  heading.className = 'arsenal-heading';
  heading.innerHTML = '<small>EQUIPO DE CAMPO</small>';
  title.before(heading);
  heading.append(title);
  const close = header.querySelector('button');
  close.classList.add('arsenal-close');
  close.insertAdjacentHTML(
    'beforebegin',
    '<div class="arsenal-clock" data-slot="arsenal-clock"><span></span><strong></strong></div>',
  );
  dialog
    .querySelector('.dialog-body')
    .insertAdjacentHTML(
      'afterend',
      '<footer class="arsenal-footer" data-slot="arsenal-footer"><p id="arsenal-detail" aria-live="polite" aria-atomic="true"><strong></strong><span class="arsenal-description"></span><small class="arsenal-restriction" hidden></small></p><button type="button" id="arsenal-equip" class="arsenal-equip" data-slot="arsenal-confirm" aria-describedby="arsenal-detail"><span class="arsenal-equip-icon" aria-hidden="true">✓</span><span class="arsenal-equip-label">EQUIPAR</span></button></footer>',
    );
  dialog.dataset.slot = 'arsenal';
  dialog.dataset.reducedMotion = String(!!state.reducedMotion);
  dialog.setAttribute('aria-describedby', 'arsenal-detail');
  const items = new Map(
    [...dialog.querySelectorAll('[data-weapon]')].map((button) => [button.dataset.weapon, button]),
  );
  const description = dialog.querySelector('#arsenal-detail');
  const equip = dialog.querySelector('#arsenal-equip');

  function describe(id) {
    const weapon = weapons.find((weapon) => weapon.id === id) || weapons[0];
    inspected = weapon.id;
    const blocked = availability(weapon, state);
    dialog.dataset.inspected = inspected;
    for (const [itemId, button] of items) {
      const preview = itemId === inspected;
      button.classList.toggle('selected', preview);
      button.setAttribute('aria-pressed', String(preview));
      button.tabIndex = preview ? 0 : -1;
    }
    setText(description.querySelector('strong'), weapon.name);
    setText(description.querySelector('.arsenal-description'), weapon.description);
    const restriction = description.querySelector('.arsenal-restriction');
    setText(restriction, blocked?.reason || '');
    restriction.hidden = !blocked;
    description.dataset.unavailable = String(!!blocked);
    equip.disabled = !!blocked;
    equip.setAttribute('aria-disabled', String(!!blocked));
    equip.dataset.preview = inspected;
    setText(
      equip.querySelector('.arsenal-equip-label'),
      blocked ? blocked.stamp : inspected === state.selected ? 'LISTO' : 'EQUIPAR',
    );
    equip.setAttribute(
      'aria-label',
      blocked
        ? `${weapon.name}: ${blocked.reason}`
        : inspected === state.selected
          ? `Volver al juego con ${weapon.name}`
          : `Equipar ${weapon.name}`,
    );
  }

  function update(next) {
    if (!dialog.isConnected) return;
    state = next;
    for (const weapon of weapons) {
      const button = items.get(weapon.id),
        blocked = availability(weapon, state),
        selected = weapon.id === state.selected;
      // Unavailable equipment can still be inspected. Only confirmation is disabled.
      button.classList.toggle('equipped', selected);
      button.classList.toggle('unavailable', !!blocked);
      button.dataset.unavailable = String(!!blocked);
      const count = state.ammo[weapon.id],
        countLabel = count === -1 ? 'Munición ilimitada' : `${count ?? 0} ${count === 1 ? 'uso' : 'usos'}`;
      button.setAttribute(
        'aria-label',
        `Ver detalles de ${weapon.name}. ${countLabel}.${selected ? ' Equipada.' : ''}${blocked ? ` No se puede equipar: ${blocked.reason}` : ''}`,
      );
      button.title = weapon.description + (blocked ? ` ${blocked.reason}` : '');
      setText(button.querySelector('.arsenal-ammo b'), count === -1 ? '∞' : String(count ?? '—'));
      setText(button.querySelector('.arsenal-state'), blocked ? blocked.stamp : selected ? 'EQUIPADA' : '');
    }
    const clock = dialog.querySelector('.arsenal-clock');
    setText(clock.querySelector('span'), state.ownTurn ? 'TU TURNO' : 'EN ESPERA');
    setText(clock.querySelector('strong'), `${Math.max(0, Math.ceil(state.remaining || 0))} s`);
    clock.classList.toggle('urgent', state.ownTurn && state.remaining <= 5);
    describe(inspected);
  }

  for (const [id, button] of items) {
    button.addEventListener('focus', () => describe(id));
    button.addEventListener('click', () => describe(id));
    const img = button.querySelector('img');
    const loaded = () => {
      delete button.dataset.state;
    };
    const failed = () => {
      button.dataset.state = 'error';
      img.hidden = true;
      button.querySelector('.arsenal-art-fallback').hidden = false;
    };
    img.addEventListener('load', loaded, { once: true });
    img.addEventListener('error', failed, { once: true });
    if (img.complete) {
      if (img.naturalWidth) loaded();
      else failed();
    } else button.dataset.state = 'loading';
  }
  dialog.querySelector('.arsenal-grid').addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...items.values()],
      index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    const columns = getComputedStyle(event.currentTarget).gridTemplateColumns.split(' ').length;
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[event.key];
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (index + delta + buttons.length) % buttons.length;
    buttons[next].focus({ preventScroll: true });
    buttons[next].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  equip.addEventListener('click', () => {
    const weapon = weapons.find((weapon) => weapon.id === inspected);
    if (weapon && !availability(weapon, state)) onSelect(inspected);
  });
  dialog.addEventListener(
    'close',
    () => {
      if (trigger?.isConnected && !document.querySelector('dialog[open]'))
        trigger.focus({ preventScroll: true });
    },
    { once: true },
  );
  update(initialState);
  const selected = items.get(state.selected);
  (selected || [...items.values()][0])?.focus({ preventScroll: true });
  return { update };
}
