;(function () {
  'use strict'

  /**
   * Keyboard control for the human player — the whole PES-style action set:
   *
   *   WASD / arrows  move; the same vector is the AIM for every action
   *   J              with ball: pass (hold = harder); without: switch player
   *   Space          with ball: tap shot, or hold past input.holdThreshold for
   *                  the PRECISE shot (world slows, trajectory preview, lateral
   *                  aim bends the ball); without ball: aerial finish if an
   *                  airborne ball is in reach, otherwise slide tackle
   *   L              lob/chip (hold = longer)
   *   Shift          sprint; with the ball it knocks it ahead (kick-and-run)
   *   K              Star Power — owned by starPower.js, never read here
   *
   * Charge state lives in `world.control` (one controlled player at a time;
   * FootieGame clears it on switch/kickoff). Charges accrue in REAL time
   * (dt / world.timeScale) so slow motion never stretches the hold timers.
   * All aiming falls back to facing, so a standing player still acts.
   */
  const F = window.Footie
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)
  const lerp  = (a, b, t) => a + (b - a) * clamp(t, 0, 1)

  const DIR_KEYS = {
    w: [0, -1], a: [-1, 0], s: [0, 1], d: [1, 0],
    arrowup: [0, -1], arrowleft: [-1, 0], arrowdown: [0, 1], arrowright: [1, 0],
  }

  /** Held movement keys → unit vector, or null when none are down. */
  function readMoveDir(held) {
    let x = 0, y = 0
    for (const key in DIR_KEYS) {
      if (held[key]) { x += DIR_KEYS[key][0]; y += DIR_KEYS[key][1] }
    }
    if (x === 0 && y === 0) return null
    const len = Math.hypot(x, y)
    return { x: x / len, y: y / len }
  }

  function segmentDist(p, a, b) {
    const abx = b.x - a.x, aby = b.y - a.y
    const len2 = abx * abx + aby * aby
    if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
    const t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / len2, 0, 1)
    return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t))
  }

  function laneClear(ctx, from, to, team) {
    const lane = ctx.tuning.ai.laneWidth
    return !ctx.world.players.some(p =>
      p.team !== team && !p.isGoalie && segmentDist(p, from, to) < lane)
  }

  /**
   * Cone-assisted pass targeting: the best teammate inside the aim cone, or
   * null (→ pass into space). Never redirects more than the cone half-angle
   * away from what the player actually pressed.
   */
  function pickPassTarget(ctx, thing, aim) {
    const P = ctx.tuning.pass
    const coneRad = P.coneHalfAngleDeg * Math.PI / 180
    const attackSign = Math.sign(ctx.field.attackGoalX(thing.team) - ctx.field.ownGoalX(thing.team))
    let best = null
    let bestScore = -Infinity
    for (const m of ctx.world.players) {
      if (m === thing || m.team !== thing.team) continue
      if (m.downT > 0 || m.frozenT > 0) continue
      const dx = m.x - thing.x, dy = m.y - thing.y
      const dist = Math.hypot(dx, dy)
      if (dist < 8 || dist > P.coneRange) continue
      const angle = Math.acos(clamp((dx * aim.x + dy * aim.y) / dist, -1, 1))
      if (angle > coneRad) continue
      const distScore = 1 - Math.abs(dist - P.coneRange / 2) / (P.coneRange / 2)
      const forward   = (m.x - thing.x) * attackSign > 0 ? 1 : 0
      const score =
        0.5  * (1 - angle / coneRad) +
        0.25 * distScore +
        0.15 * (laneClear(ctx, thing, m, thing.team) ? 1 : 0) +
        0.10 * forward -
        (m.isGoalie ? 0.3 : 0)
      if (score > bestScore) { bestScore = score; best = m }
    }
    if (!best) return null
    // Lead a moving receiver, but never let the lead swing the pass outside
    // the cone the player aimed.
    const lead = { x: best.x + best.vx * P.leadTime, y: best.y + best.vy * P.leadTime }
    const ldx = lead.x - thing.x, ldy = lead.y - thing.y
    const ldist = Math.hypot(ldx, ldy) || 1
    const leadAngle = Math.acos(clamp((ldx * aim.x + ldy * aim.y) / ldist, -1, 1))
    if (leadAngle > coneRad) {
      const side = Math.sign(aim.x * ldy - aim.y * ldx) || 1
      const cos = Math.cos(coneRad * side), sin = Math.sin(coneRad * side)
      lead.x = thing.x + (aim.x * cos - aim.y * sin) * ldist
      lead.y = thing.y + (aim.x * sin + aim.y * cos) * ldist
    }
    return { ref: best, x: lead.x, y: lead.y }
  }

  /** Strike a FREE airborne ball (header/volley/bicycle) — kick() needs
   *  ownership, so this drives the ball directly and mirrors its bookkeeping. */
  function aerialStrike(ctx, thing, kind) {
    const T = ctx.tuning
    const ball = ctx.world.ball
    const mouth = ctx.field.goalMouth
    const tx = ctx.field.attackGoalX(thing.team)
    const ty = clamp(thing.y, mouth.top + T.shot.aimMarginY, mouth.bottom - T.shot.aimMarginY)
    const spec = {
      header:  { power: T.aerial.headerPower,  vz: -20 },   // nod it down, under the bar
      volley:  { power: T.aerial.volleyPower,  vz: 10 },
      bicycle: { power: T.aerial.bicyclePower, vz: 15 },
    }[kind]
    const dx = tx - thing.x, dy = ty - thing.y
    const len = Math.hypot(dx, dy) || 1
    ball.vx = (dx / len) * spec.power
    ball.vy = (dy / len) * spec.power
    ball.vz = spec.vz
    ball.curve = 0
    ball.lastTouchedTeam = thing.team
    ball.lastKicker = null
    ball.noPickupBy = { thing, t: T.kick.regrabDelay }
    thing.kickCooldown = T.kick.cooldown
    thing.kickAnimT = T.anim.kickDuration
    if (kind === 'bicycle') {
      // Spectacular, but you end up on the turf.
      thing.downT = T.aerial.bicycleSelfDownT
      thing.downImmuneT = thing.downT + T.slide.downImmunity
    }
    ctx.events.emit('kick', { by: thing, power: spec.power, tx, ty, vz: spec.vz, curve: 0 })
    if (spec.power >= T.shot.tapPower * 0.9) ctx.events.emit('shot-on-target', { by: thing })
  }

  /** Which aerial finish (if any) K should produce right now. */
  function aerialKind(ctx, thing) {
    const T = ctx.tuning
    const ball = ctx.world.ball
    if (ball.owner || thing.kickCooldown > 0) return null
    if (Math.hypot(ball.x - thing.x, ball.y - thing.y) > T.aerial.reach + T.player.radius) return null
    const facing = (thing.faceX ?? 1) * (ball.x - thing.x) + (thing.faceY ?? 0) * (ball.y - thing.y)
    if (ball.z >= T.aerial.headerZMin && ball.z <= T.aerial.headerZMax) {
      return facing >= 0 ? 'header' : 'bicycle'
    }
    if (ball.z >= T.aerial.volleyZMin && ball.z < T.aerial.volleyZMax) return 'volley'
    return null
  }

  /** Short flight preview for the precise-shot overlay — mirrors ballPhysics'
   *  gravity/curve integration in coarse fixed steps. */
  function simulateTrajectory(ctx, thing, aim, power, vz, curve) {
    const A = ctx.tuning.ballAir
    const pts = []
    let x = thing.x, y = thing.y, z = 2
    let vx = aim.x * power, vy = aim.y * power, zv = vz, c = curve
    const step = 0.05
    for (let i = 0; i < 20; i++) {
      const sp = Math.hypot(vx, vy) || 1
      vx += (-vy / sp) * c * step
      vy += (vx / sp) * c * step
      c *= Math.pow(A.curveDecayPerFrame, step * 60)
      zv -= A.gravity * step
      x += vx * step; y += vy * step
      z = Math.max(0, z + zv * step)
      pts.push({ x, y, z })
    }
    return pts
  }

  window.Footie.behaviors.implementations.controlInput = function controlInput() {
    return {
      update(thing, ctx, dt) {
        if (!thing.isControlled || ctx.world.freeze) return
        const T = ctx.tuning
        const world = ctx.world
        const input = ctx.input
        const control = world.control
        const ball = world.ball

        // Incapacitated: drop every charge (this also releases the precise
        // slow-mo — FootieGame reads control.shot.precise) and give no input.
        if (thing.downT > 0 || thing.frozenT > 0 || thing.slide) {
          control.j = control.shot = control.l = null
          control.indicator = null
          thing.moveDir = null
          thing.sprinting = false
          return
        }

        const dir = readMoveDir(input.held)
        const hasBall = ball.owner === thing
        const aim = dir ?? { x: thing.faceX ?? 1, y: thing.faceY ?? 0 }
        // Charges run on wall time so slow motion doesn't stretch the holds.
        const realDt = world.timeScale > 0 ? dt / world.timeScale : dt

        // Movement: the controlled player is direction-driven, never
        // target-driven — except mid-precise-shot, where the feet plant and
        // the keys become pure aim.
        thing.moveTarget = null
        thing.moveDir = control.shot?.precise ? null : dir

        // ── Shift: sprint / knock-on ─────────────────────────────────────
        thing.sprinting = !!input.held['shift']
        control.knockCd = Math.max(0, (control.knockCd ?? 0) - dt)
        if (thing.sprinting && hasBall && thing.kickCooldown <= 0 && control.knockCd <= 0) {
          // Kick-and-run: push the ball ahead and chase it. The tiny regrab
          // delay is what lets the carrier collect their own touch — and the
          // gap is a clean interception window for defenders.
          F.behaviors.helpers.kick(ctx, thing,
            thing.x + aim.x * 30, thing.y + aim.y * 30, T.knockOn.speed,
            { regrabDelay: T.knockOn.regrabDelay })
          control.knockCd = T.knockOn.interval
        }

        // ── J: pass / switch ─────────────────────────────────────────────
        if (input.pressed.includes('j')) {
          if (hasBall) control.j = { t: 0 }
          else ctx.events.emit('switch-player')
        }
        if (control.j) {
          if (!hasBall) control.j = null
          else {
            control.j.t += realDt
            control.j.target = pickPassTarget(ctx, thing, aim)   // live, for the overlay
            control.j.aim = aim
            if (input.released.includes('j') || control.j.t >= T.pass.holdChargeTime) {
              const power = lerp(T.pass.powerMin, T.pass.powerMax, control.j.t / T.pass.holdChargeTime)
              const target = control.j.target
              if (target) {
                F.behaviors.helpers.kick(ctx, thing, target.x, target.y, power)
              } else {
                // Nobody in the cone: through-ball into space along the aim.
                F.behaviors.helpers.kick(ctx, thing,
                  thing.x + aim.x * T.pass.coneRange, thing.y + aim.y * T.pass.coneRange,
                  T.pass.intoSpacePower)
              }
              control.j = null
            }
          }
        }

        // ── K: shot / precise shot / aerial finish / slide tackle ────────
        if (input.pressed.includes(' ')) {
          if (hasBall) {
            control.shot = { t: 0, precise: false, curve: 0, charge: 0, aim: { ...aim } }
          } else {
            const kind = aerialKind(ctx, thing)
            if (kind) aerialStrike(ctx, thing, kind)
            else if (F.behaviors.helpers.startSlide) F.behaviors.helpers.startSlide(thing, ctx)
          }
        }
        if (control.shot) {
          if (!hasBall) { control.shot = null; control.indicator = null }
          else {
            control.shot.t += realDt
            if (!control.shot.precise && control.shot.t >= T.input.holdThreshold) {
              control.shot.precise = true          // FootieGame slows the world off this flag
              control.shot.aim = { ...aim }        // trajectory locks to the aim at entry…
            }
            const S = T.shot.precise
            if (control.shot.precise) {
              // …and sideways input from here on bends the ball instead.
              if (dir) {
                const lateral = dir.x * -control.shot.aim.y + dir.y * control.shot.aim.x
                control.shot.curve = clamp(control.shot.curve + lateral * S.curveRate * realDt, -S.curveMax, S.curveMax)
              }
              thing.faceX = control.shot.aim.x
              thing.faceY = control.shot.aim.y
              control.shot.charge = clamp(
                (control.shot.t - T.input.holdThreshold) / (S.maxCharge - T.input.holdThreshold), 0, 1)
              control.indicator = simulateTrajectory(ctx, thing, control.shot.aim,
                lerp(S.powerMin, S.powerMax, control.shot.charge),
                lerp(S.vzMin, S.vzMax, control.shot.charge), control.shot.curve)
            }
            const autoFire = control.shot.precise && control.shot.t >= S.maxCharge
            if (input.released.includes(' ') || autoFire) {
              if (control.shot.precise) {
                F.behaviors.helpers.kick(ctx, thing,
                  thing.x + control.shot.aim.x * 100, thing.y + control.shot.aim.y * 100,
                  lerp(S.powerMin, S.powerMax, control.shot.charge),
                  { vz: lerp(S.vzMin, S.vzMax, control.shot.charge), curve: control.shot.curve })
              } else {
                // Tap shot: straight at the mouth, biased by vertical aim.
                const gx = ctx.field.attackGoalX(thing.team)
                const half = ctx.field.goalMouth.h / 2 - T.shot.aimMarginY
                const gy = ctx.field.center.y + aim.y * half
                F.behaviors.helpers.kick(ctx, thing, gx, gy, T.shot.tapPower, { vz: 10 })
              }
              control.shot = null
              control.indicator = null
            }
          }
        }

        // ── L: lob / chip ────────────────────────────────────────────────
        if (input.pressed.includes('l') && hasBall) control.l = { t: 0 }
        if (control.l) {
          if (!hasBall) control.l = null
          else {
            control.l.t += realDt
            if (input.released.includes('l') || control.l.t >= T.lob.chargeTime) {
              const c = control.l.t / T.lob.chargeTime
              F.behaviors.helpers.kick(ctx, thing,
                thing.x + aim.x * 100, thing.y + aim.y * 100,
                lerp(T.lob.powerMin, T.lob.powerMax, c),
                { vz: lerp(T.lob.vzMin, T.lob.vzMax, c) })
              control.l = null
            }
          }
        }
      },
    }
  }
})()
