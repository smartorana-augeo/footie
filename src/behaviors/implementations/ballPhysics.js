;(function () {
  'use strict'

  /**
   * Free-ball physics: friction, speed cap, light bounces off the
   * touchlines, and goal detection. The ball can only cross a goal line
   * through the goal mouth — anywhere else on the line it bounces — so the
   * arcade game never needs throw-ins or corners. A goal fires once the
   * ball is fully across the line (center + radius), and the match FSM
   * takes over (freeze, celebrate, reset).
   */
  window.Footie.behaviors.implementations.ballPhysics = function ballPhysics() {
    return {
      update(ball, ctx, dt) {
        if (ball.owner || ctx.world.freeze) return
        const B     = ctx.tuning.ball
        const rect  = ctx.field.rect
        const mouth = ctx.field.goalMouth

        // Friction is defined per 60Hz frame; keep it framerate-independent.
        const f = Math.pow(B.friction, dt * 60)
        ball.vx *= f
        ball.vy *= f
        const speed = Math.hypot(ball.vx, ball.vy)
        if (speed > B.maxSpeed) {
          ball.vx *= B.maxSpeed / speed
          ball.vy *= B.maxSpeed / speed
        }
        if (speed < 2) { ball.vx = 0; ball.vy = 0 }

        ball.x += ball.vx * dt
        ball.y += ball.vy * dt

        const r = B.radius

        // Touchlines (top/bottom): light bounce.
        if (ball.y < rect.y + r)          { ball.y = rect.y + r;          ball.vy = Math.abs(ball.vy) * B.bounce }
        if (ball.y > rect.y + rect.h - r) { ball.y = rect.y + rect.h - r; ball.vy = -Math.abs(ball.vy) * B.bounce }

        // Goal lines (left/right): pass through the mouth, bounce elsewhere.
        const inMouth = ball.y > mouth.top + r && ball.y < mouth.bottom - r
        const leftLine  = rect.x
        const rightLine = rect.x + rect.w

        if (ball.x < leftLine + r) {
          if (inMouth) {
            if (ball.x < leftLine - r) ctx.events.emit('goal', { scoringTeam: 'enemy', goal: 'left' })
          } else {
            ball.x = leftLine + r
            ball.vx = Math.abs(ball.vx) * B.bounce
          }
        } else if (ball.x > rightLine - r) {
          if (inMouth) {
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
