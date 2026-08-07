;(function () {
  'use strict'

  /**
   * Shared kick primitive used by controlInput, aiFieldPlayer and aiGoalie:
   * releases the ball from `kicker` toward (tx, ty) at `power` px/s, stamps
   * the cooldowns/immunities that stop instant regrabs, and announces the
   * kick on the event bus (for animation/crowd/UI concerns).
   *
   * opts:
   *   vz          — initial vertical speed (lobs, lofted shots); NEVER capped.
   *   curve       — lateral curve accel (precise shots); decays in ballPhysics.
   *   regrabDelay — override the default own-kick repossession lockout.
   *
   * Ground speed is capped at ball.maxSpeed unless the ball is piercing
   * (Screamer star power) — a Screamer flies uncapped.
   *
   * Emits 'shot-on-target' when the kick is shot-strength AND its line,
   * extended to the opponent's goal line, crosses inside the goal mouth
   * (simple linear extrapolation, no z check — good enough for the meter).
   *
   * Returns false if the kicker doesn't actually own the ball.
   */
  window.Footie.behaviors.helpers.kick = function kick(ctx, kicker, tx, ty, power, opts = {}) {
    const ball   = ctx.world.ball
    const TUNING = ctx.tuning
    const { vz = 0, curve = 0, regrabDelay = TUNING.kick.regrabDelay } = opts
    if (ball.owner !== kicker) return false

    let dx = tx - kicker.x
    let dy = ty - kicker.y
    const d = Math.hypot(dx, dy)
    if (d < 0.001) {
      dx = kicker.faceX ?? (kicker.flipX ? -1 : 1)
      dy = kicker.faceY ?? 0
    } else { dx /= d; dy /= d }

    const speed = ball.pierceT > 0 ? power : Math.min(power, TUNING.ball.maxSpeed)
    ball.owner  = null
    ball.vx     = dx * speed
    ball.vy     = dy * speed
    ball.vz     = vz
    ball.curve  = curve
    ball.lastKicker = kicker
    ball.kickFromX  = kicker.x
    ball.kickFromY  = kicker.y
    ball.lastTouchedTeam = kicker.team
    ball.noPickupBy      = { thing: kicker, t: regrabDelay }
    ball.pressure        = null

    kicker.hasBall      = false
    kicker.kickCooldown = TUNING.kick.cooldown
    kicker.kickAnimT    = TUNING.anim.kickDuration

    ctx.events.emit('kick', { by: kicker, power: speed, tx, ty, vz, curve })

    // Shot-on-target detection for the Star Power meter.
    if (speed >= TUNING.shot.tapPower * 0.9 && dx !== 0) {
      const goalX = ctx.field.attackGoalX(kicker.team)
      const t = (goalX - kicker.x) / dx
      if (t > 0) {
        const crossY = kicker.y + dy * t
        const mouth  = ctx.field.goalMouth
        if (crossY > mouth.top && crossY < mouth.bottom)
          ctx.events.emit('shot-on-target', { by: kicker })
      }
    }
    return true
  }
})()
