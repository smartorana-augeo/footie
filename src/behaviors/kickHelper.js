;(function () {
  'use strict'

  /**
   * Shared kick primitive used by controlInput, aiFieldPlayer and aiGoalie:
   * releases the ball from `kicker` toward (tx, ty) at `power` px/s, stamps
   * the cooldowns/immunities that stop instant regrabs, and announces the
   * kick on the event bus (for animation/crowd/UI concerns).
   * Returns false if the kicker doesn't actually own the ball.
   */
  window.Footie.behaviors.helpers.kick = function kick(ctx, kicker, tx, ty, power) {
    const ball   = ctx.world.ball
    const TUNING = ctx.tuning
    if (ball.owner !== kicker) return false

    let dx = tx - kicker.x
    let dy = ty - kicker.y
    const d = Math.hypot(dx, dy)
    if (d < 0.001) { dx = kicker.flipX ? -1 : 1; dy = 0 } else { dx /= d; dy /= d }

    const speed = Math.min(power, TUNING.ball.maxSpeed)
    ball.owner  = null
    ball.vx     = dx * speed
    ball.vy     = dy * speed
    ball.lastTouchedTeam = kicker.team
    ball.noPickupBy      = { thing: kicker, t: TUNING.kick.regrabDelay }
    ball.pressure        = null

    kicker.hasBall      = false
    kicker.kickCooldown = TUNING.kick.cooldown
    kicker.kickAnimT    = TUNING.anim.kickDuration

    ctx.events.emit('kick', { by: kicker, power: speed, tx, ty })
    return true
  }
})()
