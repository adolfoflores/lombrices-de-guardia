import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export async function waitFor(predicate, timeout = 4000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error('Se agotó la espera del estado de red.');
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
}

export class NetworkClient {
  constructor(ws) {
    this.ws = ws;
    this.pending = new Map();
    this.sequence = 0;
    this.requests = new Map();
    this.states = 0;
    this.bytes = 0;
    this.stateTimes = [];
    this.fullStates = 0;
    this.errors = [];
    this.closed = false;
    ws.on('message', (raw) => {
      this.bytes += raw.length;
      const message = JSON.parse(raw);
      if (message.type === 'welcome') {
        this.identity = message;
        this.sequence = message.sequence;
      }
      if (message.type === 'room') this.room = message.room;
      if (message.type === 'state') {
        this.state = message.state;
        this.states++;
        this.stateTimes.push(performance.now());
        if (message.state.terrain) {
          this.terrain = message.state.terrain;
          this.fullStates++;
        }
      }
      if (message.type === 'error') this.errors.push(message.error);
      if (message.type === 'left') {
        this.left = true;
        this.room = null;
      }
      if (message.type === 'ack') {
        const pending = this.pending.get(message.id);
        if (pending) {
          clearTimeout(pending.timer);
          pending.resolve(message);
          this.pending.delete(message.id);
        }
      }
    });
    ws.on('close', (code) => {
      this.closed = true;
      this.closeCode = code;
    });
    ws.on('error', () => {});
  }
  static async connect(port) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/socket`);
    const client = new NetworkClient(ws);
    await new Promise((resolveOpen, reject) => {
      ws.once('open', resolveOpen);
      ws.once('error', reject);
    });
    return client;
  }
  command(type, body = {}, id = randomUUID()) {
    return new Promise((resolveCommand, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Sin confirmación: ${type}`));
      }, 4000);
      this.pending.set(id, { resolve: resolveCommand, timer });
      const seq =
        this.requests.get(id)?.seq ??
        (['create', 'join', 'resume'].includes(type) ? undefined : ++this.sequence);
      const message = { type, id, seq, ...body };
      this.requests.set(id, message);
      if (this.requests.size > 1024) this.requests.delete(this.requests.keys().next().value);
      this.ws.send(JSON.stringify(message));
    });
  }
  close() {
    this.ws.close();
  }
}
