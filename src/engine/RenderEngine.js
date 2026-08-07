;(function () {
  'use strict'

  /**
   * Canvas 2D render engine — strictly getContext('2d'); no WebGL/WebGPU anywhere.
   *
   * The world is a fixed-size pixel-art plane (worldW × worldH art px) seen
   * through a view window (viewW × viewH art px) drawn at one integer zoom,
   * centered/letterboxed in the canvas. A camera (camX/camY, world px of the
   * window's top-left) pans that window across the world; when the view is
   * the whole world (the default), the camera is inert and this behaves as
   * the original fixed-camera engine.
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
     * @param {{worldW: number, worldH: number, viewW?: number, viewH?: number,
     *          painters: Record<string, Function>,
     *          background?: Function, tileset?: object, sheets?: object,
     *          letterbox?: string, maxZoom?: number}} opts
     */
    constructor(canvas, { worldW, worldH, viewW = worldW, viewH = worldH, painters, background = null, tileset = null, sheets = null, letterbox = '#0e1a10', maxZoom = 4 }) {
      this.canvas      = canvas
      this.ctx         = canvas.getContext('2d')
      this.worldW      = worldW
      this.worldH      = worldH
      this.viewW       = viewW
      this.viewH       = viewH
      this._painters   = painters
      this._background = background
      this._tileset    = tileset
      this._sheets     = sheets
      this._letterbox  = letterbox
      this._maxZoom    = maxZoom
      this.zoom        = 1
      this.offsetX     = 0
      this.offsetY     = 0
      this.camX        = 0
      this.camY        = 0
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
      // Sized to the VIEW window, not the world, so a world bigger than the
      // view scrolls instead of shrinking.
      this.zoom    = Math.max(1, Math.min(this._maxZoom, Math.floor(Math.min(w / this.viewW, h / this.viewH))))
      this.offsetX = Math.round((w - this.viewW * this.zoom) / 2)
      this.offsetY = Math.round((h - this.viewH * this.zoom) / 2)
    }

    /**
     * Point the camera window at (x, y) world px, clamped so the window never
     * leaves the world. camX/camY stay floats (smooth lerped pans); rounding
     * to device px happens once, in render()'s translate.
     */
    setCamera(x, y) {
      this.camX = Math.max(0, Math.min(this.worldW - this.viewW, x))
      this.camY = Math.max(0, Math.min(this.worldH - this.viewH, y))
    }

    /** World-px center of the current camera window. */
    cameraCenter() {
      return { x: this.camX + this.viewW / 2, y: this.camY + this.viewH / 2 }
    }

    /**
     * Pointer clientX/Y → world art px. Subtracts the canvas's own bounding-rect
     * offset first: on the standalone page the canvas fills the viewport
     * (rect.left/top are always 0, so this is a no-op there), but an embedding
     * host places the canvas anywhere on the page — without this, every click
     * would be off by however far the canvas sits from the viewport origin.
     * Adding camX/camY maps through the camera, so pointer input needs no
     * knowledge of scrolling.
     */
    toWorld(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect()
      return {
        x: (clientX - rect.left - this.offsetX) / this.zoom + this.camX,
        y: (clientY - rect.top - this.offsetY) / this.zoom + this.camY,
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

      // Clip to the view window: with the world larger than the view, painters
      // would otherwise bleed into the letterbox margins.
      ctx.save()
      ctx.beginPath()
      ctx.rect(this.offsetX, this.offsetY, this.viewW * this.zoom, this.viewH * this.zoom)
      ctx.clip()

      // Round the TRANSLATE to whole device px (not camX/camY themselves):
      // sub-pixel translates shimmer pixel art, but rounding the camera would
      // make slow pans chunky at low zoom.
      ctx.translate(
        Math.round(this.offsetX - this.camX * this.zoom),
        Math.round(this.offsetY - this.camY * this.zoom),
      )
      ctx.scale(this.zoom, this.zoom)
      ctx.imageSmoothingEnabled = false

      const view = {
        W: this.viewW, H: this.viewH,
        worldW: this.worldW, worldH: this.worldH,
        zoom: this.zoom, camX: this.camX, camY: this.camY,
      }
      if (this._background) this._background(ctx, view, this._tileset)

      const sorted = [...scene.things].sort((a, b) => a.y - b.y)
      for (const thing of sorted) {
        if (thing.alive === false) continue
        const painter = this._painters[thing.def.visual.kind]
        if (painter) painter(ctx, thing, view, { tileset: this._tileset, sheets: this._sheets })
      }
      if (scene.overlay) scene.overlay(ctx, view)
      ctx.restore()
    }
  }

  window.Footie.engine.RenderEngine = RenderEngine
})()
