import { createTransport } from './transport.js';
import { read, save } from './storage.js';

const validIdentity = (identity) =>
  identity && typeof identity.code === 'string' && typeof identity.token === 'string' ? identity : null;

/** Open sockets only for entry or a saved room; the home screen stays offline. */
export function createSession({
  inviteCode = '',
  identity: initialIdentity = read('ldg-session', null),
  onReset = () => {},
  onOpen = () => {},
  onMessage = () => {},
  onAck = () => {},
  ...options
} = {}) {
  let identity = validIdentity(initialIdentity);
  let entry = null;
  const transport = createTransport({
    ...options,
    onOpen() {
      if (entry) transport.send(entry.type, entry.data);
      else if (identity) transport.send('resume', { code: identity.code, token: identity.token });
      else transport.disconnect();
      onOpen();
    },
    onMessage(message) {
      if (message.type === 'welcome') {
        identity = { code: message.code, token: message.token, playerId: message.playerId };
        entry = null;
        save('ldg-session', identity);
      } else if (message.type === 'left') api.reset();
      onMessage(message);
    },
    onAck(message, request) {
      if (!message.ok && ['create', 'join', 'resume'].includes(request.type)) {
        entry = null;
        transport.disconnect();
        if (request.type === 'resume') {
          api.reset();
          onReset();
        }
      }
      onAck(message, request);
    },
  });
  const api = {
    get identity() {
      return identity;
    },
    get isOpen() {
      return transport.isOpen;
    },
    send: (...args) => transport.send(...args),
    expect: (...args) => transport.expect(...args),
    enter(type, data) {
      if (!['create', 'join'].includes(type)) throw new Error('Entrada de sala inválida.');
      entry = { type, data };
      if (transport.isOpen) transport.send(type, data);
      else transport.connect();
    },
    restore() {
      if (identity && (!inviteCode || identity.code === inviteCode)) transport.connect();
    },
    reset() {
      entry = null;
      identity = null;
      save('ldg-session', null);
      transport.disconnect();
    },
    close: () => transport.close(),
  };
  return api;
}
