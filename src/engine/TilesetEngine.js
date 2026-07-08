;(function () {
  'use strict'

  /**
   * Tileset atlas loader + sprite blitter (Canvas 2D drawImage — no GPU pipeline).
   *
   * Driven by a tilesetDef:
   *   { src: 'assets/....png' | null, tileW, tileH,
   *     sprites: { name: [col, row, cols?, rows?]      // tile units, or
   *                name: { px: [x, y, w, h] } } }      // exact pixel rect
   *
   * Pixel rects matter when art doesn't fill its tile — blitting the whole
   * tile drags in transparent padding and slivers of neighbouring art.
   *
   * `src: null` means "no art": `ready` stays false and shape painters keep
   * drawing placeholders. Image loading works over file:// too (unlike fetch).
   */
  class TilesetEngine {
    /** @param {object} tilesetDef */
    constructor(tilesetDef) {
      this._def     = tilesetDef
      this._image   = null
      this._onReady = []
      this.ready    = false

      if (tilesetDef.src) {
        const img = new Image()
        img.onload = () => {
          this._image = img
          this.ready = true
          this._onReady.forEach(fn => fn(this))
          this._onReady = []
        }
        img.onerror = () => { console.warn(`TilesetEngine: failed to load ${tilesetDef.src}`) }
        img.src = tilesetDef.src
      }
    }

    /** Runs fn once the atlas is loaded (immediately if it already is). */
    whenReady(fn) {
      if (this.ready) fn(this)
      else if (this._def.src) this._onReady.push(fn)
    }

    /**
     * Draw the named sprite with its top-left at (x, y), scaled to w×h.
     * No-op until the atlas is loaded or if the name is unknown.
     */
    draw(ctx, name, x, y, w, h) {
      if (!this.ready) return
      const region = this._def.sprites[name]
      if (!region) return
      let sx, sy, sw, sh
      if (Array.isArray(region)) {
        const [col, row, cols = 1, rows = 1] = region
        const { tileW, tileH } = this._def
        sx = col * tileW; sy = row * tileH; sw = cols * tileW; sh = rows * tileH
      } else {
        ;[sx, sy, sw, sh] = region.px
      }
      ctx.imageSmoothingEnabled = false   // crisp pixel art
      ctx.drawImage(this._image, sx, sy, sw, sh, x, y, w, h)
    }
  }

  window.Footie.engine.TilesetEngine = TilesetEngine
})()
