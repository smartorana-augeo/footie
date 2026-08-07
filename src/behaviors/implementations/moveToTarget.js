;(function () {
  'use strict'

  /**
   * Shared locomotion for every player. Two steering modes:
   *   `thing.moveDir`    — a unit direction (the keyboard-controlled player);
   *                        full speed instantly, no arrive ramp.
   *   `thing.moveTarget` — a world point (all AI); accelerate toward it and
   *                        arrive smoothly (no teleporting, no orbiting).
   * Sprint (`thing.sprinting`) raises both cap and ramp-up. Also the single
   * home of facing: `faceX/faceY` follow velocity while moving and are kept
   * when standing still, so aiming/kicking always has a direction.
   *
   * Skips entirely while a slide owns the body (slideTackle moves it), and
   * dumps velocity while down or frozen — flattened players don't glide.
   */
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)

  window.Footie.behaviors.implementations.moveToTarget = function moveToTarget() {
    return {
      update(thing, ctx, dt) {
        const P = ctx.tuning.player
        if (ctx.world.freeze) { thing.vx = 0; thing.vy = 0; return }
        if (thing.slide) return
        if (thing.downT > 0 || thing.frozenT > 0) { thing.vx = 0; thing.vy = 0; return }

        let maxSpeed = P.maxSpeed
        let accel    = P.acceleration
        if (thing.isControlled) {
          maxSpeed *= P.controlled.speedMultiplier
          accel    *= P.controlled.accelerationMultiplier
        }
        if (thing.sprinting) {
          maxSpeed *= P.sprintMultiplier
          accel    *= P.sprintAccelMultiplier
        }

        let desiredX = 0
        let desiredY = 0
        const dir = thing.moveDir
        if (dir && (dir.x !== 0 || dir.y !== 0)) {
          desiredX = dir.x * maxSpeed
          desiredY = dir.y * maxSpeed
        } else if (thing.moveTarget) {
          const t = thing.moveTarget
          const dx = t.x - thing.x
          const dy = t.y - thing.y
          const dist = Math.hypot(dx, dy)
          if (dist > P.stopRadius) {
            // Arrive: full speed far out, easing down near the target.
            const speed = Math.min(maxSpeed, dist * 6)
            desiredX = (dx / dist) * speed
            desiredY = (dy / dist) * speed
          }
        }

        const maxDv = accel * dt
        const dvx = clamp(desiredX - thing.vx, -maxDv, maxDv)
        const dvy = clamp(desiredY - thing.vy, -maxDv, maxDv)
        thing.vx += dvx
        thing.vy += dvy

        const rect = ctx.field.rect
        thing.x = clamp(thing.x + thing.vx * dt, rect.x, rect.x + rect.w)
        thing.y = clamp(thing.y + thing.vy * dt, rect.y, rect.y + rect.h)

        // Facing follows real movement; retained when idle so a standing
        // player still aims somewhere sensible.
        const speed = Math.hypot(thing.vx, thing.vy)
        if (speed > 5) {
          thing.faceX = thing.vx / speed
          thing.faceY = thing.vy / speed
        }
      },
    }
  }
})()
