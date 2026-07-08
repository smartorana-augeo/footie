;(function () {
  'use strict'

  /**
   * Player animation state: maps movement/possession/match mood onto the
   * sheet names the painters blit, ticks the frame clock, and owns facing.
   * Also the one place kick timers count down (every player has this
   * behavior and it runs even while the match FSM freezes gameplay — the
   * celebration states are exactly when victory/losing must animate).
   *
   * Priority per the spec: mood (victory/losing) > kicking > running > idle.
   */
  window.Footie.behaviors.implementations.animate = function animate() {
    const set = (thing, name, fps) => {
      if (thing.anim.name === name) return
      thing.anim = { name, t: 0, fps }
    }

    return {
      update(thing, ctx, dt) {
        const A = ctx.tuning.anim
        if (thing.kickCooldown > 0) thing.kickCooldown -= dt
        if (thing.kickAnimT > 0)    thing.kickAnimT   -= dt

        if (thing.mood === 'victory')      set(thing, 'victory', A.fps.victory)
        else if (thing.mood === 'losing')  set(thing, 'losing', A.fps.losing)
        else if (thing.kickAnimT > 0)      set(thing, 'kick', A.fps.kick)
        else if (Math.hypot(thing.vx, thing.vy) > A.runThreshold) set(thing, 'run', A.fps.run)
        else                               set(thing, 'idle', A.fps.idle)

        thing.anim.t += dt

        // Face the way we're moving; hold facing when idle.
        if (!ctx.world.freeze && Math.abs(thing.vx) > 5) thing.flipX = thing.vx < 0
      },
    }
  }
})()
