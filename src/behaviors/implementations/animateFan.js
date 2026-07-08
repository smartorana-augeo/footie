;(function () {
  'use strict'

  /**
   * Crowd animation: fans idle on frame 0 of their cheering sheet, and the
   * match FSM flips whole stands to 'cheer' or 'boo' for a while via
   * thing.mood + moodT. Each fan has a random phase so the crowd never
   * moves in lockstep.
   */
  window.Footie.behaviors.implementations.animateFan = function animateFan() {
    return {
      update(thing, ctx, dt) {
        const fps = ctx.tuning.anim.fps
        if (thing.mood !== 'idle') {
          thing.moodT -= dt
          if (thing.moodT <= 0) { thing.mood = 'idle'; thing.anim.t = 0 }
        }
        thing.anim.name = thing.mood === 'boo' ? 'boo' : 'cheer'
        thing.anim.fps  = thing.mood === 'idle' ? 0 : (thing.mood === 'boo' ? fps.boo : fps.cheer)
        thing.anim.t += dt
      },
    }
  }
})()
