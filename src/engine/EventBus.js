;(function () {
  'use strict'

  /**
   * Minimal pub/sub. Behaviors emit outcomes here ('goal', 'kick', …);
   * the composition root subscribes. Keeps behaviors ignorant of UI.
   */
  class EventBus {
    constructor() { this._handlers = new Map() }

    on(event, fn) {
      if (!this._handlers.has(event)) this._handlers.set(event, new Set())
      this._handlers.get(event).add(fn)
      return () => this._handlers.get(event)?.delete(fn)
    }

    emit(event, payload) {
      const set = this._handlers.get(event)
      if (set) for (const fn of set) fn(payload)
    }
  }

  window.Footie.engine.EventBus = EventBus
})()
