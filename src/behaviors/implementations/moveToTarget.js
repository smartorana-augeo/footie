;(function () {
  'use strict'

  /**
   * Shared locomotion for every player: accelerate toward `thing.moveTarget`,
   * arrive smoothly (no teleporting, no orbiting), stop inside the stop
   * radius, and never leave the playable field. The controlled player gets
   * the spec's responsiveness multipliers; the enemy team gets the
   * difficulty speed multiplier.
   */
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)

  window.Footie.behaviors.implementations.moveToTarget = function moveToTarget() {
    return {
      update(thing, ctx, dt) {
        const P = ctx.tuning.player
        if (ctx.world.freeze) { thing.vx = 0; thing.vy = 0; return }

        let maxSpeed = P.maxSpeed
        let accel    = P.acceleration
        if (thing.isControlled) {
          maxSpeed *= P.controlled.speedMultiplier
          accel    *= P.controlled.accelerationMultiplier
        }
        if (thing.team === 'enemy') maxSpeed *= ctx.difficulty.speedMultiplier

        const t = thing.moveTarget
        let desiredX = 0
        let desiredY = 0
        if (t) {
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
      },
    }
  }
})()
