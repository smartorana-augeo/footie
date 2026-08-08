;(function () {
  'use strict'

  /**
   * World-space gameplay overlay — the "make every mechanic visually clear"
   * layer: pass cones, the precise-shot trajectory preview, knock-on
   * chevrons and slide-tackle telegraphs. Drawn through RenderEngine's
   * `scene.overlay` hook, so everything here is in world coordinates under
   * the camera transform (and clipped to the view window). Ground shapes
   * only, translucent, strictly Canvas 2D.
   *
   * Star Power FX (game/StarFx.js) composes into the same hook — this
   * painter calls it last so effects sit above the aim helpers.
   */
  const TAU = Math.PI * 2

  function paintPassCone(ctx, world, defs) {
    const j = world.control.j
    const p = world.controlled
    if (!j || !j.aim || !p) return
    const P = defs.TUNING.pass
    const half = P.coneHalfAngleDeg * Math.PI / 180
    const base = Math.atan2(j.aim.y, j.aim.x)
    const radius = P.coneRange * (0.45 + 0.55 * Math.min(1, j.t / P.holdChargeTime))

    ctx.save()
    ctx.globalAlpha = 0.18
    ctx.fillStyle = '#eaf6d9'
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    ctx.arc(p.x, p.y, radius, base - half, base + half)
    ctx.closePath()
    ctx.fill()
    ctx.restore()

    if (j.target && j.target.ref) {
      const m = j.target.ref
      ctx.save()
      ctx.globalAlpha = 0.8
      ctx.strokeStyle = '#f4b942'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.ellipse(m.x, m.y + 1, 9, 4, 0, 0, TAU)
      ctx.stroke()
      ctx.restore()
    }
  }

  function paintShotPreview(ctx, world) {
    const k = world.control.shot
    const pts = world.control.indicator
    if (!k || !k.precise || !pts || pts.length === 0) return
    ctx.save()
    ctx.globalAlpha = 0.5 + 0.4 * (k.charge ?? 0)
    ctx.fillStyle = '#ffffff'
    // Square "pixels", snapped to whole world px — matches the 16px tile art
    // (smooth anti-aliased dots would read as a different rendering language).
    for (let i = 0; i < pts.length; i += 2) {
      const pt = pts[i]
      const s = pt.z > 20 ? 3 : 2            // higher flight = fatter pixel
      ctx.fillRect(Math.round(pt.x) - 1, Math.round(pt.y - pt.z * 0.9) - 1, s, s)
    }
    // Landing marker at the end of the preview.
    const last = pts[pts.length - 1]
    ctx.strokeStyle = '#f4b942'
    ctx.lineWidth = 1
    ctx.strokeRect(Math.round(last.x) - 3 + 0.5, Math.round(last.y) - 2 + 0.5, 6, 4)
    ctx.restore()
  }

  function paintKnockOnHint(ctx, world) {
    const p = world.controlled
    if (!p || !p.sprinting || world.ball.owner !== p) return
    ctx.save()
    ctx.globalAlpha = 0.5
    ctx.strokeStyle = '#eaf6d9'
    ctx.lineWidth = 1
    for (let i = 1; i <= 3; i++) {
      const cx = p.x + (p.faceX ?? 1) * (12 + i * 8)
      const cy = p.y + (p.faceY ?? 0) * (12 + i * 8)
      const px = -(p.faceY ?? 0), py = p.faceX ?? 1
      ctx.beginPath()
      ctx.moveTo(cx - px * 3 - (p.faceX ?? 1) * 3, cy - py * 3 - (p.faceY ?? 0) * 3)
      ctx.lineTo(cx, cy)
      ctx.lineTo(cx + px * 3 - (p.faceX ?? 1) * 3, cy + py * 3 - (p.faceY ?? 0) * 3)
      ctx.stroke()
    }
    ctx.restore()
  }

  function paintSlideTelegraphs(ctx, world, defs) {
    for (const p of world.players) {
      if (!p.slide || p.slide.phase !== 'sliding') continue
      const S = defs.TUNING.slide
      const remaining = Math.max(0, S.duration - p.slide.t) * S.speed
      ctx.save()
      ctx.globalAlpha = 0.35
      ctx.strokeStyle = p.team === 'player' ? '#ff8a7e' : '#7ee4dd'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(p.x, p.y + 1)
      ctx.lineTo(p.x + p.slide.dirX * remaining, p.y + p.slide.dirY * remaining + 1)
      ctx.stroke()
      ctx.restore()
    }
  }

  window.Footie.game.paintOverlay = function paintOverlay(ctx, view, world, defs) {
    if (!world || world.freeze) {
      // Frozen states still show Star FX (celebrations, thaw rings).
      if (window.Footie.game.paintStarFx && world) window.Footie.game.paintStarFx(ctx, world, defs)
      return
    }
    paintPassCone(ctx, world, defs)
    paintShotPreview(ctx, world)
    paintKnockOnHint(ctx, world)
    paintSlideTelegraphs(ctx, world, defs)
    if (window.Footie.game.paintStarFx) window.Footie.game.paintStarFx(ctx, world, defs)
  }
})()
