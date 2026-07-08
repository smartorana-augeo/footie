;(function () {
  'use strict'

  /**
   * Goalie brain, both teams. The goalie lives in the penalty box: parked
   * just off the goal line, tracking the ball across the goal mouth (the
   * spec's "follow the ball" transposed to the horizontal field — y follows
   * ball y, x stays near the line). A free ball inside the box gets chased
   * and claimed (saves are the possession pickup — goalies catch any speed);
   * once holding it, the goalie waits a beat and clears upfield toward the
   * most open teammate.
   */
  const helpers = window.Footie.behaviors.helpers
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)
  const dist  = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

  window.Footie.behaviors.implementations.aiGoalie = function aiGoalie() {
    return {
      update(thing, ctx, dt) {
        if (ctx.world.freeze) return
        const world = ctx.world
        const F     = ctx.field
        const ball  = world.ball
        const K     = ctx.tuning.kick

        const ownX  = F.ownGoalX(thing.team)
        const dir   = Math.sign(F.attackGoalX(thing.team) - ownX)   // into the pitch
        const box   = F.penaltyBox
        const mouth = F.goalMouth

        if (!thing.ai.clearT) thing.ai.clearT = 0

        // Holding the ball: pause, then boot it up the pitch.
        if (thing.hasBall) {
          thing.moveTarget = { x: ownX + dir * 10, y: F.center.y }
          thing.ai.clearT += dt
          if (thing.ai.clearT >= ctx.tuning.ai.goalieClearDelay && thing.kickCooldown <= 0) {
            const mates = world.players.filter(p =>
              p.team === thing.team && p !== thing && !p.isGoalie)
            // Clear to whoever has the most breathing room, weighted upfield.
            const openness = p => Math.min(...world.players
              .filter(q => q.team !== thing.team)
              .map(q => dist(p, q))) + (p.x - thing.x) * dir * 0.3
            const pick = mates.reduce((a, b) => (openness(a) > openness(b) ? a : b))
            helpers.kick(ctx, thing, pick.x + dir * 20, pick.y, K.shotPower * 0.85)
            thing.ai.clearT = 0
          }
          return
        }
        thing.ai.clearT = 0

        // Free ball in our box: go get it.
        const ballInBox = !ball.owner && F.inPenaltyBox(thing.team, ball.x, ball.y)
        if (ballInBox) {
          thing.moveTarget = {
            x: thing.team === 'player'
              ? clamp(ball.x, F.rect.x, F.rect.x + box.depth)
              : clamp(ball.x, F.rect.x + F.rect.w - box.depth, F.rect.x + F.rect.w),
            y: clamp(ball.y, box.top, box.bottom),
          }
          return
        }

        // Guard: hug the line, shadow the ball across the mouth.
        thing.moveTarget = {
          x: ownX + dir * 6,
          y: clamp(ball.y, mouth.top + 6, mouth.bottom - 6),
        }
      },
    }
  }
})()
