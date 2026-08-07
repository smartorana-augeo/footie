;(function () {
  'use strict'

  /**
   * Free-ball physics: 2.5D height (z/vz with gravity + bounces), friction,
   * curve, speed cap, light bounces off the touchlines, and goal detection.
   *
   * The ball can only cross a goal line through the goal mouth — anywhere
   * else on the line it bounces — so the arcade game never needs throw-ins
   * or corners. A goal fires once the ball is fully across the line
   * (center + radius) AND below crossbar height: above the bar an invisible
   * wall bounces it back exactly like a non-mouth goal-line hit. That's
   * arcade fiction — it keeps lobs in play and preserves the no-corners
   * design.
   *
   * pierceT (Screamer star power) exempts the ball from the ground-speed
   * cap; the starPower behavior owns ticking pierceT, we only respect it.
   * frozenT (Flat-Footed) suspends integration entirely — starPower thaws.
   */
  window.Footie.behaviors.implementations.ballPhysics = function ballPhysics() {
    return {
      update(ball, ctx, dt) {
        if (ball.frozenT > 0) return   // Flat-Footed statue — starPower ticks/thaws it
        if (ball.owner || ctx.world.freeze) return
        const B     = ctx.tuning.ball
        const AIR   = ctx.tuning.ballAir
        const rect  = ctx.field.rect
        const mouth = ctx.field.goalMouth

        // ── Height: gravity, landing, bounces ──────────────────────────
        if (ball.z > 0 || ball.vz !== 0) {
          ball.vz -= AIR.gravity * dt
          ball.z  += ball.vz * dt
          if (ball.z <= 0) {
            ball.z = 0
            if (Math.abs(ball.vz) > AIR.bounceKill) {
              ball.vz = -ball.vz * AIR.bounceZ
              ball.vx *= AIR.bounceGroundFriction
              ball.vy *= AIR.bounceGroundFriction
            } else {
              ball.vz = 0
            }
          }
        }
        const grounded = ball.z <= 0 && ball.vz === 0

        // Friction is defined per 60Hz frame; keep it framerate-independent.
        // Airborne balls barely slow horizontally.
        const f = Math.pow(grounded ? B.friction : AIR.airFrictionPerFrame, dt * 60)
        ball.vx *= f
        ball.vy *= f

        // ── Curve: perpendicular accel that bleeds off over the flight ──
        let speed = Math.hypot(ball.vx, ball.vy)
        if (Math.abs(ball.curve) > 1) {
          if (speed > 20) {
            const nx = ball.vx / speed
            const ny = ball.vy / speed
            ball.vx += -ny * ball.curve * dt
            ball.vy +=  nx * ball.curve * dt
          }
          ball.curve *= Math.pow(AIR.curveDecayPerFrame, dt * 60)
          if (Math.abs(ball.curve) <= 1) ball.curve = 0
        }

        // Ground-speed cap — skipped while piercing (a Screamer flies uncapped).
        speed = Math.hypot(ball.vx, ball.vy)
        if (ball.pierceT <= 0 && speed > B.maxSpeed) {
          ball.vx *= B.maxSpeed / speed
          ball.vy *= B.maxSpeed / speed
        }
        if (grounded && speed < 2) { ball.vx = 0; ball.vy = 0 }

        ball.x += ball.vx * dt
        ball.y += ball.vy * dt

        const r = B.radius

        // Touchlines (top/bottom): light bounce.
        if (ball.y < rect.y + r)          { ball.y = rect.y + r;          ball.vy = Math.abs(ball.vy) * B.bounce }
        if (ball.y > rect.y + rect.h - r) { ball.y = rect.y + rect.h - r; ball.vy = -Math.abs(ball.vy) * B.bounce }

        // Goal lines (left/right): pass through the mouth below the bar,
        // bounce elsewhere (including the invisible wall above the crossbar).
        const inMouth  = ball.y > mouth.top + r && ball.y < mouth.bottom - r
        const canScore = inMouth && ball.z <= AIR.crossbarZ
        const leftLine  = rect.x
        const rightLine = rect.x + rect.w

        if (ball.x < leftLine + r) {
          if (canScore) {
            if (ball.x < leftLine - r) ctx.events.emit('goal', { scoringTeam: 'enemy', goal: 'left' })
          } else {
            ball.x = leftLine + r
            ball.vx = Math.abs(ball.vx) * B.bounce
          }
        } else if (ball.x > rightLine - r) {
          if (canScore) {
            if (ball.x > rightLine + r) ctx.events.emit('goal', { scoringTeam: 'player', goal: 'right' })
          } else {
            ball.x = rightLine - r
            ball.vx = -Math.abs(ball.vx) * B.bounce
          }
        }

        // Net back-stop so a scored ball doesn't fly off into the stands.
        const depth = ctx.field.goalDepth
        if (ball.x < leftLine - depth)  { ball.x = leftLine - depth;  ball.vx = 0; ball.vy *= 0.5 }
        if (ball.x > rightLine + depth) { ball.x = rightLine + depth; ball.vx = 0; ball.vy *= 0.5 }
      },
    }
  }
})()
