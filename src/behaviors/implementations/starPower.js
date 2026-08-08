;(function () {
  'use strict'

  /**
   * Star Power — activation input, per-tick effect simulation, and the enemy
   * AI's usage. One instance rides the BALL (the world-scoped tick host), so
   * per-match effect state resets with the world for free. Meter ACCRUAL and
   * all presentation (slow-mo, crowd, HUD, toasts) live in FootieGame's
   * once-wired event subscriptions — this file never touches the UI.
   *
   * All state on `world.star` (see FootieGame._resetWorld):
   *   meter  { player, enemy }   0..STAR.meter.max
   *   power  { player, enemy }   chosen power ids
   *   active { player, enemy }   { id, t, activator } while an effect runs
   *   ghostAim                   { t, aim } while the human holds K aiming
   *   pendingPierce              set by FootieGame's kick handler (Screamer)
   *   threat                     { t } after a player shot-on-target (AI bait)
   *   enemyAI { checkT }         throttled enemy decision clock
   *   fx []                      { kind, t, ... } entries drained by StarFx
   */
  const F = window.Footie
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)
  const dist  = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

  function aimOf(thing) {
    const x = thing.moveDir?.x ?? thing.faceX ?? 1
    const y = thing.moveDir?.y ?? thing.faceY ?? 0
    const len = Math.hypot(x, y) || 1
    return { x: x / len, y: y / len }
  }

  /** Ghost Run landing: walk back along the aim ray until the (field-clamped)
   *  point is outside both goal boxes. Null = nowhere legal, abort unspent. */
  function ghostLanding(ctx, from, aim) {
    const P = F.defs.STAR.powers.ghostRun
    const FIELD = ctx.field
    const rect = FIELD.rect
    const inGoalBox = (x, y) => {
      const gb = FIELD.goalBox
      const m = P.goalAreaMargin
      if (y < gb.top - m || y > gb.bottom + m) return false
      return x <= rect.x + gb.depth + m || x >= rect.x + rect.w - gb.depth - m
    }
    for (let d = P.distance; d >= 0; d -= 4) {
      const x = clamp(from.x + aim.x * d, rect.x + P.fieldMargin, rect.x + rect.w - P.fieldMargin)
      const y = clamp(from.y + aim.y * d, rect.y + P.fieldMargin, rect.y + rect.h - P.fieldMargin)
      if (!inGoalBox(x, y)) return { x, y }
    }
    return null
  }

  function activate(ctx, team, id, activator) {
    const STAR = F.defs.STAR
    const star = ctx.world.star
    const P = STAR.powers[id]
    const ball = ctx.world.ball

    if (id === 'ghostRun') {
      const aim = aimOf(activator)
      const landing = ghostLanding(ctx, activator, aim)
      if (!landing) return false            // nowhere legal — keep the meter
      star.fx.push({ kind: 'ghostTrail', x: activator.x, y: activator.y,
                     team: activator.team, variant: activator.variant, t: P.trailSeconds })
      const takesBall = ball.owner === activator
      activator.x = landing.x
      activator.y = landing.y
      activator.vx = 0; activator.vy = 0
      activator.moveTarget = null
      if (takesBall) { ball.x = landing.x; ball.y = landing.y }   // dribble re-offsets next tick
      ctx.events.emit('star-teleport', { by: activator, toX: landing.x, toY: landing.y })
    } else if (id === 'flatFooted') {
      for (const p of ctx.world.players) {
        if (p.team === team || p.isGoalie) continue
        if (dist(p, activator) <= P.radius) p.frozenT = P.durationSeconds
      }
      if (!ball.owner && dist(ball, activator) <= P.radius) {
        ball.frozenT = P.durationSeconds
        ball.frozenStash = { vx: ball.vx, vy: ball.vy, airborne: ball.z > 0 }
        ball.vx = 0; ball.vy = 0
      }
      star.active[team] = { id, t: P.durationSeconds, activator }
      star.fx.push({ kind: 'freezeRing', x: activator.x, y: activator.y, r: P.radius, t: 0.4 })
    } else {
      // screamer / firstTouch: timed windows the tick below acts on.
      star.active[team] = { id, t: id === 'screamer' ? P.windowSeconds : P.durationSeconds, activator }
    }

    star.meter[team] = 0
    ctx.events.emit('star-activated', { team, power: id, activator })
    return true
  }

  function updateEffects(ctx, dt) {
    const STAR = F.defs.STAR
    const world = ctx.world
    const star = world.star
    const ball = world.ball

    // Player freeze timers (single owner — slideTackle owns downT).
    for (const p of world.players) if (p.frozenT > 0) p.frozenT = Math.max(0, p.frozenT - dt)

    // Frozen ball thaw: an airborne ball drops dead; a grounded one rolls on.
    if (ball.frozenT > 0) {
      ball.frozenT -= dt
      if (ball.frozenT <= 0) {
        ball.frozenT = 0
        const stash = ball.frozenStash
        if (stash) {
          if (stash.airborne) { ball.vx = 0; ball.vy = 0; ball.vz = 0 }
          else { ball.vx = stash.vx; ball.vy = stash.vy }
        }
        ball.frozenStash = null
      }
    }

    // Screamer: consume the pierce flag FootieGame's kick handler raised.
    if (star.pendingPierce) {
      const P = STAR.powers.screamer
      ball.vx *= P.speedMultiplier
      ball.vy *= P.speedMultiplier
      ball.pierceT = P.pierceSeconds
      star.active[star.pendingPierce.team] = null
      star.pendingPierce = null
    }
    // The piercing ball is a lawnmower: any upright outfielder in its path
    // goes down (both teams). Keepers are immune — it never auto-beats them.
    if (ball.pierceT > 0) {
      ball.pierceT = Math.max(0, ball.pierceT - dt)
      if (!ball.owner) {
        const P = STAR.powers.screamer
        for (const p of world.players) {
          if (p.isGoalie || p.downT > 0 || p.downImmuneT > 0) continue
          if (dist(p, ball) <= P.hitRadius && ball.z < ctx.tuning.ballAir.pickupMaxZ + 6) {
            p.downT = P.knockdownSeconds
            p.downImmuneT = p.downT + ctx.tuning.slide.downImmunity
            ctx.events.emit('star-knockdown', { victim: p })
          }
        }
      } else {
        ball.pierceT = 0   // possession ends the pierce — no stray lawnmower
      }
    }

    for (const team of ['player', 'enemy']) {
      const active = star.active[team]
      if (!active) continue
      active.t -= dt
      if (active.t <= 0) { star.active[team] = null; continue }
      if (active.id === 'firstTouch') {
        // Drag the LOOSE ball toward the activator; a keeper-secured (or any
        // owned) ball is beyond its reach. Bending shots comes free: shots
        // are unowned.
        const P = F.defs.STAR.powers.firstTouch
        const a = active.activator
        if (!ball.owner && ball.frozenT <= 0 && dist(ball, a) <= P.maxRange) {
          const d = dist(ball, a) || 1
          ball.vx += ((a.x - ball.x) / d) * P.pullAccel * dt
          ball.vy += ((a.y - ball.y) / d) * P.pullAccel * dt
        }
      }
    }

    if (star.threat) {
      star.threat.t -= dt
      if (star.threat.t <= 0) star.threat = null
    }
    for (let i = star.fx.length - 1; i >= 0; i--) {
      star.fx[i].t -= dt
      if (star.fx[i].t <= 0) star.fx.splice(i, 1)
    }
  }

  function humanActivation(ctx) {
    const world = ctx.world
    const star = world.star
    const STAR = F.defs.STAR
    const input = ctx.input
    const me = world.controlled
    if (!me || me.downT > 0 || me.frozenT > 0) { star.ghostAim = null; return }
    const full = star.meter.player >= STAR.meter.max
    const power = star.power.player

    if (power === 'ghostRun') {
      // Hold K to aim with the movement keys, release to blink.
      if (!star.ghostAim && full && input.pressed.includes('k')) star.ghostAim = { t: 0 }
      if (star.ghostAim) {
        if (!full) { star.ghostAim = null; return }
        star.ghostAim.t += 0   // aged below with dt-free landing preview
        star.ghostAim.aim = aimOf(me)
        star.ghostAim.landing = ghostLanding(ctx, me, star.ghostAim.aim)
        if (input.released.includes('k') || (star.ghostAim.holdT ?? 0) >= STAR.powers.ghostRun.holdMaxSeconds) {
          activate(ctx, 'player', 'ghostRun', me)
          star.ghostAim = null
        }
      }
    } else if (full && input.pressed.includes('k')) {
      activate(ctx, 'player', power, me)
    }
  }

  function enemyAI(ctx, dt) {
    const world = ctx.world
    const star = world.star
    const STAR = F.defs.STAR
    const AI = STAR.enemyAI
    star.enemyAI.checkT -= dt
    if (star.enemyAI.checkT > 0) return
    star.enemyAI.checkT = AI.checkInterval
    if (star.meter.enemy < STAR.meter.max || star.active.enemy) return

    const ball = world.ball
    const owner = ball.owner
    const FIELD = ctx.field
    const power = star.power.enemy

    if (power === 'screamer') {
      if (owner && owner.team === 'enemy' && !owner.isGoalie &&
          Math.abs(owner.x - FIELD.attackGoalX('enemy')) < ctx.tuning.ai.shotRange * AI.screamerShotRangeMult) {
        activate(ctx, 'enemy', 'screamer', owner)
      }
    } else if (power === 'firstTouch') {
      const nearest = world.players.filter(p => p.team === 'enemy' && !p.isGoalie)
        .sort((a, b) => dist(a, ball) - dist(b, ball))[0]
      const reactive = star.threat && Math.random() < AI.firstTouchReactChance
      const contested = !owner && nearest &&
        dist(nearest, ball) <= STAR.powers.firstTouch.maxRange &&
        world.players.some(p => p.team === 'player' && dist(p, ball) < dist(nearest, ball))
      if ((reactive || contested) && nearest) {
        star.threat = null
        activate(ctx, 'enemy', 'firstTouch', nearest)
      }
    } else if (power === 'ghostRun') {
      const pressured = owner && owner.team === 'enemy' && !owner.isGoalie &&
        world.players.some(p => p.team === 'player' && dist(p, owner) < ctx.tuning.ai.pressureRadius * 1.5) &&
        owner.x < FIELD.center.x   // in the enemy's attacking half
      if (pressured) activate(ctx, 'enemy', 'ghostRun', owner)
    } else if (power === 'flatFooted') {
      if (owner && owner.team === 'player' &&
          FIELD.goals.right.lineX - owner.x < AI.flatFootedPanicDist) {
        const nearest = world.players.filter(p => p.team === 'enemy' && !p.isGoalie)
          .sort((a, b) => dist(a, owner) - dist(b, owner))[0]
        if (nearest && dist(nearest, owner) <= STAR.powers.flatFooted.radius) {
          activate(ctx, 'enemy', 'flatFooted', nearest)
        }
      }
    }
  }

  window.Footie.behaviors.implementations.starPower = function starPower() {
    return {
      update(ball, ctx, dt) {
        const star = ctx.world.star
        if (!star) return                    // disabled by host config
        updateEffects(ctx, dt)
        if (ctx.world.freeze) { star.ghostAim = null; return }
        if (star.ghostAim) star.ghostAim.holdT = (star.ghostAim.holdT ?? 0) + dt
        humanActivation(ctx)
        enemyAI(ctx, dt)
      },
    }
  }
})()
