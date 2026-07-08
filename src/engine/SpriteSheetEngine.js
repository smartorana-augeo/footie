;(function () {
  'use strict'

  /**
   * Loader/blitter for the many separate animation strip PNGs (player anims,
   * audience, ball). Each sheet is a horizontal strip of fixed-size cells;
   * frame count is derived from the image width on load, so strips of any
   * length (idle 4, victory 11, losing 14…) need no per-file data.
   *
   * Driven by a spriteDef:
   *   { sheets: { key: { src, cellW, cellH, anchorX, anchorY } },
   *     defaults: { cellW, cellH, anchorX, anchorY } }
   *
   * anchorX/anchorY is the point inside the cell that lands on the thing's
   * world (x, y) — for characters that's the feet baseline, so y-sorting and
   * the ground ring line up with the art.
   *
   * Canvas 2D drawImage only (no GPU); new Image() works over file://.
   */
  class SpriteSheetEngine {
    /** @param {object} spriteDef */
    constructor(spriteDef) {
      this._sheets = {}
      const defaults = spriteDef.defaults ?? {}
      for (const [key, def] of Object.entries(spriteDef.sheets)) {
        const meta = { ...defaults, ...def, image: null, frames: 1 }
        const img = new Image()
        img.onload = () => {
          meta.image  = img
          meta.frames = Math.max(1, Math.floor(img.width / meta.cellW))
        }
        img.onerror = () => { console.warn(`SpriteSheetEngine: failed to load ${meta.src}`) }
        img.src = meta.src
        this._sheets[key] = meta
      }
    }

    has(key)    { return key in this._sheets }
    ready(key)  { return !!this._sheets[key]?.image }
    frames(key) { return this._sheets[key]?.frames ?? 1 }

    /**
     * Draw one cell of the named sheet so its anchor lands at world (x, y).
     * `frame` wraps; `scale` scales the whole cell; `flipX` mirrors around
     * the anchor. No-op until the sheet's image is loaded.
     */
    draw(ctx, key, frame, x, y, { scale = 1, flipX = false } = {}) {
      const s = this._sheets[key]
      if (!s || !s.image) return
      const f  = ((frame % s.frames) + s.frames) % s.frames
      const sx = f * s.cellW
      ctx.save()
      ctx.translate(x, y)
      if (flipX) ctx.scale(-1, 1)
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(
        s.image, sx, 0, s.cellW, s.cellH,
        -s.anchorX * scale, -s.anchorY * scale, s.cellW * scale, s.cellH * scale
      )
      ctx.restore()
    }
  }

  window.Footie.engine.SpriteSheetEngine = SpriteSheetEngine
})()
