;(function () {
  'use strict'

  /**
   * Star Power effects painter — world-space, composed by overlayPainter at
   * the end of the overlay pass. Reads `world.star` (fx queue + active
   * effects + the Ghost Run aim state); pure Canvas 2D in the game's pixel
   * language: 1px pixel-aligned strokes and square particle "pixels", same
   * as the field markings — no gradients, no smooth hi-res shapes.
   */
  const TAU = Math.PI * 2

  const px = v => Math.round(v)

  /** 1px ground ring (the same visual family as the controlled-player ring). */
  function groundRing(ctx, x, y, rx, ry, color, alpha) {
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.ellipse(px(x) + 0.5, px(y) + 0.5, rx, ry, 0, 0, TAU)
    ctx.stroke()
    ctx.restore()
  }

  function paintScreamerAura(ctx, world, clock) {
    for (const team of ['player', 'enemy']) {
      const active = world.star.active[team]
      if (!active || active.id !== 'screamer') continue
      const carrier = world.ball.owner && world.ball.owner.team === team ? world.ball.owner : active.activator
      if (!carrier) continue
      // Pulsing gold aura — the visible half of the "loud charge-up" telegraph.
      const pulse = 1 + 0.25 * Math.sin(clock * 10)
      groundRing(ctx, carrier.x, carrier.y + 1, 9 * pulse, 4 * pulse, '#f4b942', 0.9)
      groundRing(ctx, carrier.x, carrier.y + 1, 12 * pulse, 5.5 * pulse, '#f4b942', 0.35)
    }
  }

  function paintFirstTouch(ctx, world) {
    for (const team of ['player', 'enemy']) {
      const active = world.star.active[team]
      if (!active || active.id !== 'firstTouch') continue
      const a = active.activator
      const b = world.ball
      if (b.owner) continue
      // Pull ticks: short 1px dashes marching from the ball toward the feet.
      ctx.save()
      ctx.globalAlpha = 0.7
      ctx.strokeStyle = '#eaf6d9'
      ctx.lineWidth = 1
      const dx = a.x - b.x, dy = a.y - b.y
      const d = Math.hypot(dx, dy) || 1
      for (let i = 1; i <= 3; i++) {
        const t0 = (i * 0.25) % 1
        const x0 = b.x + dx * t0, y0 = b.y + dy * t0
        ctx.beginPath()
        ctx.moveTo(px(x0) + 0.5, px(y0) + 0.5)
        ctx.lineTo(px(x0 + (dx / d) * 5) + 0.5, px(y0 + (dy / d) * 5) + 0.5)
        ctx.stroke()
      }
      ctx.restore()
      groundRing(ctx, a.x, a.y + 1, 7, 3, '#eaf6d9', 0.6)
    }
  }

  function paintGhostAim(ctx, world) {
    const aimState = world.star.ghostAim
    const me = world.controlled
    if (!aimState || !me || !aimState.landing) return
    const L = aimState.landing
    // Dashed 1px aim line, pixel-stepped.
    ctx.save()
    ctx.globalAlpha = 0.8
    ctx.fillStyle = '#ffffff'
    const dx = L.x - me.x, dy = L.y - me.y
    const d = Math.hypot(dx, dy) || 1
    for (let s = 8; s < d; s += 8) {
      ctx.fillRect(px(me.x + (dx / d) * s) - 1, px(me.y + (dy / d) * s) - 1, 2, 2)
    }
    ctx.restore()
    // Landing marker recomputed live, so the goal-box clamp is visible while aiming.
    groundRing(ctx, L.x, L.y + 1, 8, 3.5, '#f4b942', 0.9)
  }

  function paintFxQueue(ctx, world, defs) {
    const PALETTE = window.Footie.things.PALETTE
    for (const fx of world.star.fx) {
      if (fx.kind === 'ghostTrail') {
        // After-image at the teleport origin: translucent team-color
        // silhouette, honest to the game's shape-fallback style.
        const alpha = Math.max(0, fx.t / defs.STAR.powers.ghostRun.trailSeconds) * 0.5
        ctx.save()
        ctx.globalAlpha = alpha
        ctx.fillStyle = fx.team === 'player' ? PALETTE.red : PALETTE.teal
        ctx.fillRect(px(fx.x) - 4, px(fx.y) - 12, 8, 12)
        ctx.fillStyle = PALETTE.skin
        ctx.fillRect(px(fx.x) - 3, px(fx.y) - 18, 6, 6)
        ctx.restore()
      } else if (fx.kind === 'freezeRing') {
        // Expanding ring snap-frozen in the pixel grid.
        const progress = 1 - fx.t / 0.4
        const r = fx.r * (0.3 + 0.7 * progress)
        groundRing(ctx, fx.x, fx.y + 1, r, r * 0.45, '#9fd8ff', 0.9 * (1 - progress) + 0.1)
      }
    }
  }

  function paintFrozenTints(ctx, world) {
    // Icy overlay square on every frozen victim (statue cue).
    ctx.save()
    ctx.globalAlpha = 0.35
    ctx.fillStyle = '#9fd8ff'
    for (const p of world.players) {
      if (p.frozenT > 0) ctx.fillRect(px(p.x) - 5, px(p.y) - 19, 10, 20)
    }
    const b = world.ball
    if (b.frozenT > 0) ctx.fillRect(px(b.x) - 4, px(b.y - (b.z ?? 0) * 0.9) - 4, 8, 8)
    ctx.restore()
  }

  window.Footie.game.paintStarFx = function paintStarFx(ctx, world, defs) {
    if (!world.star) return
    paintScreamerAura(ctx, world, world.clock)
    paintFirstTouch(ctx, world)
    paintGhostAim(ctx, world)
    paintFxQueue(ctx, world, defs)
    paintFrozenTints(ctx, world)
  }
})()
