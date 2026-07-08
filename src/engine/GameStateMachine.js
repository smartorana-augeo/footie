;(function () {
  'use strict'

  /**
   * Generic state machine. States are registered as data:
   *   sm.register('menu', { onEnter() {}, onExit() {} })
   * Transitions run exit → enter hooks; unknown states throw early.
   */
  class GameStateMachine {
    constructor() {
      this._states  = new Map()
      this._current = null
    }

    get current() { return this._current }

    is(name) { return this._current === name }

    register(name, { onEnter = () => {}, onExit = () => {} } = {}) {
      this._states.set(name, { onEnter, onExit })
      return this
    }

    transition(name, payload) {
      const next = this._states.get(name)
      if (!next) throw new Error(`GameStateMachine: unknown state "${name}"`)
      if (this._current !== null) this._states.get(this._current).onExit(name)
      const prev = this._current
      this._current = name
      next.onEnter(payload, prev)
    }
  }

  window.Footie.engine.GameStateMachine = GameStateMachine
})()
