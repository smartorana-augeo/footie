;(function () {
  'use strict'

  /**
   * Player animation state: maps movement/possession/match mood onto the
   * sheet names the painters blit, ticks the frame clock, and owns facing.
   * Also the one place kick timers count down (every player has this
   * behavior and it runs even while the match FSM freezes gameplay — the
   * celebration states are exactly when victory/losing must animate).
   *
   * Priority per the spec: knocked down (frozen 'losing' frame) > statue
   * (Flat-Footed freeze) > mood (victory/losing) > sliding/kicking >
   * running > idle. Facing never flips while down/frozen/sliding.
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

        // Flattened: hold frame 0 of the losing pose, face where we fell.
        if (thing.downT > 0) {
          thing.anim = { name: 'losing', t: 0, fps: 0 }
          return
        }
        // Flat-Footed statue: keep whatever frame we're on, don't advance.
        if (thing.frozenT > 0) return

        if (thing.mood === 'victory')      set(thing, 'victory', A.fps.victory)
        else if (thing.mood === 'losing')  set(thing, 'losing', A.fps.losing)
        else if (thing.slide)              set(thing, 'kick', A.fps.kick)   // slide rides the kick pose
        else if (thing.kickAnimT > 0)      set(thing, 'kick', A.fps.kick)
        else if (Math.hypot(thing.vx, thing.vy) > A.runThreshold) set(thing, 'run', A.fps.run)
        else                               set(thing, 'idle', A.fps.idle)

        thing.anim.t += dt

        // Face the way we're moving; hold facing when idle or sliding.
        if (!ctx.world.freeze && !thing.slide && Math.abs(thing.vx) > 5)
          thing.flipX = thing.vx < 0
      },
    }
  }
})()
