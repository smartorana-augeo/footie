;(function () {
  'use strict'

  /**
   * Goalie brain, both teams — four positioning states plus distribution,
   * tracked on thing.ai.gkState (debug-friendly):
   *
   *   hold-line      — default: hug the line, shadow the ball across the mouth.
   *   track          — a rival carrier threatens our box: step off the line
   *                    along the ball→goal-center line, narrowing the angle.
   *   claim          — slow, low free ball in our box: go collect it (the
   *                    pickup itself is possession's job — keepers catch
   *                    anything below goalieClaimZ).
   *   emergency-save — fast free ball heading inside our mouth: sprint to
   *                    the projected crossing point. (Simplification: no
   *                    speed burst — moveToTarget has no burst channel; a
   *                    far target already yields full arrive speed.)
   *
   * Distribution: after holding the ball goalieDistributeDelay seconds,
   * roll it short to the nearest teammate with no opponent inside
   * goalieSafeRadius (soft enough to trap on arrival); nobody safe → boot
   * the openness-weighted upfield clear.
   */
  const helpers = window.Footie.behaviors.helpers
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)
  const dist  = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

  window.Footie.behaviors.implementations.aiGoalie = function aiGoalie() {
    return {
      update(thing, ctx, dt) {
        if (ctx.world.freeze) return
        if (thing.downT > 0 || thing.frozenT > 0) return
        const world = ctx.world
        const F     = ctx.field
        const ball  = world.ball
        const AI    = ctx.tuning.ai
        const AIR   = ctx.tuning.ballAir

        const ownX  = F.ownGoalX(thing.team)
        const dir   = Math.sign(F.attackGoalX(thing.team) - ownX)   // into the pitch
        const box   = F.penaltyBox
        const mouth = F.goalMouth
        const goalCenter = { x: ownX, y: F.center.y }

        if (!thing.ai.holdT) thing.ai.holdT = 0

        // ── Distribution: holding the ball ────────────────────────────
        if (thing.hasBall) {
          thing.ai.gkState = 'distribute'
          thing.moveTarget = { x: ownX + dir * 10, y: F.center.y }
          thing.ai.holdT += dt
          if (thing.ai.holdT >= AI.goalieDistributeDelay && thing.kickCooldown <= 0) {
            const mates = world.players.filter(p =>
              p.team === thing.team && p !== thing && !p.isGoalie)
            const rivals = world.players.filter(p => p.team !== thing.team)
            // Short option: nearest teammate nobody is marking.
            const safe = mates.filter(m =>
              !rivals.some(r => dist(m, r) < AI.goalieSafeRadius))
            if (safe.length) {
              const pick = safe.reduce((a, b) => (dist(a, thing) < dist(b, thing) ? a : b))
              const lead = { x: pick.x + pick.vx * 0.25, y: pick.y + pick.vy * 0.25 }
              // Soft enough that the receiver can trap it on arrival.
              const power = Math.max(120,
                Math.min(dist(thing, lead) * 2, ctx.tuning.ball.pickupMaxSpeed - 10))
              helpers.kick(ctx, thing, lead.x, lead.y, power)
            } else {
              // Nobody safe: clear to whoever has the most breathing room,
              // weighted upfield.
              const openness = p => Math.min(...rivals.map(q => dist(p, q))) +
                (p.x - thing.x) * dir * 0.3
              const pick = mates.reduce((a, b) => (openness(a) > openness(b) ? a : b))
              helpers.kick(ctx, thing, pick.x + dir * 20, pick.y, ctx.tuning.shot.tapPower * 0.85)
            }
            thing.ai.holdT = 0
          }
          return
        }
        thing.ai.holdT = 0

        // ── Emergency save: fast ball flying at our mouth ─────────────
        const speed2d = Math.hypot(ball.vx, ball.vy)
        if (!ball.owner && speed2d >= 200 && Math.abs(ball.vx) > 1) {
          const tLine = (ownX - ball.x) / ball.vx
          if (tLine > 0 && tLine < 0.9) {
            const crossY = ball.y + ball.vy * tLine
            if (crossY > mouth.top - 10 && crossY < mouth.bottom + 10) {
              thing.ai.gkState = 'emergency-save'
              thing.moveTarget = {
                x: ownX + dir * 4,
                y: clamp(crossY, mouth.top - 10, mouth.bottom + 10),
              }
              return
            }
          }
        }

        // ── Claim: slow, low free ball in our box ─────────────────────
        // Range is capped near the GOAL box — a keeper who chases loose
        // balls across the full 44yd penalty box leaves an empty net behind.
        const gb = F.goalBox
        const ballInBox = !ball.owner && F.inPenaltyBox(thing.team, ball.x, ball.y)
        if (ballInBox && ball.z < AIR.goalieClaimZ && speed2d < 220 &&
            ball.y > gb.top - 12 && ball.y < gb.bottom + 12) {
          thing.ai.gkState = 'claim'
          const lead = { x: ball.x + ball.vx * 0.2, y: ball.y + ball.vy * 0.2 }
          thing.moveTarget = {
            x: thing.team === 'player'
              ? clamp(lead.x, F.rect.x, F.rect.x + gb.depth + 16)
              : clamp(lead.x, F.rect.x + F.rect.w - gb.depth - 16, F.rect.x + F.rect.w),
            y: clamp(lead.y, gb.top - 12, gb.bottom + 12),
          }
          return
        }

        // ── Track: rival carrier bearing down on our goal ─────────────
        const owner = ball.owner
        if (owner && owner.team !== thing.team &&
            Math.abs(owner.x - ownX) < box.depth * 1.5) {
          thing.ai.gkState = 'track'
          // Step out along the ball→goal-center line to narrow the angle —
          // conservatively: a keeper far off his line loses to any shot around
          // him (pickup radius is small and shots cross in a couple of ticks).
          const bx = ball.x - goalCenter.x
          const by = ball.y - goalCenter.y
          const bd = Math.hypot(bx, by) || 1
          const depth = Math.min(bd * 0.15, box.depth * 0.25)
          thing.moveTarget = {
            x: goalCenter.x + (bx / bd) * depth,
            y: clamp(goalCenter.y + (by / bd) * depth, mouth.top - 8, mouth.bottom + 8),
          }
          return
        }

        // ── Hold line (default) ───────────────────────────────────────
        thing.ai.gkState = 'hold-line'
        thing.moveTarget = {
          x: ownX + dir * 6,
          y: clamp(ball.y, mouth.top + 6, mouth.bottom - 6),
        }
      },
    }
  }
})()
