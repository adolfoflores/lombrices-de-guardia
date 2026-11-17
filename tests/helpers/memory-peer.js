import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';

/** Exercises the real room service without HTTP, TCP, sleeps or browser fixtures. */
export class MemoryPeer extends EventEmitter {
  readyState = WebSocket.OPEN;
  bufferedAmount = 0;
  messages = [];
  sequence = 0;
  serial = 0;
  requests = new Map();

  send(data) {
    const message = JSON.parse(data);
    this.messages.push(message);
    if (message.type === 'welcome') this.sequence = message.sequence;
  }

  command(type, body = {}, id = `command-${++this.serial}`) {
    const handshake = ['create', 'join', 'resume'].includes(type);
    const seq = this.requests.get(id)?.seq ?? (handshake ? undefined : ++this.sequence);
    const message = { type, id, seq, ...body };
    this.requests.set(id, message);
    this.emit('message', Buffer.from(JSON.stringify(message)));
    return this.messages.findLast((message) => message.type === 'ack' && message.id === id);
  }

  close(code = 1000) {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.closeCode = code;
    this.emit('close');
  }

  terminate() {
    this.close();
  }
}
