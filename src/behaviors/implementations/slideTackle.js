;(function () {
  'use strict'

  /**
   * Slide tackle: a committed lunge along the slider's facing. While
   * sliding the tackler owns their own motion (moveToTarget skips), punts
   * the ball away on contact ('tackle' hit:true — the clean tackle), and
   * flattens ANY contacted upright player, friend or foe. A miss costs a
   * long get-up; a hit gets you up quick.
   *
   * This behavior is also the single owner of the downT / downImmuneT
   * knockdown timers — it runs on every player (goalies included: keepers
   * never slide, but they DO get knocked down, and their timers must tick).
   *
   * helpers.startSlide(thing, ctx) is the one entry point — controlInput
   * (human) and aiFieldPlayer (AI) both call it.
   */
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)

  window.Footie.behaviors.helpers.startSlide = function startSlide(thing, ctx) {
    if (thing.slide || thing.downT > 0 || thing.frozenT > 0 || ctx.world.freeze) return false
    let dx = thing.faceX ?? 1
    let dy = thing.faceY ?? 0
    const d = Math.hypot(dx, dy)
    if (d < 0.001) { dx = 1; dy = 0 } else { dx /= d; dy /= d }
    thing.slide = { phase: 'sliding', t: 0, dirX: dx, dirY: dy, hit: false }
    thing.moveTarget = null
    thing.moveDir = null
    thing.kickAnimT = ctx.tuning.anim.kickDuration   // reuse the kick pose
    return true
  }

  window.Footie.behaviors.implementations.slideTackle = function slideTackle() {
    return {
      update(thing, ctx, dt) {
        // Knockdown timers tick here — single owner, every player has this.
        if (thing.downT > 0)       thing.downT       = Math.max(0, thing.downT - dt)
        if (thing.downImmuneT > 0) thing.downImmuneT = Math.max(0, thing.downImmuneT - dt)
        // (frozenT is ticked by the starPower behavior, not here.)

        const slide = thing.slide
        if (!slide) return
        const SL  = ctx.tuning.slide
        const AIR = ctx.tuning.ballAir
        const P   = ctx.tuning.player

        if (slide.phase === 'sliding') {
          slide.t += dt
          const rect = ctx.field.rect
          thing.x = clamp(thing.x + slide.dirX * SL.speed * dt, rect.x, rect.x + rect.w)
          thing.y = clamp(thing.y + slide.dirY * SL.speed * dt, rect.y, rect.y + rect.h)

          // Ball contact: strike it away (freeing it from a carrier first).
          const ball = ctx.world.ball
          if (!slide.hit && ball.z < AIR.pickupMaxZ &&
              Math.hypot(thing.x - ball.x, thing.y - ball.y) < P.radius + SL.reach) {
            let victim = null
            if (ball.owner) {
              if (ball.owner !== thing) victim = ball.owner
              ball.owner.hasBall = false
              ball.owner = null
            }
            ball.vx = slide.dirX * SL.ballStrikePower
            ball.vy = slide.dirY * SL.ballStrikePower
            ball.lastTouchedTeam = thing.team
            ball.lastKicker = null
            ball.stealImmunityT = 0
            ball.pressure = null
            ball.noPickupBy = { thing, t: 0.3 }   // slider can't instantly regrab
            slide.hit = true
            ctx.events.emit('tackle', { by: thing, hit: true, victim })
          }

          // Body contact: flatten ANY upright player in the path (friendly
          // fire included — sliding through your own man is on you).
          for (const p of ctx.world.players) {
            if (p === thing || p.alive === false) continue
            if (p.downT > 0 || p.slide || p.downImmuneT > 0) continue
            if (Math.hypot(thing.x - p.x, thing.y - p.y) >= P.radius * 2 + 2) continue
            p.downT = SL.knockdownT
            p.downImmuneT = SL.knockdownT + SL.downImmunity
            // Belt-and-braces: a flattened carrier drops the ball even if
            // the ball-contact strike above somehow missed it.
            if (p.hasBall) {
              p.hasBall = false
              if (ball.owner === p) ball.owner = null
            }
          }

          if (slide.t >= SL.duration) {
            slide.phase = 'recover'
            slide.t = 0
            slide.recover = slide.hit ? SL.recoverHit : SL.recoverMiss
            if (!slide.hit) ctx.events.emit('tackle', { by: thing, hit: false })
          }
          return
        }

        // 'recover': flat on the turf, immobile, then back up.
        slide.t += dt
        if (slide.t >= slide.recover) thing.slide = null
      },
    }
  }
})()
