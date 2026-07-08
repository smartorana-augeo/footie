;(function () {
  'use strict'

  /**
   * Painter implementations, registered by visual `kind` (see RenderEngine).
   * Every painter tries the real sheet art first and falls back to flat
   * shapes while images load (or if art is ever removed) — the game is
   * playable art-less. Painters receive { tileset, sheets } and blit
   * through them; nothing here touches the GPU or the DOM.
   */
  const PALETTE = {
    red:      '#d5382f',
    redDark:  '#8f1f19',
    teal:     '#2fa7a0',
    tealDark: '#1a6b66',
    skin:     '#e8b88a',
    white:    '#ffffff',
    shadow:   'rgba(20, 40, 20, 0.35)',
  }

  const frameOf = thing => Math.floor(thing.anim.t * (thing.anim.fps ?? 6))

  const painters = {
    /** Field player: ground ring for the controlled one, then sheet art (feet at x,y). */
    fieldPlayer(ctx, thing, view, { sheets }) {
      // Soft ground shadow sells the top-down-ish perspective.
      ctx.fillStyle = PALETTE.shadow
      ctx.beginPath()
      ctx.ellipse(thing.x, thing.y + 1, 6, 2.5, 0, 0, Math.PI * 2)
      ctx.fill()

      if (thing.isControlled) {
        ctx.strokeStyle = PALETTE.white
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.ellipse(thing.x, thing.y + 1, 8, 3.5, 0, 0, Math.PI * 2)
        ctx.stroke()
      }

      const key = `${thing.team}${thing.variant}-${thing.anim.name}`
      if (sheets && sheets.ready(key)) {
        sheets.draw(ctx, key, frameOf(thing), thing.x, thing.y, { flipX: thing.flipX })
        return
      }

      // Shape stand-in: little jersey block + head, team colored.
      const c = thing.team === 'player' ? PALETTE.red : PALETTE.teal
      const d = thing.team === 'player' ? PALETTE.redDark : PALETTE.tealDark
      ctx.fillStyle = d
      ctx.fillRect(thing.x - 4, thing.y - 12, 8, 12)
      ctx.fillStyle = c
      ctx.fillRect(thing.x - 4, thing.y - 12, 8, 8)
      ctx.fillStyle = PALETTE.skin
      ctx.fillRect(thing.x - 3, thing.y - 18, 6, 6)
    },

    /** The ball, with its own tiny shadow. (x, y) is the ball center. */
    ball(ctx, thing, view, { sheets }) {
      ctx.fillStyle = PALETTE.shadow
      ctx.beginPath()
      ctx.ellipse(thing.x, thing.y + 3, 3, 1.2, 0, 0, Math.PI * 2)
      ctx.fill()

      if (sheets && sheets.ready('ball')) {
        sheets.draw(ctx, 'ball', 0, thing.x, thing.y, { scale: window.Footie.defs.SPRITE_DEF.ballDrawScale })
        return
      }
      ctx.fillStyle = PALETTE.white
      ctx.beginPath()
      ctx.arc(thing.x, thing.y, 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#222'
      ctx.fillRect(thing.x - 1, thing.y - 1, 2, 2)
    },

    /** Stand fan (feet at x,y). Idles on frame 0 of the cheer sheet. */
    fan(ctx, thing, view, { sheets }) {
      const mood = thing.anim.name === 'boo' ? 'boo' : 'cheer'
      const key  = `fan-${thing.side}${thing.variant}-${mood}`
      if (sheets && sheets.ready(key)) {
        const frame = thing.anim.fps === 0 ? 0 : Math.floor(thing.anim.t * thing.anim.fps + thing.phase)
        sheets.draw(ctx, key, frame, thing.x, thing.y, { flipX: thing.flipX })
        return
      }
      ctx.fillStyle = thing.side === 'red' ? PALETTE.red : PALETTE.teal
      ctx.fillRect(thing.x - 3, thing.y - 10, 6, 10)
      ctx.fillStyle = PALETTE.skin
      ctx.fillRect(thing.x - 2, thing.y - 14, 4, 4)
    },
  }

  window.Footie.things.painters = painters
  window.Footie.things.PALETTE  = PALETTE
})()
