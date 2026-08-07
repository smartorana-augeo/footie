;(function () {
  'use strict'

  /**
   * Crowd animation. Two layers:
   *
   *   Mood bursts — the match FSM flips whole stands to 'cheer'/'boo' for a
   *   while via thing.mood + moodT (goals, eruptions; moodFps overrides the
   *   default cheer rate for Star Power eruptions).
   *
   *   Heat — while idle, each side's stand tracks its team's Star Power
   *   meter (world.crowdHeat, a tier of {fraction, fps}): a fan joins the
   *   bounce when its random phase falls inside the tier's fraction, so the
   *   participating set is stable and GROWS as the meter fills — the same
   *   superfans keep bouncing while their neighbours join in. An x-based
   *   stagger ripples the motion down the stand instead of lockstep.
   */
  window.Footie.behaviors.implementations.animateFan = function animateFan() {
    return {
      update(thing, ctx, dt) {
        const fps = ctx.tuning.anim.fps
        if (thing.mood !== 'idle') {
          thing.moodT -= dt
          if (thing.moodT <= 0) { thing.mood = 'idle'; thing.moodFps = null; thing.anim.t = 0 }
        }

        if (thing.mood === 'idle') {
          const heat = ctx.world.crowdHeat?.[thing.side]
          const STAR = window.Footie.defs.STAR
          if (heat && heat.fraction > 0 && (thing.phase / 4) < heat.fraction) {
            thing.anim.name = 'cheer'
            thing.anim.fps  = heat.fps
            // Wave: offset the clock by position so the bounce rolls along the row.
            thing.anim.t += dt
            thing.anim.waveOffset = thing.x * STAR.audience.waveStaggerPerPx
            return
          }
          thing.anim.name = 'cheer'
          thing.anim.fps  = 0
          thing.anim.waveOffset = 0
          thing.anim.t += dt
          return
        }

        thing.anim.name = thing.mood === 'boo' ? 'boo' : 'cheer'
        thing.anim.fps  = thing.moodFps ?? (thing.mood === 'boo' ? fps.boo : fps.cheer)
        thing.anim.waveOffset = 0
        thing.anim.t += dt
      },
    }
  }
})()
