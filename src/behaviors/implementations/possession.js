;(function () {
  'use strict'

  /**
   * Ball ownership: pickups and steals. Runs on the ball, before physics.
   *
   * Pickup (free ball): any player within BALL_PICKUP_RADIUS claims it —
   * controlled player first, then closest — as long as the ball is slow
   * enough to trap (goalies catch anything; that's the "save"). The kicker
   * can't regrab their own kick for a beat.
   *
   * Steal (owned ball): no tackle button. An opponent inside STEAL_RADIUS
   * who is right on the ball takes it outright; otherwise their presence
   * accumulates pressure and the carrier coughs it up after STEAL_TIME
   * (the controlled player resists longer). A fresh owner gets a moment of
   * immunity so possession doesn't ping-pong.
   */
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

  window.Footie.behaviors.implementations.possession = function possession() {
    const transfer = (ball, from, to, ctx) => {
      if (from) from.hasBall = false
      ball.owner = to
      to.hasBall = true
      ball.lastTouchedTeam = to.team
      ball.stealImmunityT  = ctx.tuning.steal.stolenImmunity
      ball.pressure = null
      ctx.events.emit('possession-changed', { from, to })
    }

    return {
      update(ball, ctx, dt) {
        // Timers tick even during freezes so stale locks don't survive resets.
        if (ball.noPickupBy && (ball.noPickupBy.t -= dt) <= 0) ball.noPickupBy = null
        if (ball.stealImmunityT > 0) ball.stealImmunityT -= dt
        if (ctx.world.freeze) return

        const S = ctx.tuning.steal
        const B = ctx.tuning.ball

        if (ball.owner) {
          const owner = ball.owner
          const rivals = ctx.world.players.filter(p =>
            p.team !== owner.team && p.alive !== false && dist(p, owner) < S.radius + ctx.tuning.player.radius)

          if (rivals.length === 0) { ball.pressure = null; return }
          if (ball.stealImmunityT > 0) return

          // Outright steal: a rival standing on the ball itself.
          const onBall = rivals.find(p => dist(p, ball) < B.radius + 3)
          if (onBall) { transfer(ball, owner, onBall, ctx); return }

          // Otherwise: sustained pressure pops the ball loose.
          const presser = rivals.reduce((a, b) => (dist(a, owner) < dist(b, owner) ? a : b))
          if (!ball.pressure || ball.pressure.by !== presser) ball.pressure = { by: presser, t: 0 }
          ball.pressure.t += dt
          const limit = owner.isControlled ? S.controlledTime : S.time
          if (ball.pressure.t >= limit) transfer(ball, owner, presser, ctx)
          return
        }

        // Free ball: who can claim it?
        const speed = Math.hypot(ball.vx, ball.vy)
        const candidates = ctx.world.players.filter(p => {
          if (p.alive === false) return false
          if (ball.noPickupBy && ball.noPickupBy.thing === p) return false
          if (dist(p, ball) >= B.pickupRadius) return false
          return p.isGoalie || speed < B.pickupMaxSpeed
        })
        if (candidates.length === 0) return

        const winner =
          candidates.find(p => p.isControlled) ??
          candidates.reduce((a, b) => (dist(a, ball) < dist(b, ball) ? a : b))
        transfer(ball, null, winner, ctx)
      },
    }
  }
})()
