;(function () {
  'use strict'

  /**
   * Canvas 2D render engine — strictly getContext('2d'); no WebGL/WebGPU anywhere.
   *
   * The world is a fixed-size pixel-art plane (worldW × worldH art px) drawn
   * through one integer zoom, centered/letterboxed in the window. Fixed
   * camera — the whole stadium fits the viewport.
   *
   * Knows nothing about game types: every visual is produced by a painter
   * registered by `visual.kind`. Painters receive the tileset + sprite-sheet
   * engines so composite looks blit art themselves and fall back to shapes
   * while images load. Things are painted sorted by foot y so the slight
   * top-down perspective reads correctly.
   */
  class RenderEngine {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {{worldW: number, worldH: number, painters: Record<string, Function>,
     *          background?: Function, tileset?: object, sheets?: object,
     *          letterbox?: string, maxZoom?: number}} opts
     */
    constructor(canvas, { worldW, worldH, painters, background = null, tileset = null, sheets = null, letterbox = '#0e1a10', maxZoom = 4 }) {
      this.canvas      = canvas
      this.ctx         = canvas.getContext('2d')
      this.worldW      = worldW
      this.worldH      = worldH
      this._painters   = painters
      this._background = background
      this._tileset    = tileset
      this._sheets     = sheets
      this._letterbox  = letterbox
      this._maxZoom    = maxZoom
      this.zoom        = 1
      this.offsetX     = 0
      this.offsetY     = 0
      this._resize()
      this._ro = new ResizeObserver(() => this._resize())
      this._ro.observe(canvas)
    }

    resize() { this._resize() }

    _resize() {
      const dpr = window.devicePixelRatio || 1
      const w   = this.canvas.offsetWidth
      const h   = this.canvas.offsetHeight
      this.canvas.width  = Math.round(w * dpr)
      this.canvas.height = Math.round(h * dpr)
      this._dpr = dpr
      this.W = w
      this.H = h
      // Integer zoom keeps 16px tiles crisp; fall back to 1 on tiny windows.
      this.zoom    = Math.max(1, Math.min(this._maxZoom, Math.floor(Math.min(w / this.worldW, h / this.worldH))))
      this.offsetX = Math.round((w - this.worldW * this.zoom) / 2)
      this.offsetY = Math.round((h - this.worldH * this.zoom) / 2)
    }

    /** CSS pixel coords (e.g. pointer clientX/Y over a fullscreen canvas) → world art px. */
    toWorld(clientX, clientY) {
      return {
        x: (clientX - this.offsetX) / this.zoom,
        y: (clientY - this.offsetY) / this.zoom,
      }
    }

    /**
     * @param {{things: Iterable<object>, overlay?: Function}} scene
     * Things are y-sorted by their world y (feet). `overlay` paints world-space
     * effects above everything (e.g. aim hints).
     */
    render(scene) {
      const ctx = this.ctx
      ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0)
      ctx.fillStyle = this._letterbox
      ctx.fillRect(0, 0, this.W, this.H)
      ctx.translate(this.offsetX, this.offsetY)
      ctx.scale(this.zoom, this.zoom)
      ctx.imageSmoothingEnabled = false

      const view = { W: this.worldW, H: this.worldH, zoom: this.zoom }
      if (this._background) this._background(ctx, view, this._tileset)

      const sorted = [...scene.things].sort((a, b) => a.y - b.y)
      for (const thing of sorted) {
        if (thing.alive === false) continue
        const painter = this._painters[thing.def.visual.kind]
        if (painter) painter(ctx, thing, view, { tileset: this._tileset, sheets: this._sheets })
      }
      if (scene.overlay) scene.overlay(ctx, view)
    }
  }

  window.Footie.engine.RenderEngine = RenderEngine
})()
