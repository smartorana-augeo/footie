;(function () {
  'use strict'

  /**
   * Prerenders the whole stadium — stands, barrier wall, pavement, striped
   * grass, field markings, goals — onto one offscreen canvas at boot, so
   * the per-frame background cost is a single drawImage. Rebuilt when the
   * tileset atlas finishes loading (flat-color fallback until then).
   *
   * Field markings are drawn as pixel-aligned white lines rather than
   * hand-mapping the ~30 marking tiles in the strip; at 16px tile scale the
   * result is identical to the tile art. Strictly Canvas 2D.
   */
  class StadiumBuilder {
    /** @param {{tileset: object, field: object, layout: object}} deps */
    constructor({ tileset, field, layout }) {
      this._tileset = tileset
      this._field   = field
      this._layout  = layout
      this._canvas  = document.createElement('canvas')
      this._canvas.width  = field.world.w
      this._canvas.height = field.world.h
      this._build()
      tileset.whenReady(() => this._build())
      // The render engine calls this every frame.
      this.paint = (ctx) => { ctx.drawImage(this._canvas, 0, 0) }
    }

    _build() {
      const ctx = this._canvas.getContext('2d')
      const F   = this._field
      const L   = this._layout
      const T   = this._tileset
      const W   = F.world.w
      const tiles = Math.ceil(W / 16)
      ctx.imageSmoothingEnabled = false

      // ── Bands: stands / wall / pavement / grass ─────────────────────────
      if (T.ready) {
        for (const row of L.standsRows)
          for (let c = 0; c < tiles; c++)
            T.draw(ctx, c % 2 ? 'steps' : 'stepsAlt', c * 16, row * 16, 16, 16)
        for (let c = 0; c < tiles; c++) {
          const name = c === 0 ? 'wallLeft' : c === tiles - 1 ? 'wallRight' : 'wallMid'
          T.draw(ctx, name, c * 16, L.wallRow * 16, 16, 16)
        }
        for (let c = 0; c < tiles; c++)
          T.draw(ctx, 'pavement', c * 16, L.pavementRow * 16, 16, 16)
        for (let r = L.grassFromRow; r < Math.ceil(F.world.h / 16); r++)
          for (let c = 0; c < tiles; c++) {
            const light = Math.floor(c / L.grassBandTiles) % 2 === 0
            T.draw(ctx, light ? 'grassLight' : 'grassDark', c * 16, r * 16, 16, 16)
          }
      } else {
        // Flat-color fallback, same geometry.
        ctx.fillStyle = '#6f7378'
        ctx.fillRect(0, 0, W, (L.wallRow) * 16)
        ctx.fillStyle = '#5b3a29'
        ctx.fillRect(0, L.wallRow * 16, W, 16)
        ctx.fillStyle = '#8b8f94'
        ctx.fillRect(0, L.pavementRow * 16, W, 16)
        for (let c = 0; c < tiles; c++) {
          ctx.fillStyle = Math.floor(c / L.grassBandTiles) % 2 === 0 ? '#79b043' : '#699a39'
          ctx.fillRect(c * 16, L.grassFromRow * 16, 16, F.world.h - L.grassFromRow * 16)
        }
      }

      this._paintMarkings(ctx)
      this._paintGoals(ctx)
    }

    _paintMarkings(ctx) {
      const F = this._field
      const R = F.rect
      ctx.strokeStyle = '#ffffff'
      ctx.fillStyle   = '#ffffff'
      ctx.lineWidth   = 1

      const line = (x1, y1, x2, y2) => {
        ctx.beginPath()
        ctx.moveTo(x1 + 0.5, y1 + 0.5)
        ctx.lineTo(x2 + 0.5, y2 + 0.5)
        ctx.stroke()
      }
      const box = (x, y, w, h) => ctx.strokeRect(x + 0.5, y + 0.5, w, h)

      // Touchlines + goal lines.
      box(R.x, R.y, R.w, R.h)

      // Center line, circle, spot.
      line(F.center.x, R.y, F.center.x, R.y + R.h)
      ctx.beginPath()
      ctx.arc(F.center.x + 0.5, F.center.y + 0.5, F.centerCircleRadius, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillRect(F.center.x, F.center.y, 1, 1)

      // Penalty + goal boxes, both ends.
      const pb = F.penaltyBox
      const gb = F.goalBox
      box(R.x, pb.top, pb.depth, pb.bottom - pb.top)
      box(R.x + R.w - pb.depth, pb.top, pb.depth, pb.bottom - pb.top)
      box(R.x, gb.top, gb.depth, gb.bottom - gb.top)
      box(R.x + R.w - gb.depth, gb.top, gb.depth, gb.bottom - gb.top)

      // Penalty spots.
      ctx.fillRect(R.x + pb.depth - 18, F.center.y, 1, 1)
      ctx.fillRect(R.x + R.w - pb.depth + 18, F.center.y, 1, 1)
    }

    _paintGoals(ctx) {
      const F = this._field
      const m = F.goalMouth
      const d = F.goalDepth

      const goal = (lineX, outward) => {
        const backX = lineX + outward * d
        ctx.strokeStyle = '#f2f2f2'
        ctx.lineWidth = 1
        // Net shading behind the frame.
        ctx.fillStyle = 'rgba(230, 235, 235, 0.35)'
        ctx.fillRect(Math.min(lineX, backX), m.top, d, m.h)
        // Frame: back bar + top/bottom returns.
        ctx.beginPath()
        ctx.moveTo(lineX + 0.5, m.top + 0.5)
        ctx.lineTo(backX + outward * 0.5, m.top + 0.5)
        ctx.lineTo(backX + outward * 0.5, m.bottom + 0.5)
        ctx.lineTo(lineX + 0.5, m.bottom + 0.5)
        ctx.stroke()
        // Posts read as bright pixels on the line.
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(lineX - 1, m.top - 1, 2, 3)
        ctx.fillRect(lineX - 1, m.bottom - 1, 2, 3)
      }

      goal(F.goals.left.lineX, -1)
      goal(F.goals.right.lineX, 1)
    }
  }

  window.Footie.game.StadiumBuilder = StadiumBuilder
})()
