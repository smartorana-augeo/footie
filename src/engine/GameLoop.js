;(function () {
  'use strict'

  /**
   * RAF loop engine. Owns nothing but the frame cadence.
   * dt is clamped so a background tab can't teleport the simulation on resume.
   */
  class GameLoop {
    constructor({ maxDt = 0.05 } = {}) {
      this._maxDt = maxDt
      this._raf   = null
      this._tick  = null
      this._last  = 0
    }

    get running() { return this._raf !== null }

    /** @param {(dt: number, ts: number) => void} tickFn */
    start(tickFn) {
      this.stop()
      this._tick = tickFn
      this._last = performance.now()
      this._raf  = requestAnimationFrame(ts => this._frame(ts))
    }

    stop() {
      if (this._raf !== null) cancelAnimationFrame(this._raf)
      this._raf = null
    }

    _frame(ts) {
      if (this._raf === null) return
      const dt = Math.min((ts - this._last) / 1000, this._maxDt)
      this._last = ts
      this._tick(dt, ts)
      if (this._raf !== null) this._raf = requestAnimationFrame(t => this._frame(t))
    }
  }

  window.Footie.engine.GameLoop = GameLoop
})()
