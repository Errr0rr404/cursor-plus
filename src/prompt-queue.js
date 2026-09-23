'use strict';

/**
 * prompt-queue — FIFO queue for prompts typed while the agent is busy.
 *
 * Pressing Enter while `busy` is true enqueues the current draft; the
 * wrapper drains the queue when the response settles.
 */

class PromptQueue {
  constructor({ maxSize = 20 } = {}) {
    this.maxSize = maxSize;
    this._items = [];
  }

  enqueue(prompt) {
    const text = String(prompt || '').trim();
    if (!text) return { ok: false, reason: 'empty' };
    if (this._items.length >= this.maxSize) return { ok: false, reason: 'full', size: this._items.length };
    this._items.push(text);
    return { ok: true, size: this._items.length };
  }

  dequeue() {
    return this._items.shift() || null;
  }

  peek() {
    return this._items[0] || null;
  }

  clear() {
    this._items.length = 0;
  }

  get length() { return this._items.length; }

  toArray() { return this._items.slice(); }
}

module.exports = { PromptQueue };
module.exports.PromptQueue = PromptQueue;