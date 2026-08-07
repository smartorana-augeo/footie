;(function () {
  'use strict'

  /**
   * Ball ownership: pickups, pokes and steals. Runs on the ball, before
   * physics.
   *
   * Pickup (free ball): any upright player within BALL_PICKUP_RADIUS claims
   * it — controlled player first, then closest — as long as the ball is slow
   * enough to trap (goalies catch anything; that's the "save") and low
   * enough (outfielders below pickupMaxZ, keepers below goalieClaimZ). The
   * kicker can't regrab their own kick for a beat. A pickup that completes
   * a teammate's kick emits 'pass-completed' with how many opponents the
   * pass line bypassed (Star Power meter food).
   *
   * Poke (owned ball): a rival square in FRONT of the carrier, right on the
   * exposed ball, toes it loose — no possession transfer, the ball squirts
   * away from the carrier. Emits 'poke'.
   *
   * Steal (owned ball): no tackle button. An opponent inside STEAL_RADIUS
   * who is right on the ball takes it outright; otherwise their presence
   * accumulates pressure and the carrier coughs it up after STEAL_TIME
   * (the controlled player resists longer). A fresh owner gets a moment of
   * immunity so possession doesn't ping-pong.
   *
   * Downed / frozen / sliding players neither steal nor pick up — a sliding
   * player wins the ball via slideTackle's strike, not a soft pickup.
   */
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
  const upright = p => !(p.downT > 0) && !(p.frozenT > 0) && !p.slide

  /** Perpendicular distance from p to segment a→b, or Infinity when p's
   *  projection falls outside the segment (strictly inside counts). */
  function laneDist(p, ax, ay, bx, by) {
    const abx = bx - ax, aby = by - ay
    const len2 = abx * abx + aby * aby
    if (len2 === 0) return Infinity
    const t = ((p.x - ax) * abx + (p.y - ay) * aby) / len2
    if (t <= 0 || t >= 1) return Infinity
    return Math.hypot(p.x - (ax + abx * t), p.y - (ay + aby * t))
  }

  window.Footie.behaviors.implementations.possession = function possession() {
    const transfer = (ball, from, to, ctx) => {
      if (from) from.hasBall = false
      ball.owner = to
      to.hasBall = true
      ball.lastTouchedTeam = to.team
      ball.stealImmunityT  = ctx.tuning.steal.stolenImmunity
      ball.pressure = null
      // The ball is trapped: kill any flight state, and clear the pass
      // bookkeeping so a dribbled-then-lost ball can't credit a stale pass.
      ball.z = 0
      ball.vz = 0
      ball.curve = 0
      ball.pierceT = 0
      ball.lastKicker = null
      ctx.events.emit('possession-changed', { from, to })
    }

    return {
      update(ball, ctx, dt) {
        // Timers tick even during freezes so stale locks don't survive resets.
        if (ball.noPickupBy && (ball.noPickupBy.t -= dt) <= 0) ball.noPickupBy = null
        if (ball.stealImmunityT > 0) ball.stealImmunityT -= dt
        if (ctx.world.freeze) return

        const S   = ctx.tuning.steal
        const B   = ctx.tuning.ball
        const AIR = ctx.tuning.ballAir
        const P   = ctx.tuning.poke

        if (ball.owner) {
          const owner = ball.owner
          const rivals = ctx.world.players.filter(p =>
            p.team !== owner.team && p.alive !== false && upright(p) &&
            dist(p, owner) < S.radius + ctx.tuning.player.radius)

          if (rivals.length === 0) { ball.pressure = null; return }
          if (ball.stealImmunityT > 0) return

          // Poke: a rival approaching from the FRONT toes the exposed ball
          // loose (dribble holds it ahead of the owner, so frontal rivals
          // are right on it). No possession transfer — the ball squirts away.
          const nearest = rivals.reduce((a, b) => (dist(a, owner) < dist(b, owner) ? a : b))
          if (dist(nearest, owner) < P.radius && dist(nearest, ball) < P.radius) {
            let fx = owner.faceX ?? (owner.flipX ? -1 : 1)
            let fy = owner.faceY ?? 0
            const fd = Math.hypot(fx, fy) || 1
            let tx = nearest.x - owner.x
            let ty = nearest.y - owner.y
            const td = Math.hypot(tx, ty) || 1
            const frontal = (fx / fd) * (tx / td) + (fy / fd) * (ty / td) >
              Math.cos(P.alignDeg * Math.PI / 180)
            if (frontal) {
              owner.hasBall = false
              ball.owner = null
              // Knock it loose away from the POKER, not along the carrier's
              // facing — a retreating defender poked near his own goal must
              // not have the ball toed into his own net.
              let ax = ball.x - nearest.x
              let ay = ball.y - nearest.y
              const ad = Math.hypot(ax, ay)
              if (ad < 0.001) { ax = -tx / td; ay = -ty / td } else { ax /= ad; ay /= ad }
              ball.vx = ax * P.speed
              ball.vy = ay * P.speed
              ball.lastTouchedTeam = nearest.team
              ball.lastKicker = null
              ball.stealImmunityT = 0
              ball.pressure = null
              ctx.events.emit('poke', { by: nearest, from: owner })
              return
            }
          }

          // Outright steal: a rival standing on the (reachable) ball itself.
          const onBall = rivals.find(p => dist(p, ball) < B.radius + 3)
          if (onBall && ball.z < AIR.pickupMaxZ) { transfer(ball, owner, onBall, ctx); return }

          // Otherwise: sustained pressure pops the ball loose.
          const presser = nearest
          if (!ball.pressure || ball.pressure.by !== presser) ball.pressure = { by: presser, t: 0 }
          ball.pressure.t += dt
          const limit = owner.isControlled ? S.controlledTime : S.time
          if (ball.pressure.t >= limit) transfer(ball, owner, presser, ctx)
          return
        }

        // Free ball: who can claim it?
        const speed = Math.hypot(ball.vx, ball.vy)
        const candidates = ctx.world.players.filter(p => {
          if (p.alive === false || !upright(p)) return false
          if (ball.noPickupBy && ball.noPickupBy.thing === p) return false
          if (dist(p, ball) >= B.pickupRadius) return false
          if (!(p.isGoalie ? ball.z < AIR.goalieClaimZ : ball.z < AIR.pickupMaxZ)) return false
          return p.isGoalie || speed < B.pickupMaxSpeed
        })
        if (candidates.length === 0) return

        const winner =
          candidates.find(p => p.isControlled) ??
          candidates.reduce((a, b) => (dist(a, ball) < dist(b, ball) ? a : b))

        // Pass bookkeeping BEFORE transfer clears it.
        const kicker = ball.lastKicker
        const fromX = ball.kickFromX
        const fromY = ball.kickFromY
        const pickX = ball.x
        const pickY = ball.y
        transfer(ball, null, winner, ctx)

        // A teammate trapping the kicked ball = a completed pass. `bypassed`
        // counts opposing outfielders the pass line cut through — the Star
        // Power meter pays more for line-breaking balls.
        if (kicker && winner.team === kicker.team && winner !== kicker) {
          const laneW = window.Footie.defs.STAR.meter.bypassLaneWidth
          const bypassed = ctx.world.players.filter(p =>
            p.team !== kicker.team && !p.isGoalie &&
            laneDist(p, fromX, fromY, pickX, pickY) < laneW).length
          ctx.events.emit('pass-completed', { from: kicker, to: winner, bypassed })
        }
      },
    }
  }
})()
