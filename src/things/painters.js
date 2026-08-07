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

      if (thing.isControlled && !(thing.downT > 0)) {
        ctx.strokeStyle = PALETTE.white
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.ellipse(thing.x, thing.y + 1, 8, 3.5, 0, 0, Math.PI * 2)
        ctx.stroke()
      }

      // Knocked down: the sheet has no prone art, so lay the sprite on its
      // back (SpriteSheetEngine can't rotate — the painter owns the transform).
      if (thing.downT > 0) {
        ctx.save()
        ctx.translate(thing.x, thing.y)
        ctx.rotate(thing.flipX ? Math.PI / 2 : -Math.PI / 2)
        ctx.translate(-thing.x, -thing.y)
      }
      // Sliding: lean the kick pose into the lunge.
      else if (thing.slide && thing.slide.phase === 'sliding') {
        ctx.save()
        ctx.translate(thing.x, thing.y)
        ctx.rotate((thing.flipX ? -1 : 1) * 0.5)
        ctx.translate(-thing.x, -thing.y)
      }
      const restore = thing.downT > 0 || (thing.slide && thing.slide.phase === 'sliding')

      const key = `${thing.team}${thing.variant}-${thing.anim.name}`
      if (sheets && sheets.ready(key)) {
        sheets.draw(ctx, key, frameOf(thing), thing.x, thing.y, { flipX: thing.flipX })
        if (restore) ctx.restore()
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
      if (restore) ctx.restore()
    },

    /**
     * The ball. (x, y) is the GROUND position (physics/sorting space); an
     * airborne ball draws lifted by z with the shadow left on the turf —
     * the widening shadow-to-sprite gap IS the height cue.
     */
    ball(ctx, thing, view, { sheets }) {
      const z = thing.z ?? 0
      const shadowScale = Math.max(0.3, 1 - z / 60)
      ctx.fillStyle = PALETTE.shadow
      ctx.beginPath()
      ctx.ellipse(thing.x, thing.y + 3, 3 * shadowScale, 1.2 * shadowScale, 0, 0, Math.PI * 2)
      ctx.fill()

      const drawY = thing.y - z * 0.9
      const lift  = 1 + z / 80   // subtly larger when closer to "camera"
      if (sheets && sheets.ready('ball')) {
        sheets.draw(ctx, 'ball', 0, thing.x, drawY, { scale: window.Footie.defs.SPRITE_DEF.ballDrawScale * lift })
        return
      }
      ctx.fillStyle = PALETTE.white
      ctx.beginPath()
      ctx.arc(thing.x, drawY, 3 * lift, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#222'
      ctx.fillRect(thing.x - 1, drawY - 1, 2, 2)
    },

    /** Stand fan (feet at x,y). Idles on frame 0 of the cheer sheet. */
    fan(ctx, thing, view, { sheets }) {
      const mood = thing.anim.name === 'boo' ? 'boo' : 'cheer'
      const key  = `fan-${thing.side}${thing.variant}-${mood}`
      if (sheets && sheets.ready(key)) {
        // waveOffset (heat ripple) shifts the clock by seat position so hot
        // stands roll like a wave rather than bouncing in lockstep.
        const clock = thing.anim.t + (thing.anim.waveOffset ?? 0)
        const frame = thing.anim.fps === 0 ? 0 : Math.floor(clock * thing.anim.fps + thing.phase)
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
