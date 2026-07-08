;(function () {
  'use strict'

  /**
   * Pointer + keyboard → normalized input state.
   * Window-level Pointer Events cover mouse click, mouse drag, and touch drag
   * identically (spec: click and click-drag behave the same). Screens
   * subscribe to raw keydown/pointerdown for their own transitions.
   *
   * `pressed` collects keys pressed since the last frame (no auto-repeat);
   * the game loop drains it each tick. Alt/Shift are game controls, so their
   * default browser behavior (menu-bar focus, etc.) is suppressed.
   */
  class InputEngine {
    constructor({ blockTouchWhen = () => false } = {}) {
      this.state = { pointerX: null, pointerY: null, pointerDown: false, pressed: [] }

      window.addEventListener('keydown', e => {
        if (e.key === 'Alt') e.preventDefault()
        if (!e.repeat) this.state.pressed.push(e.key)
      })

      window.addEventListener('pointermove', e => {
        this.state.pointerX = e.clientX
        this.state.pointerY = e.clientY
      })
      window.addEventListener('pointerdown', e => {
        this.state.pointerDown = true
        this.state.pointerX = e.clientX
        this.state.pointerY = e.clientY
      })
      window.addEventListener('pointerup',     () => { this.state.pointerDown = false })
      window.addEventListener('pointercancel', () => { this.state.pointerDown = false })

      // Mobile: drag control must never become page scroll / pull-to-refresh.
      document.addEventListener('touchmove', e => {
        if (blockTouchWhen()) e.preventDefault()
      }, { passive: false })
    }

    onKeyDown(fn) {
      const handler = e => fn(e)
      window.addEventListener('keydown', handler)
      return () => window.removeEventListener('keydown', handler)
    }

    onPointerDown(fn) {
      const handler = e => fn(e)
      window.addEventListener('pointerdown', handler)
      return () => window.removeEventListener('pointerdown', handler)
    }
  }

  window.Footie.engine.InputEngine = InputEngine
})()
