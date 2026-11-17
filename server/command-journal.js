/** A monotonic sequence rejects evicted commands without retaining their IDs forever. */
export class CommandJournal {
  sequence = 0;
  commands = new Map();
  inputs = new Map();

  lookup(id, sequence) {
    const entry = this.commands.get(id) || this.inputs.get(id);
    return entry && entry.sequence === sequence ? entry.response : null;
  }

  accept(sequence) {
    if (!Number.isSafeInteger(sequence) || sequence <= this.sequence) return false;
    this.sequence = sequence;
    return true;
  }

  remember(id, sequence, response, input = false) {
    const cache = input ? this.inputs : this.commands;
    cache.set(id, { sequence, response });
    if (cache.size > (input ? 16 : 240)) cache.delete(cache.keys().next().value);
  }
}
