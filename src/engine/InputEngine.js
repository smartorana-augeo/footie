;(function () {
  'use strict'

  /**
   * Pointer + keyboard → normalized input state.
   * Pointer Events track the hovering mouse and touch drags alike;
   * pointerDown is exposed separately for press-gated actions. Screens
   * subscribe to raw keydown/pointerdown for their own transitions.
   *
   * Keyboard state is three views over the same stream, all lowercase
   * (`e.key.toLowerCase()`, so Shift+J still reads as 'j'):
   *   `pressed`  — keys pressed since the last frame (no auto-repeat), edges
   *   `released` — keys released since the last frame, edges
   *   `held`     — map of keys physically down right now
   * The game loop drains both edge arrays each tick. `held` is cleared on
   * window blur / tab-hide so Alt-Tab never strands a stuck sprint or charge.
   * Game keys (space, alt, arrows) get preventDefault so they never scroll
   * the page or poke focused buttons.
   *
   * Pointer/touch listeners attach to `surface` (defaults to `window`, i.e.
   * the standalone page's own behavior — the canvas already fills the
   * viewport there, so listening on it vs window is equivalent). An embedding
   * host passes its own canvas: pointer capture on down means a drag that
   * leaves the canvas mid-gesture (element-scoped listeners alone would miss
   * that) still delivers move/up/cancel here, while a stray click ELSEWHERE
   * on the host page (outside the widget) correctly never reaches the game —
   * unlike window-level listening, which would have treated the whole page
   * as the play surface once the canvas stopped being fullscreen.
   */
  class InputEngine {
    constructor({ blockTouchWhen = () => false, surface = window } = {}) {
      this.state = {
        pointerX: null, pointerY: null, pointerDown: false, pointerType: null,
        pressed: [], released: [], held: {},
      }

      const PREVENT = new Set([' ', 'alt', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'])

      window.addEventListener('keydown', e => {
        const key = e.key.toLowerCase()
        // Game controls: suppress menu-bar focus, page scroll, and space
        // re-activating whichever button was last focused.
        if (PREVENT.has(key)) e.preventDefault()
        if (!e.repeat) {
          this.state.pressed.push(key)
          this.state.held[key] = true
        }
      })
      window.addEventListener('keyup', e => {
        const key = e.key.toLowerCase()
        this.state.released.push(key)
        delete this.state.held[key]
      })
      // Alt-Tab / tab-hide: browsers swallow the matching keyup, which would
      // strand a held sprint or a mid-charge shot. Treat every held key as
      // released so charges resolve instead of sticking.
      const clearHeld = () => {
        for (const key of Object.keys(this.state.held)) this.state.released.push(key)
        this.state.held = {}
      }
      window.addEventListener('blur', clearHeld)
      document.addEventListener('visibilitychange', () => { if (document.hidden) clearHeld() })

      surface.addEventListener('pointermove', e => {
        this.state.pointerX = e.clientX
        this.state.pointerY = e.clientY
      })
      surface.addEventListener('pointerdown', e => {
        this.state.pointerDown = true
        this.state.pointerType = e.pointerType
        this.state.pointerX = e.clientX
        this.state.pointerY = e.clientY
        // Redirect this pointer's subsequent events to `surface` regardless of
        // where the cursor/touch physically travels — without this, a drag
        // that leaves a non-fullscreen surface would never see its own
        // pointerup/pointercancel (they'd fire on whatever element is under
        // the pointer at release, which this listener isn't attached to).
        if (typeof surface.setPointerCapture === 'function') {
          surface.setPointerCapture(e.pointerId)
        }
      })
      surface.addEventListener('pointerup', e => {
        this.state.pointerDown = false
        if (typeof surface.releasePointerCapture === 'function' && surface.hasPointerCapture?.(e.pointerId)) {
          surface.releasePointerCapture(e.pointerId)
        }
      })
      surface.addEventListener('pointercancel', e => {
        this.state.pointerDown = false
        if (typeof surface.releasePointerCapture === 'function' && surface.hasPointerCapture?.(e.pointerId)) {
          surface.releasePointerCapture(e.pointerId)
        }
      })

      // Mobile: drag control must never become page scroll / pull-to-refresh.
      // Scoped to `surface` (not document) so an embedded, non-fullscreen game
      // never blocks scrolling on the REST of the host page.
      surface.addEventListener('touchmove', e => {
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
