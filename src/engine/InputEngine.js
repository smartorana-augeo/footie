;(function () {
  'use strict'

  /**
   * Pointer + keyboard → normalized input state.
   * Window-level Pointer Events track the hovering mouse and touch drags
   * alike; pointerDown is exposed separately for press-gated actions.
   * Screens subscribe to raw keydown/pointerdown for their own transitions.
   *
   * `pressed` collects keys pressed since the last frame (no auto-repeat);
   * the game loop drains it each tick. Alt/Shift are game controls, so their
   * default browser behavior (menu-bar focus, etc.) is suppressed.
   */
  class InputEngine {
    constructor({ blockTouchWhen = () => false } = {}) {
      this.state = { pointerX: null, pointerY: null, pointerDown: false, pointerType: null, pressed: [] }

      window.addEventListener('keydown', e => {
        // Alt and Space are game controls: suppress menu-bar focus, page
        // scroll, and space re-activating whichever button was last focused.
        if (e.key === 'Alt' || e.key === ' ') e.preventDefault()
        if (!e.repeat) this.state.pressed.push(e.key)
      })

      window.addEventListener('pointermove', e => {
        this.state.pointerX = e.clientX
        this.state.pointerY = e.clientY
      })
      window.addEventListener('pointerdown', e => {
        this.state.pointerDown = true
        this.state.pointerType = e.pointerType
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
