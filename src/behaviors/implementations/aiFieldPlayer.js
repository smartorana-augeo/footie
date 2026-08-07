;(function () {
  'use strict'

  /**
   * The tactical brain for every uncontrolled field player, both teams.
   *
   * Team roles (BallChaser / Cutoff / Receiver / Defender / Support /
   * WideSupport) are re-assigned every AI_ROLE_RECALCULATE_INTERVAL — not
   * every frame — to avoid jitter; the first teammate to tick past the
   * interval recalculates for the whole team via world.tactics.
   *
   * Per frame each player resolves a move target:
   *   formation anchor (+ ball influence) ← baseline
   *   role override (chase / intercept / cut off / mark / cover)
   *   small avoidance offset so teammates don't crowd.
   *
   * Ball carriers instead run the decision loop from the spec: shoot when
   * in range with an open lane, pass when pressured, otherwise dribble at
   * goal (with a little weave so it looks alive). Enemy decisions use the
   * difficulty's reaction delay / aim noise; player-team AI uses a fixed
   * snappy profile and prefers passing back to the controlled player.
   */
  const helpers = window.Footie.behaviors.helpers
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)
  const dist  = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

  /** Distance from point p to segment a→b — for shot/pass lane checks. */
  function segmentDist(p, a, b) {
    const abx = b.x - a.x, aby = b.y - a.y
    const len2 = abx * abx + aby * aby
    if (len2 === 0) return dist(p, a)
    let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2
    t = clamp(t, 0, 1)
    return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t))
  }

  function laneClear(ctx, from, to, team) {
    const lane = ctx.tuning.ai.laneWidth
    return !ctx.world.players.some(p =>
      p.team !== team && !p.isGoalie && segmentDist(p, from, to) < lane)
  }

  // ── Team role assignment (shared via world.tactics) ─────────────────────

  function assignRoles(ctx, team) {
    const world = ctx.world
    const ball  = world.ball
    const AI    = ctx.tuning.ai
    const mates = world.players.filter(p =>
      p.team === team && !p.isGoalie && !p.isControlled && p.alive !== false &&
      !(p.downT > 0) && !(p.frozenT > 0) && !p.slide)   // bodies on the turf hold no role
    if (mates.length === 0) return

    const owner          = ball.owner
    const teamHasBall    = owner && owner.team === team
    const rivalHasBall   = owner && owner.team !== team
    const ballSpeed      = Math.hypot(ball.vx, ball.vy)
    const passInFlight   = !owner && ballSpeed > AI.receiverBallSpeedMin && ball.lastTouchedTeam === team

    const unassigned = new Set(mates)
    const take = (thing, role) => { thing.aiRole = role; unassigned.delete(thing) }
    const nearest = (to, pool = [...unassigned]) =>
      pool.reduce((a, b) => (dist(a, to) < dist(b, to) ? a : b))

    // Receiver: a pass from our team is in flight — nearest teammate meets it.
    if (passInFlight && unassigned.size) take(nearest(ball), 'Receiver')

    // Chasing only matters when we don't have the ball.
    if (!teamHasBall && unassigned.size) {
      take(nearest(rivalHasBall ? owner : ball), 'BallChaser')
      if (rivalHasBall && unassigned.size) take(nearest(owner), 'Cutoff')
    }

    // Deepest remaining player covers the goal.
    if (unassigned.size) {
      const ownX = ctx.field.ownGoalX(team)
      take(nearest({ x: ownX, y: ctx.field.center.y }), 'Defender')
    }

    // The rest support — wide if their roster slot is a wide lane.
    for (const m of unassigned) m.aiRole = m.wide ? 'WideSupport' : 'Support'
  }

  function ensureTactics(ctx, team) {
    const world = ctx.world
    const slot  = world.tactics[team]
    if (world.clock - slot.lastCalc < ctx.tuning.ai.roleRecalculateInterval) return
    slot.lastCalc = world.clock
    assignRoles(ctx, team)
  }

  // ── Per-role positioning ────────────────────────────────────────────────

  function formationAnchor(ctx, thing) {
    const world = ctx.world
    const F     = ctx.field
    const FORMATIONS = window.Footie.defs.FORMATIONS
    // The player team plays its chosen shape + Alt-cycled mode; the enemy
    // always plays the default shape in balanced (by design — see docs).
    const shape = thing.team === 'player' ? world.formationShape : FORMATIONS.defaultShape
    const mode  = thing.team === 'player' ? world.formation : 'balanced'
    const table = FORMATIONS.tables[shape]?.[mode]?.[thing.role]
    if (!table) return { x: F.center.x, y: F.center.y }

    const owner       = world.ball.owner
    const teamHasBall = owner ? owner.team === thing.team : world.ball.lastTouchedTeam === thing.team
    const base        = teamHasBall ? table.poss : table.def
    const anchor      = F.normFor(thing.team, base.x, base.y)

    // Ball influence: the anchor slides toward the ball, weighted per role.
    anchor.x += table.pull.x * (world.ball.x - F.center.x)
    anchor.y += table.pull.y * (world.ball.y - F.center.y)
    const rect = F.rect
    anchor.x = clamp(anchor.x, rect.x + 8, rect.x + rect.w - 8)
    anchor.y = clamp(anchor.y, rect.y + 8, rect.y + rect.h - 8)
    return anchor
  }

  function interceptPoint(ctx, thing) {
    const ball = ctx.world.ball
    const AIR  = ctx.tuning.ballAir
    const rect = ctx.field.rect
    // High ball: run to where it will LAND (time-to-ground from z/vz/gravity)
    // instead of chasing a point it will sail over.
    if (ball.z > AIR.pickupMaxZ) {
      const g = AIR.gravity
      const t = (ball.vz + Math.sqrt(ball.vz * ball.vz + 2 * g * ball.z)) / g
      return {
        x: clamp(ball.x + ball.vx * t, rect.x, rect.x + rect.w),
        y: clamp(ball.y + ball.vy * t, rect.y, rect.y + rect.h),
      }
    }
    const maxSpeed = ctx.tuning.player.maxSpeed
    // Two-pass predictive intercept: aim at where the ball will be by the
    // time we can get there.
    let p = { x: ball.x, y: ball.y }
    for (let i = 0; i < 2; i++) {
      const t = dist(thing, p) / maxSpeed
      p = { x: ball.x + ball.vx * t * 0.9, y: ball.y + ball.vy * t * 0.9 }
    }
    return { x: clamp(p.x, rect.x, rect.x + rect.w), y: clamp(p.y, rect.y, rect.y + rect.h) }
  }

  function markTarget(ctx, thing) {
    // Defending support: mark the most dangerous open rival (ahead of the
    // ball, toward our goal); stand between them and the goal.
    const world = ctx.world
    const ownX  = ctx.field.ownGoalX(thing.team)
    const dir   = Math.sign(ctx.field.attackGoalX(thing.team) - ownX)   // our attack direction
    const rivals = world.players.filter(p =>
      p.team !== thing.team && !p.isGoalie && p !== world.ball.owner &&
      Math.sign(world.ball.x - p.x) === dir)   // rival is goal-side of the ball
    if (rivals.length === 0) return null
    const mark = rivals.reduce((a, b) => (dist(a, thing) < dist(b, thing) ? a : b))
    return { x: mark.x + (ownX - mark.x) * 0.15, y: mark.y }
  }

  function roleTarget(ctx, thing) {
    const world = ctx.world
    const ball  = world.ball
    const owner = ball.owner
    const F     = ctx.field
    const rivalHasBall = owner && owner.team !== thing.team

    switch (thing.aiRole) {
      case 'BallChaser':
        return rivalHasBall ? { x: owner.x, y: owner.y } : { x: ball.x, y: ball.y }
      case 'Receiver':
        return interceptPoint(ctx, thing)
      case 'Cutoff': {
        if (!rivalHasBall) return null
        const gx = F.ownGoalX(thing.team)
        return { x: owner.x + (gx - owner.x) * 0.25, y: owner.y + (F.center.y - owner.y) * 0.1 }
      }
      case 'Defender': {
        const gx = F.ownGoalX(thing.team)
        const gy = F.center.y
        return {
          x: ball.x + (gx - ball.x) * 0.65,
          y: gy + (ball.y - gy) * 0.5,
        }
      }
      case 'Support':
      case 'WideSupport': {
        if (rivalHasBall) return markTarget(ctx, thing)
        return null   // formation anchor already does the job
      }
      default:
        return null
    }
  }

  function avoidTeammates(ctx, thing, target) {
    for (const p of ctx.world.players) {
      if (p === thing || p.team !== thing.team) continue
      const d = dist(p, thing)
      if (d > 0 && d < 18) {
        target.x += ((thing.x - p.x) / d) * (18 - d) * 0.6
        target.y += ((thing.y - p.y) / d) * (18 - d) * 0.6
      }
    }
    return target
  }

  // ── Ball-carrier decision loop ──────────────────────────────────────────

  function carrierUpdate(thing, ctx, dt) {
    const world = ctx.world
    const F     = ctx.field
    const AI    = ctx.tuning.ai
    const SHOT  = ctx.tuning.shot
    const PASS  = ctx.tuning.pass
    // Player-team AI plays a fixed snappy profile; the enemy uses difficulty.
    const prof = thing.team === 'enemy'
      ? ctx.difficulty
      : { reactionDelay: 0.22, aimNoise: 8, passBias: 1.2 }

    const goal = { x: F.attackGoalX(thing.team), y: F.center.y }

    // Keep moving toward goal (with a light weave) while deciding.
    const weave = Math.sin(world.clock * 2.2 + thing.ai.weavePhase) * 16
    thing.moveTarget = {
      x: goal.x,
      y: clamp(goal.y + weave + (thing.y - goal.y) * 0.3, F.rect.y + 10, F.rect.y + F.rect.h - 10),
    }

    thing.ai.passCooldown -= dt
    thing.ai.decisionT -= dt
    if (thing.ai.decisionT > 0 || thing.kickCooldown > 0) return
    thing.ai.decisionT = prof.reactionDelay

    // 1. Shoot: in range with an open lane.
    const mouth = F.goalMouth
    const shotY = clamp(thing.y, mouth.top + 8, mouth.bottom - 8) + (Math.random() * 2 - 1) * prof.aimNoise
    if (dist(thing, goal) < AI.shotRange && laneClear(ctx, thing, { x: goal.x, y: shotY }, thing.team)) {
      // A touch of loft so AI shots read like shots (still under the bar).
      helpers.kick(ctx, thing, goal.x + Math.sign(goal.x - thing.x) * 4, shotY, SHOT.tapPower, { vz: 12 })
      return
    }

    // 2. Pass when pressured and someone useful is open.
    const pressured = world.players.some(p =>
      p.team !== thing.team && dist(p, thing) < AI.pressureRadius)
    if (pressured && thing.ai.passCooldown <= 0) {
      const dir = Math.sign(goal.x - thing.x)
      const options = world.players.filter(p =>
        p.team === thing.team && p !== thing && !p.isGoalie &&
        laneClear(ctx, thing, p, thing.team) &&
        ((p.x - thing.x) * dir > -20))   // never pass badly backwards
      if (options.length) {
        // Player-team AI loves finding the human; otherwise the most advanced option.
        const pick =
          (thing.team === 'player' && options.find(p => p.isControlled)) ||
          options.reduce((a, b) => ((a.x - thing.x) * dir > (b.x - thing.x) * dir ? a : b))
        if (Math.random() < 0.55 * prof.passBias + 0.3) {
          const lead = { x: pick.x + pick.vx * 0.25, y: pick.y + pick.vy * 0.25 }
          const power = clamp(dist(thing, lead) * 1.2, PASS.powerMin, PASS.powerMax)
          helpers.kick(ctx, thing, lead.x, lead.y, power)
          thing.ai.passCooldown = AI.passCooldown
          return
        }
      }
    }

    // 3. Dribble on — already steering at goal; dodge the nearest presser.
    const presser = world.players
      .filter(p => p.team !== thing.team && dist(p, thing) < 26)
      .sort((a, b) => dist(a, thing) - dist(b, thing))[0]
    if (presser) {
      const away = Math.sign(thing.y - presser.y) || (Math.random() < 0.5 ? -1 : 1)
      thing.moveTarget.y = clamp(thing.y + away * 30, F.rect.y + 10, F.rect.y + F.rect.h - 10)
    }
  }

  // ── Slide attempts (BallChaser only) ────────────────────────────────────

  function maybeSlide(thing, ctx) {
    const SL    = ctx.tuning.slide
    const owner = ctx.world.ball.owner
    if (!owner || owner.team === thing.team) return
    const d = dist(thing, owner)
    if (d <= 0 || d > SL.aiRange) return
    const tx = (owner.x - thing.x) / d
    const ty = (owner.y - thing.y) / d
    if (thing.vx * tx + thing.vy * ty <= 0) return                          // must be closing
    if ((thing.faceX ?? 1) * tx + (thing.faceY ?? 0) * ty <= 0.85) return   // must be aligned
    // Throttle: at most one roll of the dice per second, even on a "no".
    thing.ai.slideCooldownT = 1
    // Difficulty shapes the ENEMY only — the player's AI teammates keep a
    // fixed profile (easy must not switch off YOUR defenders' tackles).
    const aggression = thing.team === 'enemy' ? ctx.difficulty.slideAggression : 1.0
    if (Math.random() >= SL.aiChance * aggression) return
    if (helpers.startSlide(thing, ctx)) thing.ai.slideCooldownT = SL.aiCooldown
  }

  // ── The behavior ────────────────────────────────────────────────────────

  window.Footie.behaviors.implementations.aiFieldPlayer = function aiFieldPlayer() {
    return {
      update(thing, ctx, dt) {
        if (thing.isControlled || ctx.world.freeze) return
        if (thing.downT > 0 || thing.frozenT > 0 || thing.slide) return
        ensureTactics(ctx, thing.team)

        if (thing.ai.slideCooldownT > 0) thing.ai.slideCooldownT -= dt

        if (thing.hasBall) { carrierUpdate(thing, ctx, dt) ; return }

        const target = roleTarget(ctx, thing) ?? formationAnchor(ctx, thing)
        thing.moveTarget = avoidTeammates(ctx, thing, target)

        if (thing.aiRole === 'BallChaser' && thing.ai.slideCooldownT <= 0)
          maybeSlide(thing, ctx)
      },
    }
  }
})()
