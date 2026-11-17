/** Desktop commands; focus and game authority decide whether a key can act. */
export function bindKeyboard({
  target = window,
  focus = () => document.activeElement,
  hasDialog = () => !!document.querySelector('dialog[open]'),
  isGame,
  canAct,
  keys,
  onChange,
  onArsenal,
  onFocus,
  onJump,
  onRelease,
  onChargeStart,
  onChargeEnd,
}) {
  const keydown = (event) => {
    const element = focus();
    if (!isGame() || hasDialog() || ['INPUT', 'SELECT', 'TEXTAREA'].includes(element?.tagName)) return;
    let key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if ((key === ' ' || key === 'Enter') && element?.tagName === 'BUTTON') {
      if (element.id === 'fire') key = ' ';
      else return;
    }
    if ([' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].includes(key))
      event.preventDefault();
    if (key === 'e' && !event.repeat) {
      onArsenal();
      return;
    }
    if (key === 'c') {
      onFocus();
      return;
    }
    if (!canAct()) return;
    keys.add(key);
    onChange();
    if (event.repeat) return;
    if (key === 'Enter') onJump(false);
    if (key === 'Shift') onJump(true);
    if (key === 'r') onRelease();
    if (key === ' ') onChargeStart();
  };
  const keyup = (event) => {
    let key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (key === 'Enter' && focus()?.id === 'fire') key = ' ';
    keys.delete(key);
    onChange();
    if (key === ' ') onChargeEnd();
  };
  target.addEventListener('keydown', keydown);
  target.addEventListener('keyup', keyup);
  return () => {
    target.removeEventListener('keydown', keydown);
    target.removeEventListener('keyup', keyup);
  };
}
