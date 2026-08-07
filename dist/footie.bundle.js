// ---- src/namespace.js ----
/**
 * Global namespace. Classic scripts (no ES modules) so the game runs when
 * index.html is opened directly from disk (file://) — module scripts and
 * fetch() are blocked there. Load order is defined by the script tags in
 * index.html; every file assigns into this tree.
 *
 * assetBase: the absolute URL of this game's own folder, derived from THIS
 * script's own src (document.currentScript.src is always absolute, even when
 * the tag's src attribute was relative). Image/tileset paths are built from
 * this instead of bare relative strings, so they resolve correctly whether
 * this file was loaded from its own index.html (assetBase == that page's own
 * folder, a no-op) or injected by an embedding host's mount() from a
 * completely different page/origin.
 */
window.Footie = {
  assetBase: new URL('../', document.currentScript.src).href,
  engine: {},
  defs: {},
  things: {},
  behaviors: { implementations: {}, helpers: {} },
  game: {},
}

// ---- src/engine/EventBus.js ----
;(function () {
  'use strict'

  /**
   * Minimal pub/sub. Behaviors emit outcomes here ('goal', 'kick', …);
   * the composition root subscribes. Keeps behaviors ignorant of UI.
   */
  class EventBus {
    constructor() { this._handlers = new Map() }

    on(event, fn) {
      if (!this._handlers.has(event)) this._handlers.set(event, new Set())
      this._handlers.get(event).add(fn)
      return () => this._handlers.get(event)?.delete(fn)
    }

    emit(event, payload) {
      const set = this._handlers.get(event)
      if (set) for (const fn of set) fn(payload)
    }
  }

  window.Footie.engine.EventBus = EventBus
})()

// ---- src/engine/GameLoop.js ----
;(function () {
  'use strict'

  /**
   * RAF loop engine. Owns nothing but the frame cadence.
   * dt is clamped so a background tab can't teleport the simulation on resume.
   */
  class GameLoop {
    constructor({ maxDt = 0.05 } = {}) {
      this._maxDt = maxDt
      this._raf   = null
      this._tick  = null
      this._last  = 0
    }

    get running() { return this._raf !== null }

    /** @param {(dt: number, ts: number) => void} tickFn */
    start(tickFn) {
      this.stop()
      this._tick = tickFn
      this._last = performance.now()
      this._raf  = requestAnimationFrame(ts => this._frame(ts))
    }

    stop() {
      if (this._raf !== null) cancelAnimationFrame(this._raf)
      this._raf = null
    }

    _frame(ts) {
      if (this._raf === null) return
      const dt = Math.min((ts - this._last) / 1000, this._maxDt)
      this._last = ts
      this._tick(dt, ts)
      if (this._raf !== null) this._raf = requestAnimationFrame(t => this._frame(t))
    }
  }

  window.Footie.engine.GameLoop = GameLoop
})()

// ---- src/engine/GameStateMachine.js ----
;(function () {
  'use strict'

  /**
   * Generic state machine. States are registered as data:
   *   sm.register('menu', { onEnter() {}, onExit() {} })
   * Transitions run exit → enter hooks; unknown states throw early.
   */
  class GameStateMachine {
    constructor() {
      this._states  = new Map()
      this._current = null
    }

    get current() { return this._current }

    is(name) { return this._current === name }

    register(name, { onEnter = () => {}, onExit = () => {} } = {}) {
      this._states.set(name, { onEnter, onExit })
      return this
    }

    transition(name, payload) {
      const next = this._states.get(name)
      if (!next) throw new Error(`GameStateMachine: unknown state "${name}"`)
      if (this._current !== null) this._states.get(this._current).onExit(name)
      const prev = this._current
      this._current = name
      next.onEnter(payload, prev)
    }
  }

  window.Footie.engine.GameStateMachine = GameStateMachine
})()

// ---- src/engine/InputEngine.js ----
;(function () {
  'use strict'

  /**
   * Pointer + keyboard → normalized input state.
   * Pointer Events track the hovering mouse and touch drags alike;
   * pointerDown is exposed separately for press-gated actions. Screens
   * subscribe to raw keydown/pointerdown for their own transitions.
   *
   * Keyboard state is three views over the same stream, all lowercase
   * (`e.key.toLowerCase()`, so Shift+J still reads as 'j'):
   *   `pressed`  — keys pressed since the last frame (no auto-repeat), edges
   *   `released` — keys released since the last frame, edges
   *   `held`     — map of keys physically down right now
   * The game loop drains both edge arrays each tick. `held` is cleared on
   * window blur / tab-hide so Alt-Tab never strands a stuck sprint or charge.
   * Game keys (space, alt, arrows) get preventDefault so they never scroll
   * the page or poke focused buttons.
   *
   * Pointer/touch listeners attach to `surface` (defaults to `window`, i.e.
   * the standalone page's own behavior — the canvas already fills the
   * viewport there, so listening on it vs window is equivalent). An embedding
   * host passes its own canvas: pointer capture on down means a drag that
   * leaves the canvas mid-gesture (element-scoped listeners alone would miss
   * that) still delivers move/up/cancel here, while a stray click ELSEWHERE
   * on the host page (outside the widget) correctly never reaches the game —
   * unlike window-level listening, which would have treated the whole page
   * as the play surface once the canvas stopped being fullscreen.
   */
  class InputEngine {
    constructor({ blockTouchWhen = () => false, surface = window } = {}) {
      this.state = {
        pointerX: null, pointerY: null, pointerDown: false, pointerType: null,
        pressed: [], released: [], held: {},
      }

      const PREVENT = new Set([' ', 'alt', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'])

      window.addEventListener('keydown', e => {
        const key = e.key.toLowerCase()
        // Game controls: suppress menu-bar focus, page scroll, and space
        // re-activating whichever button was last focused.
        if (PREVENT.has(key)) e.preventDefault()
        if (!e.repeat) {
          this.state.pressed.push(key)
          this.state.held[key] = true
        }
      })
      window.addEventListener('keyup', e => {
        const key = e.key.toLowerCase()
        this.state.released.push(key)
        delete this.state.held[key]
      })
      // Alt-Tab / tab-hide: browsers swallow the matching keyup, which would
      // strand a held sprint or a mid-charge shot. Treat every held key as
      // released so charges resolve instead of sticking.
      const clearHeld = () => {
        for (const key of Object.keys(this.state.held)) this.state.released.push(key)
        this.state.held = {}
      }
      window.addEventListener('blur', clearHeld)
      document.addEventListener('visibilitychange', () => { if (document.hidden) clearHeld() })

      surface.addEventListener('pointermove', e => {
        this.state.pointerX = e.clientX
        this.state.pointerY = e.clientY
      })
      surface.addEventListener('pointerdown', e => {
        this.state.pointerDown = true
        this.state.pointerType = e.pointerType
        this.state.pointerX = e.clientX
        this.state.pointerY = e.clientY
        // Redirect this pointer's subsequent events to `surface` regardless of
        // where the cursor/touch physically travels — without this, a drag
        // that leaves a non-fullscreen surface would never see its own
        // pointerup/pointercancel (they'd fire on whatever element is under
        // the pointer at release, which this listener isn't attached to).
        if (typeof surface.setPointerCapture === 'function') {
          surface.setPointerCapture(e.pointerId)
        }
      })
      surface.addEventListener('pointerup', e => {
        this.state.pointerDown = false
        if (typeof surface.releasePointerCapture === 'function' && surface.hasPointerCapture?.(e.pointerId)) {
          surface.releasePointerCapture(e.pointerId)
        }
      })
      surface.addEventListener('pointercancel', e => {
        this.state.pointerDown = false
        if (typeof surface.releasePointerCapture === 'function' && surface.hasPointerCapture?.(e.pointerId)) {
          surface.releasePointerCapture(e.pointerId)
        }
      })

      // Mobile: drag control must never become page scroll / pull-to-refresh.
      // Scoped to `surface` (not document) so an embedded, non-fullscreen game
      // never blocks scrolling on the REST of the host page.
      surface.addEventListener('touchmove', e => {
        if (blockTouchWhen()) e.preventDefault()
      }, { passive: false })
    }

    onKeyDown(fn) {
      const handler = e => fn(e)
      window.addEventListener('keydown', handler)
      return () => window.removeEventListener('keydown', handler)
    }

    onPointerDown(fn) {
      const handler = e => fn(e)
      window.addEventListener('pointerdown', handler)
      return () => window.removeEventListener('pointerdown', handler)
    }
  }

  window.Footie.engine.InputEngine = InputEngine
})()

// ---- src/engine/TilesetEngine.js ----
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

// ---- src/engine/SpriteSheetEngine.js ----
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

// ---- src/engine/RenderEngine.js ----
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

// ---- src/engine/BehaviorEngine.js ----
;(function () {
  'use strict'

  /**
   * Runs every thing's attached behavior implementations each tick.
   * A behavior is anything with `update(thing, ctx, dt)`; outcomes are
   * signalled on ctx.events — behaviors never reach into UI or each other.
   */
  class BehaviorEngine {
    /**
     * @param {Iterable<object>} things
     * @param {{world: object, input: object, view: object, events: object, tuning: object}} ctx
     * @param {number} dt
     */
    update(things, ctx, dt) {
      for (const thing of things) {
        if (thing.alive === false) continue
        for (const behavior of thing.behaviors) behavior.update(thing, ctx, dt)
      }
    }
  }

  window.Footie.engine.BehaviorEngine = BehaviorEngine
})()

// ---- src/defs/tuningDefs.js ----
;(function () {
  'use strict'

  /**
   * Global gameplay tuning — pure data, straight from docs/initial.md's
   * "Recommended Constants". All speeds/distances are world art pixels
   * (16px tiles) and seconds. Never tune inside engines or behaviors.
   */
  window.Footie.defs.TUNING = {
    player: {
      radius: 5,                 // collision circle at the feet, not the 20×35 art
      maxSpeed: 90,
      acceleration: 600,
      stopRadius: 4,
      sprintMultiplier: 1.35,       // shift-held top speed boost
      sprintAccelMultiplier: 1.1,   // sprint ramps up slightly quicker too
      controlled: {              // the controlled player feels snappier, not overpowered
        speedMultiplier: 1.08,
        accelerationMultiplier: 1.15,
        stealResistanceMultiplier: 1.25,
      },
    },

    ball: {
      radius: 3,
      friction: 0.985,           // per 60Hz frame; applied as pow(friction, dt*60)
      maxSpeed: 360,             // precise-shot headroom; cap applies to ground speed only, never vz
      pickupRadius: 9,
      dribbleOffset: 7,
      pickupMaxSpeed: 190,       // faster balls can only be caught by goalies / interceptors
      bounce: 0.55,              // light touchline bounce
    },

    kick: {
      cooldown: 0.25,
      regrabDelay: 0.35,         // kicker can't instantly repossess their own kick
    },

    input: { holdThreshold: 0.18 },   // J/K/L released sooner than this = tap

    pass: {
      coneHalfAngleDeg: 25,      // teammates inside this cone of the facing dir are pass targets
      coneRange: 260,            // farthest teammate a tap-pass will consider
      powerMin: 170,             // tap pass — reaches the next formation line
      powerMax: 250,             // fully-held pass — switches play across lines
      holdChargeTime: 0.45,      // hold this long for powerMax
      leadTime: 0.3,             // aim this far ahead of a moving receiver
      intoSpacePower: 200,       // no target in the cone → through-ball into space at this pace
    },

    shot: {
      tapPower: 270,             // quick tap — threatens from around the 18-yard-box edge
      aimMarginY: 6,             // tap shots aim inside the posts by this much
      precise: {                 // hold K: slow-mo aimed shot with charge + curve
        maxCharge: 0.6,          // full power/loft after holding this long
        timeScale: 0.45,         // world slows to this while aiming
        powerMin: 250,
        powerMax: 340,
        vzMin: 15,               // minimum loft — skims the turf
        vzMax: 85,               // full-charge loft — still under the crossbar in range
        curveRate: 260,          // lateral curve accel per second of steering input
        curveMax: 220,           // curve accel cap so screamers stay aimable
      },
    },

    lob: {
      chargeTime: 0.5,           // hold L this long for max distance
      powerMin: 150,             // tap lob — chip over one defender
      powerMax: 230,             // full lob — reaches the far post from midfield
      vzMin: 110,                // even a tap clears standing players
      vzMax: 155,                // full lob hangs long enough to run onto
    },

    ballAir: {
      gravity: 300,              // vz decay per second while airborne
      bounceZ: 0.5,              // vz kept per ground bounce
      bounceKill: 40,            // bounces slower than this stick to the turf
      airFrictionPerFrame: 0.999,     // airborne balls barely slow horizontally
      bounceGroundFriction: 0.85,     // ground speed lost on each bounce
      curveDecayPerFrame: 0.98,       // curve accel bleeds off over the flight
      crossbarZ: 21,             // 8 ft at 8 px/yd — shots above this bounce, never score
      pickupMaxZ: 12,            // outfielders can only trap below this
      goalieClaimZ: 26,          // keepers claim crosses up to here
    },

    aerial: {
      reach: 12,                 // horizontal radius to meet an airborne ball
      headerZMin: 12,            // ball height band for headers…
      headerZMax: 26,
      volleyZMin: 5,             // …and the lower band for volleys
      volleyZMax: 12,
      headerPower: 240,          // headers redirect, they don't rocket
      volleyPower: 310,          // volleys are near-shot pace
      bicyclePower: 330,         // bicycle kicks hit hardest…
      bicycleSelfDownT: 0.6,     // …but leave the kicker on the ground this long
    },

    knockOn: {
      speed: 210,                // above ball.pickupMaxSpeed: the touch genuinely ESCAPES —
                                 // nobody (carrier or defender) can trap it until it slows
      regrabDelay: 0.12,         // carrier's own no-touch window after the push
      interval: 0.45,            // seconds between touches while knocking on
    },

    slide: {
      speed: 150,                // lunge speed during the slide
      duration: 0.3,             // slide travel time
      reach: 10,                 // ball/carrier contact radius while sliding
      ballStrikePower: 165,      // a clean slide punts the ball away this hard —
                                 // under the keeper's 220 claim gate, so a slide
                                 // TOWARD a goal is savable, not a guaranteed score
      recoverMiss: 0.65,         // whiffed slide — long get-up
      recoverHit: 0.35,          // won the ball — quick get-up
      knockdownT: 0.8,           // carrier hit by a slide stays down this long
      downImmunity: 0.35,        // just-up players can't be flattened again yet
      screamerKnockdownT: 1.1,   // Screamer star shots keep victims down longer
      aiCooldown: 4,             // seconds between AI slide attempts
      aiRange: 22,               // AI only slides at carriers inside this
      aiChance: 0.15,            // per-attempt probability (× difficulty slideAggression)
    },

    poke: {
      radius: 12,                // ball must be this close to poke
      reach: 8,                  // poke nudges the ball this far ahead
      alignDeg: 35,              // must be facing within this of the ball
      speed: 120,                // poked-ball speed
    },

    steal: {
      radius: 8,
      time: 0.30,                // AI carriers lose the ball after this much pressure
      controlledTime: 0.45,      // the controlled player gets longer
      stolenImmunity: 0.5,       // fresh owner can't be re-stolen from immediately
    },

    match: {
      timeSeconds: 270,          // 4:30 regulation
      suddenDeathEnabled: true,  // now means golden-goal overtime
      goldenGoalSeconds: 30,     // overtime length — first goal wins
      goalPauseSeconds: 0.75,
      resetCountdownSeconds: 1.25,
      kickoffStepSeconds: 0.7,   // per "3", "2", "1", "Go" step
    },

    camera: {
      lerpPerSecond: 5,          // ball-chase smoothing; higher = tighter follow
    },

    ai: {
      roleRecalculateInterval: 0.25,
      passCooldown: 1.0,
      shotRange: 120,            // ~15 yd — shoot from around the box edge
      pressureRadius: 16,        // "I'm pressured" distance for carriers
      laneWidth: 12,             // opponents within this of the shot line block it
      goalieDistributeDelay: 1.25,   // keeper holds a claimed ball this long, then distributes
      goalieSafeRadius: 40,      // no opponents inside this → keeper rolls it out short
      receiverBallSpeedMin: 40,  // slower balls aren't treated as passes in flight
    },

    anim: {
      runThreshold: 8,           // px/s
      kickDuration: 0.375,
      fps: { idle: 6, run: 10, kick: 24, victory: 8, losing: 6, cheer: 8, boo: 8 },
    },

    difficulties: {
      // speedMultiplier deprecated: difficulty must not change movement speed —
      // kept for saved-config compat, no longer read.
      easy:   { speedMultiplier: 1.0, reactionDelay: 0.45, aimNoise: 22, passBias: 0.5, slideAggression: 0 },
      normal: { speedMultiplier: 1.0, reactionDelay: 0.25, aimNoise: 12, passBias: 1.0, slideAggression: 1.0 },
      hard:   { speedMultiplier: 1.0, reactionDelay: 0.08, aimNoise: 5,  passBias: 1.5, slideAggression: 1.6 },
    },
    defaultDifficulty: 'normal',

    difficultyKey: 'footie-difficulty',
  }
})()

// ---- src/defs/starDefs.js ----
;(function () {
  'use strict'

  /**
   * Star Power system — the crowd IS the meter. All params are pure data,
   * consumed by behaviors/implementations/starPower.js + FootieGame +
   * animateFan + StarFx. Meter fills from good play; a full crowd erupts
   * and Space spends it on the equipped power.
   */
  window.Footie.defs.STAR = {
    enabledDefault: true,
    defaultPower: 'screamer',
    order: ['screamer', 'firstTouch', 'ghostRun', 'flatFooted'],
    storageKey: 'footie-star-power',

    powers: {
      // Screamer: next hard shot within the window pierces and flattens field players.
      screamer:   { windowSeconds: 5, minShotPower: 220, speedMultiplier: 1.25,
                    knockdownSeconds: 1.1, hitRadius: 10, pierceSeconds: 2 },
      // First Touch: drags the loose ball to the activator — even mid-shot.
      firstTouch: { durationSeconds: 1.25, pullAccel: 420, maxRange: 160 },
      // Ghost Run: hold space, aim with movement keys, release to blink 15yd
      // with the ball — never into a goal box.
      ghostRun:   { distance: 120, holdMaxSeconds: 2.0, fieldMargin: 10,
                    goalAreaMargin: 8, trailSeconds: 0.4 },
      // Flat-Footed: freezes nearby opponents and the ball for a beat.
      flatFooted: { radius: 90, durationSeconds: 0.9 },
    },

    meter: {
      max: 100,
      gains: { pass: 6, passBypass: 9, cleanTackle: 12, shotOnTarget: 15, goal: 22, concede: 10 },
      bypassLaneWidth: 24,       // pass counts as "bypassing" opponents within this of its line
    },

    audience: {
      tiers: [                   // meter value → how much of the crowd is up, and how fast
        { at: 0,   fraction: 0.00, fps: 0  },
        { at: 25,  fraction: 0.15, fps: 4  },
        { at: 50,  fraction: 0.35, fps: 6  },
        { at: 75,  fraction: 0.60, fps: 8  },
        { at: 100, fraction: 1.00, fps: 10 },
      ],
      waveStaggerPerPx: 0.004,   // fans further along the stand start their wave later
      eruption: { seconds: 2.5, fps: 12 },   // full-meter / goal blowout
      rivalBoo: { seconds: 1.2 },
    },

    slowMo: {
      activation: { seconds: 0.35, scale: 0.45 },
      pass:       { seconds: 0.12, scale: 0.65 },   // subtle beat on pass release
    },

    enemyAI: {
      checkInterval: 0.5,
      screamerShotRangeMult: 1.6,     // AI shoots from further out with Screamer armed
      firstTouchReactChance: 0.6,     // chance the AI pulls a contested loose ball
      flatFootedPanicDist: 135,       // AI panic-freezes your attack inside this of goal
    },
  }
})()

// ---- src/defs/fieldDefs.js ----
;(function () {
  'use strict'

  /**
   * Field geometry — pure data, all in world art pixels (16px tiles).
   * Horizontal orientation per the sample reference: stands along the top,
   * player team defends the LEFT goal and attacks RIGHT; enemy mirrors.
   *
   * TRUE-TO-SCALE 11-a-side pitch at 8 px/yd (so 16px tile = 2 yd):
   *   pitch 115 × 74 yd → 920 × 592 px
   *   penalty box 18 yd deep × 44 yd wide, goal box 6 yd deep × 20 yd wide,
   *   penalty spot 12 yd, centre circle 10 yd radius, goal mouth 8 yd,
   *   corner arcs 1 yd — every marking derives from those yard values.
   * The world outgrows the camera window (FIELD.view, the old fixed world
   * size); RenderEngine scrolls it following the ball.
   *
   * Normalized tactical coords: x 0.0 = own (left) goal line … 1.0 = enemy
   * (right) goal line, y 0.0 = top touchline … 1.0 = bottom touchline —
   * always from the PLAYER team's perspective; enemy positions mirror x.
   */
  const PX_PER_YD = 8

  const WORLD = { w: 968, h: 720 }

  // Stadium bands (see tilesetDefs layout): stands 0..64, wall 64..80,
  // pavement 80..96, grass 96..720.
  const GRASS = { x: 0, y: 96, w: WORLD.w, h: WORLD.h - 96 }

  // Playable field (the white touchlines). Ball and players are clamped to
  // this except where the ball crosses a goal mouth. 115 × 74 yd.
  const RECT = { x: 24, y: 112, w: 115 * PX_PER_YD, h: 74 * PX_PER_YD }

  const centerY = RECT.y + RECT.h / 2          // 408
  const MOUTH_H = 8 * PX_PER_YD                // 64 — true-scale 8 yd goal

  const PENALTY_BOX_HALF_W = (44 / 2) * PX_PER_YD   // 176
  const GOAL_BOX_HALF_W    = (20 / 2) * PX_PER_YD   // 80

  const FIELD = {
    world: WORLD,
    grass: GRASS,
    rect:  RECT,
    // Camera window in world px — the old fixed world size, so the on-screen
    // zoom is unchanged; the camera pans this window across the big pitch.
    view: { w: 480, h: 312 },
    center: { x: RECT.x + RECT.w / 2, y: centerY },
    centerCircleRadius: 10 * PX_PER_YD,          // 80

    // Goal mouths sit ON the goal lines (left/right edges of rect).
    goalMouth: { top: centerY - MOUTH_H / 2, bottom: centerY + MOUTH_H / 2, h: MOUTH_H },
    goalDepth: 16,                               // net protrudes outside the field

    // Boxes, per side. Goalies live in (and are clamped to) the penalty box.
    penaltyBox: { depth: 18 * PX_PER_YD, top: centerY - PENALTY_BOX_HALF_W, bottom: centerY + PENALTY_BOX_HALF_W },
    goalBox:    { depth: 6 * PX_PER_YD,  top: centerY - GOAL_BOX_HALF_W,    bottom: centerY + GOAL_BOX_HALF_W },
    penaltySpotDist: 12 * PX_PER_YD,             // 96, from the goal line
    cornerRadius: 1 * PX_PER_YD,                 // 8

    goals: {
      left:  { lineX: RECT.x,           defendedBy: 'player', scoredBy: 'enemy'  },
      right: { lineX: RECT.x + RECT.w,  defendedBy: 'enemy',  scoredBy: 'player' },
    },
  }

  /** Player-team normalized point → world px (nx 0 = own/left goal). */
  FIELD.norm = (nx, ny) => ({
    x: RECT.x + nx * RECT.w,
    y: RECT.y + ny * RECT.h,
  })

  /** Same, mirrored for the enemy team (their nx 0 = right goal). */
  FIELD.normFor = (team, nx, ny) =>
    team === 'player' ? FIELD.norm(nx, ny) : FIELD.norm(1 - nx, ny)

  /** World x of the goal a team attacks / defends. */
  FIELD.attackGoalX = team => (team === 'player' ? FIELD.goals.right.lineX : FIELD.goals.left.lineX)
  FIELD.ownGoalX    = team => (team === 'player' ? FIELD.goals.left.lineX  : FIELD.goals.right.lineX)

  /** Is (x,y) inside a team's own penalty box? (used for Shift-to-goalie and box logic) */
  FIELD.inPenaltyBox = (team, x, y) => {
    if (y < FIELD.penaltyBox.top || y > FIELD.penaltyBox.bottom) return false
    return team === 'player'
      ? x <= RECT.x + FIELD.penaltyBox.depth
      : x >= RECT.x + RECT.w - FIELD.penaltyBox.depth
  }

  // NOTE: kickoff positions are per-formation-shape data now — see
  // formationDefs.js (FORMATIONS.kickoff[shape][role]).

  window.Footie.defs.FIELD = FIELD
})()

// ---- src/defs/tilesetDefs.js ----
;(function () {
  'use strict'

  /**
   * Stadium tileset def — Soccorpia Stadium Tiles.png, 1184×16 px:
   * a single row of 74 16px tiles. Named regions are [col, 0] in tile units
   * (tileW/tileH 16). Index map (measured from the strip):
   *   0        empty
   *   1–3      brown wood wall (left edge / mid / right edge)
   *   4        gray bleacher steps
   *   5–10     brown wall pieces with white section dividers
   *   11–19    gray bleacher step rows (variants, some with dividers)
   *   20–22    brown wall with steps at the bottom
   *   23–28    diagonal-hatch pavement with grass transition at the bottom
   *   29–38    pavement/grass transitions with white line fragments
   *   39–73    grass tiles: plains (two shades) + white field-marking pieces
   *
   * The stadium layout below is consumed by game/StadiumBuilder, which
   * prerenders the whole background once; field markings are drawn as
   * pixel-aligned white lines (same look as the marking tiles, without
   * hand-mapping all 30 of them).
   */
  window.Footie.defs.TILESET_DEF = {
    src: `${window.Footie.assetBase}assets/Soccorpia Asset Pack/Environment/Soccorpia Stadium Tiles.png`,
    tileW: 16,
    tileH: 16,
    sprites: {
      wallLeft:   [1, 0],
      wallMid:    [2, 0],
      wallRight:  [3, 0],
      steps:      [14, 0],
      stepsAlt:   [15, 0],
      wallSteps:  [8, 0],     // brown wall fading to steps (barrier row)
      pavement:   [34, 0],    // hatch with grass transition at the bottom
      grassLight: [40, 0],
      grassDark:  [41, 0],
    },
  }

  /**
   * Stadium band layout, in tile rows from the top of the world:
   * rows of stands the fans occupy, the barrier wall, the pavement strip,
   * then the grass plane (which fieldDefs' GRASS mirrors in pixels).
   */
  window.Footie.defs.STADIUM_LAYOUT = {
    standsRows:   [0, 1, 2, 3],   // y 0..64 — bleacher steps
    wallRow:      4,              // y 64..80 — barrier between crowd and pitch
    pavementRow:  5,              // y 80..96 — hatch + grass transition
    grassFromRow: 6,              // y 96.. — grass bands
    grassBandTiles: 3,            // vertical stripe width, in tiles
    // Fan rows: feet y positions on the steps, with loose x spacing.
    // World-width-agnostic: rows span inset .. world.w - inset.
    fanRows: [
      { footY: 40, inset: 28, spacing: 34 },
      { footY: 58, inset: 44, spacing: 34 },
    ],
  }
})()

// ---- src/defs/spriteDefs.js ----
;(function () {
  'use strict'

  /**
   * Sprite-sheet manifest — pure data for SpriteSheetEngine.
   *
   * Every character sheet is a horizontal strip of 100×103 cells; the art
   * inside is ~20×35 px, horizontally centered at x≈50 with the FEET at
   * y≈44 (measured) — that's the anchor, so a thing's (x, y) is where its
   * feet touch the grass. Frame counts differ per strip (idle 4, run 4,
   * victory 11, losing 11–14, kick 9) and are auto-derived from image width.
   *
   * Filenames in the pack are irregular ("Soccer Player Sprite(1)",
   * "Soccer Player (3)", "Soccer Player(4)") so the base-name maps below
   * list every variant explicitly, and the odd one-off filenames are
   * patched after the loop. Every path here is verified against the files
   * on disk — exact case matters on GitHub Pages.
   *
   * Sheet keys: `${team}${variant}-${anim}` for players (e.g. 'player1-run',
   * 'enemy3-idle'), `fan-{side}{n}-{mood}` for audience, 'ball'.
   */
  const ROOT = `${window.Footie.assetBase}assets/Soccorpia Asset Pack`
  const P    = `${ROOT}/Player sheets`

  // Despite the names, "Competitor" sheets are the RED characters and
  // "Soccer Player" sheets the TEAL ones (verified on screen). The user's
  // team is red, matching the sample art's left side.
  // 11v11 uses all 10 kit variants per team, mapped 1:1 to pack numbers
  // (roster slot variants 1..10 — see teamDefs/formationDefs).
  const RED = {
    1:  'Competitor Soccer Player (1)',
    2:  'Competitor Soccer Player (2)',
    3:  'Competitor Soccer Player (3)',
    4:  'Competitor Soccer Player (4)',
    5:  'Competitor Soccer Player (5)',
    6:  'Competitor Soccer Player (6)',
    7:  'Competitor Soccer Player (7)',
    8:  'Competitor Soccer Player (8)',
    9:  'Competitor Soccer Player (9)',
    10: 'Competitor Soccer Player (10)',
  }
  const TEAL = {
    1:  'Soccer Player Sprite(1)',
    2:  'Soccer Player(2)',
    3:  'Soccer Player (3)',
    4:  'Soccer Player(4)',
    5:  'Soccer Player(5)',
    6:  'Soccer Player(6)',
    7:  'Soccer Player(7)',
    8:  'Soccer Player(8)',
    9:  'Soccer Player(9)',
    10: 'Soccer Player(10)',
  }

  const sheets = {
    ball: {
      src: `${ROOT}/Environment/Soccer Ball.png`,
      cellW: 40, cellH: 49, anchorX: 20, anchorY: 24,   // single 24×24 ball centered at (8,12)
    },
  }

  const addPlayer = (team, variant, base) => {
    sheets[`${team}${variant}-idle`]    = { src: `${P}/Player Idles/${base}-Sheet.png` }
    sheets[`${team}${variant}-run`]     = { src: `${P}/Running Sheets/${base}-Running Sheet.png` }
    sheets[`${team}${variant}-kick`]    = { src: `${P}/Victory Kicks/${base}-Victory Kick.png` }
    sheets[`${team}${variant}-victory`] = { src: `${P}/Victory Dances/${base}-Victory Dance.png` }
    sheets[`${team}${variant}-losing`]  = { src: `${P}/Losing/${base}-Losing.png` }
  }
  for (const [v, base] of Object.entries(RED))  addPlayer('player', v, base)
  for (const [v, base] of Object.entries(TEAL)) addPlayer('enemy', v, base)

  // One-off filename irregularities in the pack (each verified on disk):
  // • Competitor (7)'s kick strip is misnamed "-Sheet" in Victory Kicks.
  // • Soccer Player(8)'s run strip says "Sheets"; (10)'s says lowercase
  //   "sheet". (Soccer Player(4)-Losing also ships exploded per-frame
  //   PNGs "-Losing1..11" — the aggregate "-Losing.png" above is the one
  //   we use.)
  sheets['player7-kick'].src = `${P}/Victory Kicks/Competitor Soccer Player (7)-Sheet.png`
  sheets['enemy8-run'].src   = `${P}/Running Sheets/Soccer Player(8)-Running Sheets.png`
  sheets['enemy10-run'].src  = `${P}/Running Sheets/Soccer Player(10)-Running sheet.png`

  // Audience: red fans (Competitor sheets) back the player team on the left
  // stand; teal fans (Soccer sheets) back the enemy on the right. Variant
  // numbers chosen so both moods exist for every fan (Soccer Booing has no
  // (6); Competitor Cheering starts at (2)).
  const A = `${ROOT}/Audience Sheets`
  for (const n of [2, 3, 4, 5]) {
    sheets[`fan-red${n}-cheer`] = { src: `${A}/Competitor Audience Cheering (${n}) Sheet.png` }
    sheets[`fan-red${n}-boo`]   = { src: `${A}/Competitor Audience Booing (${n}) Sheet.png` }
  }
  for (const n of [1, 2, 3, 4, 5]) {
    sheets[`fan-teal${n}-cheer`] = { src: `${A}/Soccer Audience Cheering (${n}) Sheet.png` }
    sheets[`fan-teal${n}-boo`]   = { src: `${A}/Soccer Audience Booing (${n}) Sheet.png` }
  }

  window.Footie.defs.SPRITE_DEF = {
    defaults: { cellW: 100, cellH: 103, anchorX: 50, anchorY: 44 },
    sheets,
    fanVariants: { red: [2, 3, 4, 5], teal: [1, 2, 3, 4, 5] },
    ballDrawScale: 1 / 3,   // 24px art → 8px on the pitch
  }
})()

// ---- src/defs/formationDefs.js ----
;(function () {
  'use strict'

  /**
   * Formation data for the 11-a-side game — the design record for shapes.
   *
   * Coordinates are normalized player-team coords (x 0 = own goal … 1 =
   * enemy goal, y 0 = top touchline … 1 = bottom; fieldDefs.normFor mirrors
   * them for the enemy).
   *
   * Two independent choices layer together:
   *   • SHAPE  — picked pre-match in Team Management ('442', '433', '4231');
   *     decides who is on the pitch (roster) and where each line sits.
   *   • MODE   — cycled in-match with Alt ('balanced' → 'attack' → 'defend'
   *     → 'spread'); pushes the whole shape up/back and widens/narrows it.
   *     The enemy always plays the default shape in 'balanced'.
   *
   * Per role per mode the table holds a `poss` anchor (team HAS possession),
   * a `def` anchor (it doesn't), and per-axis ball-influence weights `pull`:
   * the working anchor slides by pull × (ball − field center) — the spec's
   * `formationTarget + ballInfluence` model, unchanged from the 5v5 build.
   *
   * Everything under `tables` / `kickoff` / `roster` / `shiftCycle` is
   * GENERATED at load from the hand-tuned band seeds below — a shape is just
   * `lines` (band + player count); adding one means adding a `shapes` entry.
   */

  // ── Hand-tuned seeds ──────────────────────────────────────────────────

  // Band x-params per mode — the proven 5v5 numbers (DF, ML/MR → MF, FW
  // from the old per-role tables). DM and AM are derived below as the
  // midpoint between their neighbouring bands (DF↔MF and MF↔FW).
  const BAND_SEED = {
    balanced: {
      DF: { poss: 0.30, def: 0.20, pullX: 0.12, pullY: 0.35 },
      MF: { poss: 0.50, def: 0.40, pullX: 0.25, pullY: 0.30 },
      FW: { poss: 0.72, def: 0.55, pullX: 0.30, pullY: 0.35 },
    },
    attack: {
      DF: { poss: 0.50, def: 0.34, pullX: 0.12, pullY: 0.30 },
      MF: { poss: 0.68, def: 0.52, pullX: 0.25, pullY: 0.25 },
      FW: { poss: 0.86, def: 0.65, pullX: 0.25, pullY: 0.40 },
    },
    defend: {
      DF: { poss: 0.26, def: 0.15, pullX: 0.08, pullY: 0.35 },
      MF: { poss: 0.42, def: 0.29, pullX: 0.20, pullY: 0.40 },
      FW: { poss: 0.60, def: 0.46, pullX: 0.25, pullY: 0.35 },
    },
    spread: {
      DF: { poss: 0.30, def: 0.24, pullX: 0.10, pullY: 0.25 },
      MF: { poss: 0.55, def: 0.40, pullX: 0.20, pullY: 0.10 },
      FW: { poss: 0.76, def: 0.56, pullX: 0.25, pullY: 0.20 },
    },
  }

  // How far a line fans out vertically, per mode (multiplies lane spacing).
  const Y_SPREAD = { balanced: 1.0, attack: 0.95, defend: 0.9, spread: 1.35 }

  // Kickoff x per band — mode-independent, everyone on their own half and
  // OUTSIDE the centre circle (its edge sits at x ≈ 0.413 on the new
  // true-to-scale pitch), lines staggered so the shape reads at a glance.
  const KICKOFF_X = { GK: 0.05, DF: 0.16, DM: 0.22, MF: 0.28, AM: 0.34, FW: 0.40 }

  const BAND_LABEL = {
    DF: 'Defender',
    DM: 'Holding Mid',
    MF: 'Midfielder',
    AM: 'Attacking Mid',
    FW: 'Forward',
  }

  // Wide players (the outermost of any 3+ line) hug their touchline: they
  // follow the ball vertically a bit less — mirrors the old ML/MR pulls.
  const WIDE_PULL_Y_FACTOR = 0.85

  const MODES  = ['balanced', 'attack', 'defend', 'spread']
  const SHAPES = {
    '442':  { label: '4-4-2',   lines: [{ band: 'DF', count: 4 }, { band: 'MF', count: 4 }, { band: 'FW', count: 2 }] },
    '433':  { label: '4-3-3',   lines: [{ band: 'DF', count: 4 }, { band: 'MF', count: 3 }, { band: 'FW', count: 3 }] },
    '4231': { label: '4-2-3-1', lines: [{ band: 'DF', count: 4 }, { band: 'DM', count: 2 }, { band: 'AM', count: 3 }, { band: 'FW', count: 1 }] },
  }

  // ── Pure generator — runs once at load over shapes × modes ───────────

  const round = v => Math.round(v * 1e4) / 1e4
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)
  const mid   = (a, b) => ({
    poss:  round((a.poss  + b.poss)  / 2),
    def:   round((a.def   + b.def)   / 2),
    pullX: round((a.pullX + b.pullX) / 2),
    pullY: round((a.pullY + b.pullY) / 2),
  })

  /** Full five-band x-param table for one mode (DM/AM interpolated). */
  function bandParams(mode) {
    const s = BAND_SEED[mode]
    return { DF: s.DF, DM: mid(s.DF, s.MF), MF: s.MF, AM: mid(s.MF, s.FW), FW: s.FW }
  }

  /** Lane ys for a line of `count` players, centred on midfield. */
  function laneYs(count, ySpread) {
    const s = Math.min(0.24, 0.8 / count) * ySpread
    const ys = []
    for (let i = 0; i < count; i++)
      ys.push(round(clamp(0.5 + (i - (count - 1) / 2) * s, 0.08, 0.92)))
    return ys
  }

  function generate() {
    const tables = {}, kickoff = {}, roster = {}, shiftCycle = {}

    for (const [shapeId, shape] of Object.entries(SHAPES)) {
      tables[shapeId]  = {}
      kickoff[shapeId] = { GK: { x: KICKOFF_X.GK, y: 0.5 } }
      roster[shapeId]  = []

      // Roster + kickoff (kickoff lanes use the balanced spread).
      let variant = 0
      for (const line of shape.lines) {
        const ys = laneYs(line.count, Y_SPREAD.balanced)
        for (let i = 0; i < line.count; i++) {
          const role = `${line.band}${i + 1}`
          const wide = line.count >= 3 && (i === 0 || i === line.count - 1)
          roster[shapeId].push({
            role,
            band: line.band,
            label: `${BAND_LABEL[line.band]} ${i + 1}`,
            wide,
            variant: ++variant,          // outfield kits 1..10 in roster order
          })
          kickoff[shapeId][role] = { x: KICKOFF_X[line.band], y: ys[i] }
        }
      }

      // Shift cycle: attack-first — FWs, then AM/MF, then DM, then DF
      // (lines reversed; role-index order within a line).
      shiftCycle[shapeId] = [...shape.lines].reverse().flatMap(line =>
        Array.from({ length: line.count }, (_, i) => `${line.band}${i + 1}`))

      // Positioning tables per mode.
      for (const mode of MODES) {
        const bands = bandParams(mode)
        const table = (tables[shapeId][mode] = {})
        for (const line of shape.lines) {
          const b  = bands[line.band]
          const ys = laneYs(line.count, Y_SPREAD[mode])
          for (let i = 0; i < line.count; i++) {
            const wide = line.count >= 3 && (i === 0 || i === line.count - 1)
            table[`${line.band}${i + 1}`] = {
              poss: { x: b.poss, y: ys[i] },
              def:  { x: b.def,  y: ys[i] },
              pull: { x: b.pullX, y: round(b.pullY * (wide ? WIDE_PULL_Y_FACTOR : 1)) },
            }
          }
        }
      }
    }

    return { tables, kickoff, roster, shiftCycle }
  }

  const generated = generate()

  window.Footie.defs.FORMATIONS = {
    // In-match Alt tactical cycle.
    modes: MODES,
    modeLabels: { balanced: 'Balanced', attack: 'Attack', defend: 'Defend', spread: 'Spread' },

    // Pre-match shape pick (Team Management); persisted under storageKey.
    defaultShape: '442',
    shapeOrder: ['442', '433', '4231'],
    shapes: SHAPES,
    storageKey: 'footie-formation',

    // Generated: see the seeds + generator above.
    tables:     generated.tables,       // [shape][mode][role] → { poss, def, pull }
    kickoff:    generated.kickoff,      // [shape][role] → {x, y} (includes GK)
    roster:     generated.roster,       // [shape] → 10 outfield slots
    shiftCycle: generated.shiftCycle,   // [shape] → role ids, attack-first
  }
})()

// ---- src/defs/teamDefs.js ----
;(function () {
  'use strict'

  /**
   * Thingdefs for the two 11-player teams, the ball and the fans — pure
   * data plus the pure `rosterFor` factory the composition root calls when
   * building a world. Behaviors are referenced by name + params and
   * instantiated fresh per match by createThing (no state leaks between
   * matches).
   *
   * Rosters come from FORMATIONS.roster[shapeId] (10 outfield slots — role,
   * band, label, wide, kit variant) plus one goalie slot added here. Shift
   * cycling uses FORMATIONS.shiftCycle[shapeId] (GK joins only when the
   * ball is in the player's own penalty box — see FootieGame).
   */
  const FIELD_BEHAVIORS = [
    ['controlInput', {}],
    ['aiFieldPlayer', {}],
    ['slideTackle', {}],
    ['moveToTarget', {}],
    ['separatePlayers', {}],
    ['animate', {}],
  ]
  // Keepers never START a slide, but slideTackle is still on them: it is
  // the single owner of the downT/downImmuneT knockdown timers, and keepers
  // do get flattened (Screamer, stray slides).
  const GOALIE_BEHAVIORS = [
    ['aiGoalie', {}],
    ['slideTackle', {}],
    ['moveToTarget', {}],
    ['separatePlayers', {}],
    ['animate', {}],
  ]

  // The asset pack has exactly 10 outfield kit variants per team and no
  // dedicated keeper sheet, so the GK reuses an outfield kit — picked as
  // the sheet that reads most distinct at a glance (red: the multicolour
  // hair of pack (6); teal: the broad brown hairdo of pack (8)). The
  // keeper therefore twins with one outfield teammate's look; live with it
  // until the pack grows a keeper kit.
  const GK_VARIANT = { player: 6, enemy: 8 }

  const playerDef = (team, { role, band, label, wide, variant }) => ({
    name: `${team}-${role}`,
    visual: { kind: 'fieldPlayer' },
    behaviors: role === 'GK' ? GOALIE_BEHAVIORS : FIELD_BEHAVIORS,
    init: {
      team,
      role,
      band: band ?? (role === 'GK' ? 'GK' : undefined),
      label,
      variant,
      wide: wide ?? false,
      isGoalie: role === 'GK',
      isControlled: false,
      hasBall: false,
      moveTarget: null,
      moveDir: null,                  // unit direction — keyboard steering (controlInput)
      sprinting: false,
      faceX: team === 'player' ? 1 : -1,   // facing = aim; owned by moveToTarget
      faceY: 0,
      downT: 0,                       // flattened (slide/Screamer) — slideTackle ticks
      downImmuneT: 0,                 // just-up grace — can't be re-flattened yet
      frozenT: 0,                     // Flat-Footed statue — starPower ticks
      slide: null,                    // { phase, t, dirX, dirY, hit } — slideTackle owns
      flipX: team === 'enemy',        // enemies face their attacking direction (left)
      kickCooldown: 0,
      kickAnimT: 0,
      mood: null,                     // 'victory' | 'losing' | null — set by the match FSM
      aiRole: 'Support',
      ai: { decisionT: 0, passCooldown: 0, slideCooldownT: 0, weavePhase: Math.random() * Math.PI * 2 },
    },
  })

  window.Footie.defs.TEAM_DEFS = {
    /** 11 thingdefs for `team` in shape `shapeId`: 10 outfield + the GK. */
    rosterFor(team, shapeId) {
      const slots = window.Footie.defs.FORMATIONS.roster[shapeId]
      return [
        ...slots.map(slot => playerDef(team, slot)),
        playerDef(team, {
          role: 'GK', band: 'GK', label: 'Goalie',
          wide: false, variant: GK_VARIANT[team],
        }),
      ]
    },
  }

  window.Footie.defs.BALL_DEF = {
    name: 'ball',
    visual: { kind: 'ball' },
    behaviors: [
      ['starPower', {}],    // first: star effects land before possession/physics run
      ['possession', {}],
      ['ballPhysics', {}],
      ['dribble', {}],
    ],
    init: {
      owner: null,
      lastTouchedTeam: null,
      noPickupBy: null,   // {thing, t} — regrab delay after kicks
      stealImmunityT: 0,
      pressure: null,     // {by, t} — accumulating steal pressure on the owner
      z: 0,               // height above the turf (2.5D flight)
      vz: 0,
      curve: 0,           // lateral curve accel (precise shots); decays in flight
      pierceT: 0,         // Screamer: uncapped, flattening flight — starPower ticks
      frozenT: 0,         // Flat-Footed: ball statue — starPower ticks/thaws
      frozenStash: null,  // starPower's stashed velocity while frozen
      lastKicker: null,   // pass-completion credit; cleared on any transfer
      kickFromX: 0,       // where the last kick left the boot — pass-lane origin
      kickFromY: 0,
    },
  }

  window.Footie.defs.FAN_DEF = {
    name: 'fan',
    visual: { kind: 'fan' },
    behaviors: [['animateFan', {}]],
    init: { side: 'red', variant: 1, mood: 'idle', moodT: 0, phase: 0 },
  }
})()

// ---- src/defs/uiDefs.js ----
;(function () {
  'use strict'

  /** All player-facing copy — pure data; UISystem renders it. */
  window.Footie.defs.UI = {
    screens: { menu: 'screen-menu', setup: 'screen-setup', over: 'screen-over', hud: 'hud' },

    menu: {
      title: 'FOOTIE',
      subtitle: 'a cute lil arcade kickabout',
      startLabel: 'Click to Start',
      difficultyHeading: 'difficulty',
      difficulties: [
        { id: 'easy',   label: 'Easy' },
        { id: 'normal', label: 'Normal' },
        { id: 'hard',   label: 'Hard' },
      ],
      keys: [
        ['move',       'wasd / arrows'],
        ['pass',       'j — hold: harder'],
        ['switch',     'j (no ball)'],
        ['shoot',      'k — hold: precise'],
        ['tackle',     'k (no ball)'],
        ['lob',        'l — hold: longer'],
        ['sprint',     'shift — knock-on with ball'],
        ['star power', 'space (when full)'],
        ['formation',  'alt'],
        ['pause',      'esc'],
      ],
    },

    setup: {
      title: 'Team Management',
      subtitle: 'pick your shape — Alt still switches tactics mid-match',
      shapeHeading: 'formation',
      powerHeading: 'star power',
      powers: [
        { id: 'screamer',   label: 'Screamer',    blurb: 'Charge up — your next shot flattens everyone in its path.' },
        { id: 'firstTouch', label: 'First Touch', blurb: 'Drag the loose ball to your feet — even mid-shot.' },
        { id: 'ghostRun',   label: 'Ghost Run',   blurb: 'Hold space, aim, release — blink past the line, ball and all.' },
        { id: 'flatFooted', label: 'Flat-Footed', blurb: 'Catch every opponent near you flat-footed for a beat.' },
      ],
      kickoffLabel: 'Kick Off',
      backLabel: 'Back',
    },

    hud: {
      teams: { player: 'Player', enemy: 'Enemy' },
      formationPrefix: 'Formation: ',
      starLabel: 'STAR',
      starReadyHint: 'SPACE',
    },

    toasts: {
      playerGoal: 'GOAL!',
      enemyGoal: 'Enemy Goal',
      goldenGoal: 'GOLDEN GOAL — 30 SECONDS',
      starReady: 'STAR POWER READY',
      starActivated: { screamer: 'SCREAMER!', firstTouch: 'FIRST TOUCH!', ghostRun: 'GHOST RUN!', flatFooted: 'FLAT-FOOTED!' },
      enemyStarPrefix: 'Enemy star: ',
      countdown: ['3', '2', '1', 'GO!'],
      paused: 'PAUSED',
    },

    over: {
      win: 'You Win!',
      lose: 'You Lose',
      draw: 'Draw',
      rematchLabel: 'Rematch',
      menuLabel: 'Menu',
    },
  }
})()

// ---- src/defs/configDefs.js ----
;(function () {
  'use strict'
  const F = window.Footie

  /**
   * Host-configurable runtime config — the treasure-chest settings contract,
   * sized for a plain-JS score game.
   *
   * SETTINGS below is the single source of truth for every admin knob: it
   * drives BOTH the validation gate (`resolve`) and the published
   * settings-manifest.json (`buildSettingsManifest`, emitted by
   * tools/emit-settings-manifest.mjs), so the manifest can never drift from
   * the code. Defaults are READ FROM the other defs (TUNING / FORMATIONS /
   * UI), never duplicated as literals here.
   *
   * Flow: an embedding host (the Encore campaign admin) renders its Game
   * Settings panel from the published manifest, stores the chosen values,
   * and passes them back at `GameWorkshopGame.mount(container, { config })`
   * as a nested object (dot-path keys expanded host-side). `resolve` merges
   * them over `defaults()` and validates; ANY issue on a known key rejects
   * the whole config and the game mounts on pure defaults (mount.js logs the
   * issues). Unknown keys are ignored silently — hosts may send engine-shared
   * keys this game doesn't use. The game itself never fetches the manifest
   * (no fetch() — hard rule; games run from file://).
   */

  // Descriptor `default`/`options` are thunks so they read the live def
  // values at call time (configDefs loads after the defs it mirrors).
  const SETTINGS = [
    {
      key: 'match.timeSeconds',
      type: 'integer',
      label: 'Match length (seconds)',
      help: 'Regulation time before full-time. Sudden death may extend it.',
      min: 30, max: 600, step: 10,
      required: true,
      default: () => F.defs.TUNING.match.timeSeconds,
    },
    {
      key: 'match.suddenDeathEnabled',
      type: 'boolean',
      label: 'Golden goal overtime',
      help: 'When the score is level at full time, up to 30 seconds of overtime are played — next goal wins. If still level (or with this off), the match is a draw.',
      default: () => F.defs.TUNING.match.suddenDeathEnabled,
    },
    {
      key: 'difficulty',
      type: 'select',
      label: 'Default difficulty',
      help: 'The difficulty preselected for every player. Players can still change it on the menu.',
      options: () => F.defs.UI.menu.difficulties.map(d => ({ label: d.label, value: d.id })),
      default: () => F.defs.TUNING.defaultDifficulty,
    },
    {
      key: 'formation',
      type: 'select',
      label: 'Default formation',
      help: 'The team shape preselected on the Team Management screen. Players can still change it before kickoff.',
      options: () => F.defs.FORMATIONS.shapeOrder.map(id => ({ label: F.defs.FORMATIONS.shapes[id].label, value: id })),
      default: () => F.defs.FORMATIONS.defaultShape,
    },
    {
      key: 'starPowerEnabled',
      type: 'boolean',
      label: 'Star Power',
      help: 'Each side picks one special move charged by good play — the crowd heats up as it fills. Off hides the pick and the meter entirely.',
      default: () => F.defs.STAR.enabledDefault,
    },
    {
      key: 'starPower',
      type: 'select',
      label: 'Default star power',
      help: 'The star power preselected on the Team Management screen. Players can still change it before kickoff.',
      options: () => F.defs.UI.setup.powers.map(p => ({ label: p.label, value: p.id })),
      default: () => F.defs.STAR.defaultPower,
    },
  ]

  const getPath = (obj, key) =>
    key.split('.').reduce((o, part) => (o == null ? undefined : o[part]), obj)

  const setPath = (obj, key, value) => {
    const parts = key.split('.')
    let o = obj
    for (const part of parts.slice(0, -1)) o = o[part] ?? (o[part] = {})
    o[parts.at(-1)] = value
  }

  /** Pure defaults, `hostProvided: false` — what the standalone page boots on. */
  const defaults = () => {
    const config = { hostProvided: false }
    for (const s of SETTINGS) setPath(config, s.key, s.default())
    return config
  }

  const validate = (s, value) => {
    switch (s.type) {
      case 'integer':
        if (typeof value !== 'number' || !Number.isInteger(value)) return `${s.key}: expected an integer, got ${JSON.stringify(value)}`
        if (value < s.min || value > s.max) return `${s.key}: ${value} outside [${s.min}, ${s.max}]`
        return null
      case 'boolean':
        return typeof value === 'boolean' ? null : `${s.key}: expected a boolean, got ${JSON.stringify(value)}`
      case 'select': {
        const allowed = s.options().map(o => o.value)
        return allowed.includes(value) ? null : `${s.key}: ${JSON.stringify(value)} not one of ${allowed.join(', ')}`
      }
      default:
        return `${s.key}: unknown setting type ${s.type}`
    }
  }

  /**
   * Merge a host's (nested) config over defaults and validate every known
   * key. Absent keys keep their defaults (a partial config is fine — the
   * host stores only what the admin overrode); a PRESENT-but-invalid value
   * is an issue, and any issue means the caller must discard the whole
   * config (treasure-chest gate: broken configs never half-apply).
   * @returns {{ config: object, issues: string[] }}
   */
  const resolve = (hostConfig) => {
    const config = defaults()
    config.hostProvided = true
    const issues = []
    for (const s of SETTINGS) {
      const value = getPath(hostConfig, s.key)
      if (value === undefined || value === null) continue
      const issue = validate(s, value)
      if (issue) issues.push(issue)
      else setPath(config, s.key, value)
    }
    return { config, issues }
  }

  /** The settings-manifest.json content — written by tools/emit-settings-manifest.mjs. */
  const buildSettingsManifest = () => ({
    displayName: 'Footie',
    gameId: 'footie',
    schemaVersion: 1,
    sections: [
      {
        autoPopulate: false,
        entries: SETTINGS.map(s => {
          const entry = {
            default: s.default(),
            help: s.help,
            key: s.key,
            label: s.label,
            type: s.type,
          }
          if (s.min !== undefined) entry.min = s.min
          if (s.max !== undefined) entry.max = s.max
          if (s.step !== undefined) entry.step = s.step
          if (s.options) entry.options = s.options()
          if (s.required) entry.required = true
          return entry
        }),
        kind: 'settings',
        title: 'Match rules',
      },
    ],
  })

  window.Footie.defs.CONFIG = { SETTINGS, defaults, resolve, buildSettingsManifest }
})()

// ---- src/behaviors/kickHelper.js ----
;(function () {
  'use strict'

  /**
   * Shared kick primitive used by controlInput, aiFieldPlayer and aiGoalie:
   * releases the ball from `kicker` toward (tx, ty) at `power` px/s, stamps
   * the cooldowns/immunities that stop instant regrabs, and announces the
   * kick on the event bus (for animation/crowd/UI concerns).
   *
   * opts:
   *   vz          — initial vertical speed (lobs, lofted shots); NEVER capped.
   *   curve       — lateral curve accel (precise shots); decays in ballPhysics.
   *   regrabDelay — override the default own-kick repossession lockout.
   *
   * Ground speed is capped at ball.maxSpeed unless the ball is piercing
   * (Screamer star power) — a Screamer flies uncapped.
   *
   * Emits 'shot-on-target' when the kick is shot-strength AND its line,
   * extended to the opponent's goal line, crosses inside the goal mouth
   * (simple linear extrapolation, no z check — good enough for the meter).
   *
   * Returns false if the kicker doesn't actually own the ball.
   */
  window.Footie.behaviors.helpers.kick = function kick(ctx, kicker, tx, ty, power, opts = {}) {
    const ball   = ctx.world.ball
    const TUNING = ctx.tuning
    const { vz = 0, curve = 0, regrabDelay = TUNING.kick.regrabDelay } = opts
    if (ball.owner !== kicker) return false

    let dx = tx - kicker.x
    let dy = ty - kicker.y
    const d = Math.hypot(dx, dy)
    if (d < 0.001) {
      dx = kicker.faceX ?? (kicker.flipX ? -1 : 1)
      dy = kicker.faceY ?? 0
    } else { dx /= d; dy /= d }

    const speed = ball.pierceT > 0 ? power : Math.min(power, TUNING.ball.maxSpeed)
    ball.owner  = null
    ball.vx     = dx * speed
    ball.vy     = dy * speed
    ball.vz     = vz
    ball.curve  = curve
    ball.lastKicker = kicker
    ball.kickFromX  = kicker.x
    ball.kickFromY  = kicker.y
    ball.lastTouchedTeam = kicker.team
    ball.noPickupBy      = { thing: kicker, t: regrabDelay }
    ball.pressure        = null

    kicker.hasBall      = false
    kicker.kickCooldown = TUNING.kick.cooldown
    kicker.kickAnimT    = TUNING.anim.kickDuration

    ctx.events.emit('kick', { by: kicker, power: speed, tx, ty, vz, curve })

    // Shot-on-target detection for the Star Power meter.
    if (speed >= TUNING.shot.tapPower * 0.9 && dx !== 0) {
      const goalX = ctx.field.attackGoalX(kicker.team)
      const t = (goalX - kicker.x) / dx
      if (t > 0) {
        const crossY = kicker.y + dy * t
        const mouth  = ctx.field.goalMouth
        if (crossY > mouth.top && crossY < mouth.bottom)
          ctx.events.emit('shot-on-target', { by: kicker })
      }
    }
    return true
  }
})()

// ---- src/behaviors/implementations/moveToTarget.js ----
;(function () {
  'use strict'

  /**
   * Shared locomotion for every player. Two steering modes:
   *   `thing.moveDir`    — a unit direction (the keyboard-controlled player);
   *                        full speed instantly, no arrive ramp.
   *   `thing.moveTarget` — a world point (all AI); accelerate toward it and
   *                        arrive smoothly (no teleporting, no orbiting).
   * Sprint (`thing.sprinting`) raises both cap and ramp-up. Also the single
   * home of facing: `faceX/faceY` follow velocity while moving and are kept
   * when standing still, so aiming/kicking always has a direction.
   *
   * Skips entirely while a slide owns the body (slideTackle moves it), and
   * dumps velocity while down or frozen — flattened players don't glide.
   */
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)

  window.Footie.behaviors.implementations.moveToTarget = function moveToTarget() {
    return {
      update(thing, ctx, dt) {
        const P = ctx.tuning.player
        if (ctx.world.freeze) { thing.vx = 0; thing.vy = 0; return }
        if (thing.slide) return
        if (thing.downT > 0 || thing.frozenT > 0) { thing.vx = 0; thing.vy = 0; return }

        let maxSpeed = P.maxSpeed
        let accel    = P.acceleration
        if (thing.isControlled) {
          maxSpeed *= P.controlled.speedMultiplier
          accel    *= P.controlled.accelerationMultiplier
        }
        if (thing.sprinting) {
          maxSpeed *= P.sprintMultiplier
          accel    *= P.sprintAccelMultiplier
        }

        let desiredX = 0
        let desiredY = 0
        const dir = thing.moveDir
        if (dir && (dir.x !== 0 || dir.y !== 0)) {
          desiredX = dir.x * maxSpeed
          desiredY = dir.y * maxSpeed
        } else if (thing.moveTarget) {
          const t = thing.moveTarget
          const dx = t.x - thing.x
          const dy = t.y - thing.y
          const dist = Math.hypot(dx, dy)
          if (dist > P.stopRadius) {
            // Arrive: full speed far out, easing down near the target.
            const speed = Math.min(maxSpeed, dist * 6)
            desiredX = (dx / dist) * speed
            desiredY = (dy / dist) * speed
          }
        }

        const maxDv = accel * dt
        const dvx = clamp(desiredX - thing.vx, -maxDv, maxDv)
        const dvy = clamp(desiredY - thing.vy, -maxDv, maxDv)
        thing.vx += dvx
        thing.vy += dvy

        const rect = ctx.field.rect
        thing.x = clamp(thing.x + thing.vx * dt, rect.x, rect.x + rect.w)
        thing.y = clamp(thing.y + thing.vy * dt, rect.y, rect.y + rect.h)

        // Facing follows real movement; retained when idle so a standing
        // player still aims somewhere sensible.
        const speed = Math.hypot(thing.vx, thing.vy)
        if (speed > 5) {
          thing.faceX = thing.vx / speed
          thing.faceY = thing.vy / speed
        }
      },
    }
  }
})()

// ---- src/behaviors/implementations/controlInput.js ----
;(function () {
  'use strict'

  /**
   * Keyboard control for the human player — the whole PES-style action set:
   *
   *   WASD / arrows  move; the same vector is the AIM for every action
   *   J              with ball: pass (hold = harder); without: switch player
   *   K              with ball: tap shot, or hold past input.holdThreshold for
   *                  the PRECISE shot (world slows, trajectory preview, lateral
   *                  aim bends the ball); without ball: aerial finish if an
   *                  airborne ball is in reach, otherwise slide tackle
   *   L              lob/chip (hold = longer)
   *   Shift          sprint; with the ball it knocks it ahead (kick-and-run)
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
        // slow-mo — FootieGame reads control.k.precise) and give no input.
        if (thing.downT > 0 || thing.frozenT > 0 || thing.slide) {
          control.j = control.k = control.l = null
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
        thing.moveDir = control.k?.precise ? null : dir

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
        if (input.pressed.includes('k')) {
          if (hasBall) {
            control.k = { t: 0, precise: false, curve: 0, charge: 0, aim: { ...aim } }
          } else {
            const kind = aerialKind(ctx, thing)
            if (kind) aerialStrike(ctx, thing, kind)
            else if (F.behaviors.helpers.startSlide) F.behaviors.helpers.startSlide(thing, ctx)
          }
        }
        if (control.k) {
          if (!hasBall) { control.k = null; control.indicator = null }
          else {
            control.k.t += realDt
            if (!control.k.precise && control.k.t >= T.input.holdThreshold) {
              control.k.precise = true          // FootieGame slows the world off this flag
              control.k.aim = { ...aim }        // trajectory locks to the aim at entry…
            }
            const S = T.shot.precise
            if (control.k.precise) {
              // …and sideways input from here on bends the ball instead.
              if (dir) {
                const lateral = dir.x * -control.k.aim.y + dir.y * control.k.aim.x
                control.k.curve = clamp(control.k.curve + lateral * S.curveRate * realDt, -S.curveMax, S.curveMax)
              }
              thing.faceX = control.k.aim.x
              thing.faceY = control.k.aim.y
              control.k.charge = clamp(
                (control.k.t - T.input.holdThreshold) / (S.maxCharge - T.input.holdThreshold), 0, 1)
              control.indicator = simulateTrajectory(ctx, thing, control.k.aim,
                lerp(S.powerMin, S.powerMax, control.k.charge),
                lerp(S.vzMin, S.vzMax, control.k.charge), control.k.curve)
            }
            const autoFire = control.k.precise && control.k.t >= S.maxCharge
            if (input.released.includes('k') || autoFire) {
              if (control.k.precise) {
                F.behaviors.helpers.kick(ctx, thing,
                  thing.x + control.k.aim.x * 100, thing.y + control.k.aim.y * 100,
                  lerp(S.powerMin, S.powerMax, control.k.charge),
                  { vz: lerp(S.vzMin, S.vzMax, control.k.charge), curve: control.k.curve })
              } else {
                // Tap shot: straight at the mouth, biased by vertical aim.
                const gx = ctx.field.attackGoalX(thing.team)
                const half = ctx.field.goalMouth.h / 2 - T.shot.aimMarginY
                const gy = ctx.field.center.y + aim.y * half
                F.behaviors.helpers.kick(ctx, thing, gx, gy, T.shot.tapPower, { vz: 10 })
              }
              control.k = null
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

// ---- src/behaviors/implementations/dribble.js ----
;(function () {
  'use strict'

  /**
   * Possessed-ball placement: the ball rides slightly ahead of its owner in
   * their movement direction, easing toward that spot so it lags a touch
   * and feels physical rather than glued. A carried ball is grounded — any
   * flight state is pinned off. A flattened carrier drops the ball (the
   * slide strike / poke usually freed it already; this is belt-and-braces).
   */
  window.Footie.behaviors.implementations.dribble = function dribble() {
    return {
      update(ball, ctx, dt) {
        const owner = ball.owner
        if (!owner) return

        if (owner.downT > 0) {
          // A carrier on the turf can't keep the ball: gentle release.
          owner.hasBall = false
          ball.owner = null
          ball.vx = owner.vx
          ball.vy = owner.vy
          return
        }

        // Carried balls stay on the deck with no residual flight state.
        ball.z = 0
        ball.vz = 0
        ball.curve = 0

        const speed = Math.hypot(owner.vx, owner.vy)
        let dirX, dirY
        if (speed > 4) {
          dirX = owner.vx / speed
          dirY = owner.vy / speed
        } else {
          dirX = owner.flipX ? -1 : 1
          dirY = 0
        }
        const off = ctx.tuning.ball.dribbleOffset
        const tx  = owner.x + dirX * off
        const ty  = owner.y + dirY * off - 2   // ball sits at the feet, a hair above the anchor line

        const ease = Math.min(1, 14 * dt)
        ball.x += (tx - ball.x) * ease
        ball.y += (ty - ball.y) * ease
        ball.vx = owner.vx
        ball.vy = owner.vy
      },
    }
  }
})()

// ---- src/behaviors/implementations/ballPhysics.js ----
;(function () {
  'use strict'

  /**
   * Free-ball physics: 2.5D height (z/vz with gravity + bounces), friction,
   * curve, speed cap, light bounces off the touchlines, and goal detection.
   *
   * The ball can only cross a goal line through the goal mouth — anywhere
   * else on the line it bounces — so the arcade game never needs throw-ins
   * or corners. A goal fires once the ball is fully across the line
   * (center + radius) AND below crossbar height: above the bar an invisible
   * wall bounces it back exactly like a non-mouth goal-line hit. That's
   * arcade fiction — it keeps lobs in play and preserves the no-corners
   * design.
   *
   * pierceT (Screamer star power) exempts the ball from the ground-speed
   * cap; the starPower behavior owns ticking pierceT, we only respect it.
   * frozenT (Flat-Footed) suspends integration entirely — starPower thaws.
   */
  window.Footie.behaviors.implementations.ballPhysics = function ballPhysics() {
    return {
      update(ball, ctx, dt) {
        if (ball.frozenT > 0) return   // Flat-Footed statue — starPower ticks/thaws it
        if (ball.owner || ctx.world.freeze) return
        const B     = ctx.tuning.ball
        const AIR   = ctx.tuning.ballAir
        const rect  = ctx.field.rect
        const mouth = ctx.field.goalMouth

        // ── Height: gravity, landing, bounces ──────────────────────────
        if (ball.z > 0 || ball.vz !== 0) {
          ball.vz -= AIR.gravity * dt
          ball.z  += ball.vz * dt
          if (ball.z <= 0) {
            ball.z = 0
            if (Math.abs(ball.vz) > AIR.bounceKill) {
              ball.vz = -ball.vz * AIR.bounceZ
              ball.vx *= AIR.bounceGroundFriction
              ball.vy *= AIR.bounceGroundFriction
            } else {
              ball.vz = 0
            }
          }
        }
        const grounded = ball.z <= 0 && ball.vz === 0

        // Friction is defined per 60Hz frame; keep it framerate-independent.
        // Airborne balls barely slow horizontally.
        const f = Math.pow(grounded ? B.friction : AIR.airFrictionPerFrame, dt * 60)
        ball.vx *= f
        ball.vy *= f

        // ── Curve: perpendicular accel that bleeds off over the flight ──
        let speed = Math.hypot(ball.vx, ball.vy)
        if (Math.abs(ball.curve) > 1) {
          if (speed > 20) {
            const nx = ball.vx / speed
            const ny = ball.vy / speed
            ball.vx += -ny * ball.curve * dt
            ball.vy +=  nx * ball.curve * dt
          }
          ball.curve *= Math.pow(AIR.curveDecayPerFrame, dt * 60)
          if (Math.abs(ball.curve) <= 1) ball.curve = 0
        }

        // Ground-speed cap — skipped while piercing (a Screamer flies uncapped).
        speed = Math.hypot(ball.vx, ball.vy)
        if (ball.pierceT <= 0 && speed > B.maxSpeed) {
          ball.vx *= B.maxSpeed / speed
          ball.vy *= B.maxSpeed / speed
        }
        if (grounded && speed < 2) { ball.vx = 0; ball.vy = 0 }

        ball.x += ball.vx * dt
        ball.y += ball.vy * dt

        const r = B.radius

        // Touchlines (top/bottom): light bounce.
        if (ball.y < rect.y + r)          { ball.y = rect.y + r;          ball.vy = Math.abs(ball.vy) * B.bounce }
        if (ball.y > rect.y + rect.h - r) { ball.y = rect.y + rect.h - r; ball.vy = -Math.abs(ball.vy) * B.bounce }

        // Goal lines (left/right): pass through the mouth below the bar,
        // bounce elsewhere (including the invisible wall above the crossbar).
        const inMouth  = ball.y > mouth.top + r && ball.y < mouth.bottom - r
        const canScore = inMouth && ball.z <= AIR.crossbarZ
        const leftLine  = rect.x
        const rightLine = rect.x + rect.w

        if (ball.x < leftLine + r) {
          if (canScore) {
            if (ball.x < leftLine - r) ctx.events.emit('goal', { scoringTeam: 'enemy', goal: 'left' })
          } else {
            ball.x = leftLine + r
            ball.vx = Math.abs(ball.vx) * B.bounce
          }
        } else if (ball.x > rightLine - r) {
          if (canScore) {
            if (ball.x > rightLine + r) ctx.events.emit('goal', { scoringTeam: 'player', goal: 'right' })
          } else {
            ball.x = rightLine - r
            ball.vx = -Math.abs(ball.vx) * B.bounce
          }
        }

        // Net back-stop so a scored ball doesn't fly off into the stands.
        const depth = ctx.field.goalDepth
        if (ball.x < leftLine - depth)  { ball.x = leftLine - depth;  ball.vx = 0; ball.vy *= 0.5 }
        if (ball.x > rightLine + depth) { ball.x = rightLine + depth; ball.vx = 0; ball.vy *= 0.5 }
      },
    }
  }
})()

// ---- src/behaviors/implementations/possession.js ----
;(function () {
  'use strict'

  /**
   * Ball ownership: pickups, pokes and steals. Runs on the ball, before
   * physics.
   *
   * Pickup (free ball): any upright player within BALL_PICKUP_RADIUS claims
   * it — controlled player first, then closest — as long as the ball is slow
   * enough to trap (goalies catch anything; that's the "save") and low
   * enough (outfielders below pickupMaxZ, keepers below goalieClaimZ). The
   * kicker can't regrab their own kick for a beat. A pickup that completes
   * a teammate's kick emits 'pass-completed' with how many opponents the
   * pass line bypassed (Star Power meter food).
   *
   * Poke (owned ball): a rival square in FRONT of the carrier, right on the
   * exposed ball, toes it loose — no possession transfer, the ball squirts
   * away from the carrier. Emits 'poke'.
   *
   * Steal (owned ball): no tackle button. An opponent inside STEAL_RADIUS
   * who is right on the ball takes it outright; otherwise their presence
   * accumulates pressure and the carrier coughs it up after STEAL_TIME
   * (the controlled player resists longer). A fresh owner gets a moment of
   * immunity so possession doesn't ping-pong.
   *
   * Downed / frozen / sliding players neither steal nor pick up — a sliding
   * player wins the ball via slideTackle's strike, not a soft pickup.
   */
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
  const upright = p => !(p.downT > 0) && !(p.frozenT > 0) && !p.slide

  /** Perpendicular distance from p to segment a→b, or Infinity when p's
   *  projection falls outside the segment (strictly inside counts). */
  function laneDist(p, ax, ay, bx, by) {
    const abx = bx - ax, aby = by - ay
    const len2 = abx * abx + aby * aby
    if (len2 === 0) return Infinity
    const t = ((p.x - ax) * abx + (p.y - ay) * aby) / len2
    if (t <= 0 || t >= 1) return Infinity
    return Math.hypot(p.x - (ax + abx * t), p.y - (ay + aby * t))
  }

  window.Footie.behaviors.implementations.possession = function possession() {
    const transfer = (ball, from, to, ctx) => {
      if (from) from.hasBall = false
      ball.owner = to
      to.hasBall = true
      ball.lastTouchedTeam = to.team
      ball.stealImmunityT  = ctx.tuning.steal.stolenImmunity
      ball.pressure = null
      // The ball is trapped: kill any flight state, and clear the pass
      // bookkeeping so a dribbled-then-lost ball can't credit a stale pass.
      ball.z = 0
      ball.vz = 0
      ball.curve = 0
      ball.pierceT = 0
      ball.lastKicker = null
      ctx.events.emit('possession-changed', { from, to })
    }

    return {
      update(ball, ctx, dt) {
        // Timers tick even during freezes so stale locks don't survive resets.
        if (ball.noPickupBy && (ball.noPickupBy.t -= dt) <= 0) ball.noPickupBy = null
        if (ball.stealImmunityT > 0) ball.stealImmunityT -= dt
        if (ctx.world.freeze) return

        const S   = ctx.tuning.steal
        const B   = ctx.tuning.ball
        const AIR = ctx.tuning.ballAir
        const P   = ctx.tuning.poke

        if (ball.owner) {
          const owner = ball.owner
          const rivals = ctx.world.players.filter(p =>
            p.team !== owner.team && p.alive !== false && upright(p) &&
            dist(p, owner) < S.radius + ctx.tuning.player.radius)

          if (rivals.length === 0) { ball.pressure = null; return }
          if (ball.stealImmunityT > 0) return

          // Poke: a rival approaching from the FRONT toes the exposed ball
          // loose (dribble holds it ahead of the owner, so frontal rivals
          // are right on it). No possession transfer — the ball squirts away.
          const nearest = rivals.reduce((a, b) => (dist(a, owner) < dist(b, owner) ? a : b))
          if (dist(nearest, owner) < P.radius && dist(nearest, ball) < P.radius) {
            let fx = owner.faceX ?? (owner.flipX ? -1 : 1)
            let fy = owner.faceY ?? 0
            const fd = Math.hypot(fx, fy) || 1
            let tx = nearest.x - owner.x
            let ty = nearest.y - owner.y
            const td = Math.hypot(tx, ty) || 1
            const frontal = (fx / fd) * (tx / td) + (fy / fd) * (ty / td) >
              Math.cos(P.alignDeg * Math.PI / 180)
            if (frontal) {
              owner.hasBall = false
              ball.owner = null
              // Knock it loose away from the POKER, not along the carrier's
              // facing — a retreating defender poked near his own goal must
              // not have the ball toed into his own net.
              let ax = ball.x - nearest.x
              let ay = ball.y - nearest.y
              const ad = Math.hypot(ax, ay)
              if (ad < 0.001) { ax = -tx / td; ay = -ty / td } else { ax /= ad; ay /= ad }
              ball.vx = ax * P.speed
              ball.vy = ay * P.speed
              ball.lastTouchedTeam = nearest.team
              ball.lastKicker = null
              ball.stealImmunityT = 0
              ball.pressure = null
              ctx.events.emit('poke', { by: nearest, from: owner })
              return
            }
          }

          // Outright steal: a rival standing on the (reachable) ball itself.
          const onBall = rivals.find(p => dist(p, ball) < B.radius + 3)
          if (onBall && ball.z < AIR.pickupMaxZ) { transfer(ball, owner, onBall, ctx); return }

          // Otherwise: sustained pressure pops the ball loose.
          const presser = nearest
          if (!ball.pressure || ball.pressure.by !== presser) ball.pressure = { by: presser, t: 0 }
          ball.pressure.t += dt
          const limit = owner.isControlled ? S.controlledTime : S.time
          if (ball.pressure.t >= limit) transfer(ball, owner, presser, ctx)
          return
        }

        // Free ball: who can claim it?
        const speed = Math.hypot(ball.vx, ball.vy)
        const candidates = ctx.world.players.filter(p => {
          if (p.alive === false || !upright(p)) return false
          if (ball.noPickupBy && ball.noPickupBy.thing === p) return false
          if (dist(p, ball) >= B.pickupRadius) return false
          if (!(p.isGoalie ? ball.z < AIR.goalieClaimZ : ball.z < AIR.pickupMaxZ)) return false
          return p.isGoalie || speed < B.pickupMaxSpeed
        })
        if (candidates.length === 0) return

        const winner =
          candidates.find(p => p.isControlled) ??
          candidates.reduce((a, b) => (dist(a, ball) < dist(b, ball) ? a : b))

        // Pass bookkeeping BEFORE transfer clears it.
        const kicker = ball.lastKicker
        const fromX = ball.kickFromX
        const fromY = ball.kickFromY
        const pickX = ball.x
        const pickY = ball.y
        transfer(ball, null, winner, ctx)

        // A teammate trapping the kicked ball = a completed pass. `bypassed`
        // counts opposing outfielders the pass line cut through — the Star
        // Power meter pays more for line-breaking balls.
        if (kicker && winner.team === kicker.team && winner !== kicker) {
          const laneW = window.Footie.defs.STAR.meter.bypassLaneWidth
          const bypassed = ctx.world.players.filter(p =>
            p.team !== kicker.team && !p.isGoalie &&
            laneDist(p, fromX, fromY, pickX, pickY) < laneW).length
          ctx.events.emit('pass-completed', { from: kicker, to: winner, bypassed })
        }
      },
    }
  }
})()

// ---- src/behaviors/implementations/aiFieldPlayer.js ----
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

// ---- src/behaviors/implementations/aiGoalie.js ----
;(function () {
  'use strict'

  /**
   * Goalie brain, both teams — four positioning states plus distribution,
   * tracked on thing.ai.gkState (debug-friendly):
   *
   *   hold-line      — default: hug the line, shadow the ball across the mouth.
   *   track          — a rival carrier threatens our box: step off the line
   *                    along the ball→goal-center line, narrowing the angle.
   *   claim          — slow, low free ball in our box: go collect it (the
   *                    pickup itself is possession's job — keepers catch
   *                    anything below goalieClaimZ).
   *   emergency-save — fast free ball heading inside our mouth: sprint to
   *                    the projected crossing point. (Simplification: no
   *                    speed burst — moveToTarget has no burst channel; a
   *                    far target already yields full arrive speed.)
   *
   * Distribution: after holding the ball goalieDistributeDelay seconds,
   * roll it short to the nearest teammate with no opponent inside
   * goalieSafeRadius (soft enough to trap on arrival); nobody safe → boot
   * the openness-weighted upfield clear.
   */
  const helpers = window.Footie.behaviors.helpers
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)
  const dist  = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

  window.Footie.behaviors.implementations.aiGoalie = function aiGoalie() {
    return {
      update(thing, ctx, dt) {
        if (ctx.world.freeze) return
        if (thing.downT > 0 || thing.frozenT > 0) return
        const world = ctx.world
        const F     = ctx.field
        const ball  = world.ball
        const AI    = ctx.tuning.ai
        const AIR   = ctx.tuning.ballAir

        const ownX  = F.ownGoalX(thing.team)
        const dir   = Math.sign(F.attackGoalX(thing.team) - ownX)   // into the pitch
        const box   = F.penaltyBox
        const mouth = F.goalMouth
        const goalCenter = { x: ownX, y: F.center.y }

        if (!thing.ai.holdT) thing.ai.holdT = 0

        // ── Distribution: holding the ball ────────────────────────────
        if (thing.hasBall) {
          thing.ai.gkState = 'distribute'
          thing.moveTarget = { x: ownX + dir * 10, y: F.center.y }
          thing.ai.holdT += dt
          if (thing.ai.holdT >= AI.goalieDistributeDelay && thing.kickCooldown <= 0) {
            const mates = world.players.filter(p =>
              p.team === thing.team && p !== thing && !p.isGoalie)
            const rivals = world.players.filter(p => p.team !== thing.team)
            // Short option: nearest teammate nobody is marking.
            const safe = mates.filter(m =>
              !rivals.some(r => dist(m, r) < AI.goalieSafeRadius))
            if (safe.length) {
              const pick = safe.reduce((a, b) => (dist(a, thing) < dist(b, thing) ? a : b))
              const lead = { x: pick.x + pick.vx * 0.25, y: pick.y + pick.vy * 0.25 }
              // Soft enough that the receiver can trap it on arrival.
              const power = Math.max(120,
                Math.min(dist(thing, lead) * 2, ctx.tuning.ball.pickupMaxSpeed - 10))
              helpers.kick(ctx, thing, lead.x, lead.y, power)
            } else {
              // Nobody safe: clear to whoever has the most breathing room,
              // weighted upfield.
              const openness = p => Math.min(...rivals.map(q => dist(p, q))) +
                (p.x - thing.x) * dir * 0.3
              const pick = mates.reduce((a, b) => (openness(a) > openness(b) ? a : b))
              helpers.kick(ctx, thing, pick.x + dir * 20, pick.y, ctx.tuning.shot.tapPower * 0.85)
            }
            thing.ai.holdT = 0
          }
          return
        }
        thing.ai.holdT = 0

        // ── Emergency save: fast ball flying at our mouth ─────────────
        const speed2d = Math.hypot(ball.vx, ball.vy)
        if (!ball.owner && speed2d >= 200 && Math.abs(ball.vx) > 1) {
          const tLine = (ownX - ball.x) / ball.vx
          if (tLine > 0 && tLine < 0.9) {
            const crossY = ball.y + ball.vy * tLine
            if (crossY > mouth.top - 10 && crossY < mouth.bottom + 10) {
              thing.ai.gkState = 'emergency-save'
              thing.moveTarget = {
                x: ownX + dir * 4,
                y: clamp(crossY, mouth.top - 10, mouth.bottom + 10),
              }
              return
            }
          }
        }

        // ── Claim: slow, low free ball in our box ─────────────────────
        // Range is capped near the GOAL box — a keeper who chases loose
        // balls across the full 44yd penalty box leaves an empty net behind.
        const gb = F.goalBox
        const ballInBox = !ball.owner && F.inPenaltyBox(thing.team, ball.x, ball.y)
        if (ballInBox && ball.z < AIR.goalieClaimZ && speed2d < 220 &&
            ball.y > gb.top - 12 && ball.y < gb.bottom + 12) {
          thing.ai.gkState = 'claim'
          const lead = { x: ball.x + ball.vx * 0.2, y: ball.y + ball.vy * 0.2 }
          thing.moveTarget = {
            x: thing.team === 'player'
              ? clamp(lead.x, F.rect.x, F.rect.x + gb.depth + 16)
              : clamp(lead.x, F.rect.x + F.rect.w - gb.depth - 16, F.rect.x + F.rect.w),
            y: clamp(lead.y, gb.top - 12, gb.bottom + 12),
          }
          return
        }

        // ── Track: rival carrier bearing down on our goal ─────────────
        const owner = ball.owner
        if (owner && owner.team !== thing.team &&
            Math.abs(owner.x - ownX) < box.depth * 1.5) {
          thing.ai.gkState = 'track'
          // Step out along the ball→goal-center line to narrow the angle —
          // conservatively: a keeper far off his line loses to any shot around
          // him (pickup radius is small and shots cross in a couple of ticks).
          const bx = ball.x - goalCenter.x
          const by = ball.y - goalCenter.y
          const bd = Math.hypot(bx, by) || 1
          const depth = Math.min(bd * 0.15, box.depth * 0.25)
          thing.moveTarget = {
            x: goalCenter.x + (bx / bd) * depth,
            y: clamp(goalCenter.y + (by / bd) * depth, mouth.top - 8, mouth.bottom + 8),
          }
          return
        }

        // ── Hold line (default) ───────────────────────────────────────
        thing.ai.gkState = 'hold-line'
        thing.moveTarget = {
          x: ownX + dir * 6,
          y: clamp(ball.y, mouth.top + 6, mouth.bottom - 6),
        }
      },
    }
  }
})()

// ---- src/behaviors/implementations/slideTackle.js ----
;(function () {
  'use strict'

  /**
   * Slide tackle: a committed lunge along the slider's facing. While
   * sliding the tackler owns their own motion (moveToTarget skips), punts
   * the ball away on contact ('tackle' hit:true — the clean tackle), and
   * flattens ANY contacted upright player, friend or foe. A miss costs a
   * long get-up; a hit gets you up quick.
   *
   * This behavior is also the single owner of the downT / downImmuneT
   * knockdown timers — it runs on every player (goalies included: keepers
   * never slide, but they DO get knocked down, and their timers must tick).
   *
   * helpers.startSlide(thing, ctx) is the one entry point — controlInput
   * (human) and aiFieldPlayer (AI) both call it.
   */
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)

  window.Footie.behaviors.helpers.startSlide = function startSlide(thing, ctx) {
    if (thing.slide || thing.downT > 0 || thing.frozenT > 0 || ctx.world.freeze) return false
    let dx = thing.faceX ?? 1
    let dy = thing.faceY ?? 0
    const d = Math.hypot(dx, dy)
    if (d < 0.001) { dx = 1; dy = 0 } else { dx /= d; dy /= d }
    thing.slide = { phase: 'sliding', t: 0, dirX: dx, dirY: dy, hit: false }
    thing.moveTarget = null
    thing.moveDir = null
    thing.kickAnimT = ctx.tuning.anim.kickDuration   // reuse the kick pose
    return true
  }

  window.Footie.behaviors.implementations.slideTackle = function slideTackle() {
    return {
      update(thing, ctx, dt) {
        // Knockdown timers tick here — single owner, every player has this.
        if (thing.downT > 0)       thing.downT       = Math.max(0, thing.downT - dt)
        if (thing.downImmuneT > 0) thing.downImmuneT = Math.max(0, thing.downImmuneT - dt)
        // (frozenT is ticked by the starPower behavior, not here.)

        const slide = thing.slide
        if (!slide) return
        const SL  = ctx.tuning.slide
        const AIR = ctx.tuning.ballAir
        const P   = ctx.tuning.player

        if (slide.phase === 'sliding') {
          slide.t += dt
          const rect = ctx.field.rect
          thing.x = clamp(thing.x + slide.dirX * SL.speed * dt, rect.x, rect.x + rect.w)
          thing.y = clamp(thing.y + slide.dirY * SL.speed * dt, rect.y, rect.y + rect.h)

          // Ball contact: strike it away (freeing it from a carrier first).
          const ball = ctx.world.ball
          if (!slide.hit && ball.z < AIR.pickupMaxZ &&
              Math.hypot(thing.x - ball.x, thing.y - ball.y) < P.radius + SL.reach) {
            let victim = null
            if (ball.owner) {
              if (ball.owner !== thing) victim = ball.owner
              ball.owner.hasBall = false
              ball.owner = null
            }
            ball.vx = slide.dirX * SL.ballStrikePower
            ball.vy = slide.dirY * SL.ballStrikePower
            ball.lastTouchedTeam = thing.team
            ball.lastKicker = null
            ball.stealImmunityT = 0
            ball.pressure = null
            ball.noPickupBy = { thing, t: 0.3 }   // slider can't instantly regrab
            slide.hit = true
            ctx.events.emit('tackle', { by: thing, hit: true, victim })
          }

          // Body contact: flatten ANY upright player in the path (friendly
          // fire included — sliding through your own man is on you).
          for (const p of ctx.world.players) {
            if (p === thing || p.alive === false) continue
            if (p.downT > 0 || p.slide || p.downImmuneT > 0) continue
            if (Math.hypot(thing.x - p.x, thing.y - p.y) >= P.radius * 2 + 2) continue
            p.downT = SL.knockdownT
            p.downImmuneT = SL.knockdownT + SL.downImmunity
            // Belt-and-braces: a flattened carrier drops the ball even if
            // the ball-contact strike above somehow missed it.
            if (p.hasBall) {
              p.hasBall = false
              if (ball.owner === p) ball.owner = null
            }
          }

          if (slide.t >= SL.duration) {
            slide.phase = 'recover'
            slide.t = 0
            slide.recover = slide.hit ? SL.recoverHit : SL.recoverMiss
            if (!slide.hit) ctx.events.emit('tackle', { by: thing, hit: false })
          }
          return
        }

        // 'recover': flat on the turf, immobile, then back up.
        slide.t += dt
        if (slide.t >= slide.recover) thing.slide = null
      },
    }
  }
})()

// ---- src/behaviors/implementations/starPower.js ----
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
   *   ghostAim                   { t, aim } while the human holds Space aiming
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
      // Hold Space to aim with the movement keys, release to blink.
      if (!star.ghostAim && full && input.pressed.includes(' ')) star.ghostAim = { t: 0 }
      if (star.ghostAim) {
        if (!full) { star.ghostAim = null; return }
        star.ghostAim.t += 0   // aged below with dt-free landing preview
        star.ghostAim.aim = aimOf(me)
        star.ghostAim.landing = ghostLanding(ctx, me, star.ghostAim.aim)
        if (input.released.includes(' ') || (star.ghostAim.holdT ?? 0) >= STAR.powers.ghostRun.holdMaxSeconds) {
          activate(ctx, 'player', 'ghostRun', me)
          star.ghostAim = null
        }
      }
    } else if (full && input.pressed.includes(' ')) {
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

// ---- src/behaviors/implementations/separatePlayers.js ----
;(function () {
  'use strict'

  /**
   * Soft circle-vs-circle push so players don't stack. Each player nudges
   * only itself out of overlaps (both parties run this, so pairs resolve
   * symmetrically); the controlled player yields less, per the spec's
   * "controlled player gets priority".
   */
  window.Footie.behaviors.implementations.separatePlayers = function separatePlayers() {
    return {
      update(thing, ctx, dt) {
        if (ctx.world.freeze) return
        // Bodies on the turf don't shove: skip pairs where either party is
        // down or mid-slide.
        if (thing.downT > 0 || thing.slide) return
        const r = ctx.tuning.player.radius
        for (const other of ctx.world.players) {
          if (other === thing || other.alive === false) continue
          if (other.downT > 0 || other.slide) continue
          const dx = thing.x - other.x
          const dy = thing.y - other.y
          const dist = Math.hypot(dx, dy)
          const minDist = r * 2
          if (dist >= minDist || dist === 0) continue
          const overlap = minDist - dist
          const share = thing.isControlled ? 0.25 : other.isControlled ? 0.75 : 0.5
          // Soft push: resolve a fraction per frame so it never feels bouncy.
          const push = overlap * share * Math.min(1, 12 * dt)
          thing.x += (dx / dist) * push
          thing.y += (dy / dist) * push
        }
      },
    }
  }
})()

// ---- src/behaviors/implementations/animate.js ----
;(function () {
  'use strict'

  /**
   * Player animation state: maps movement/possession/match mood onto the
   * sheet names the painters blit, ticks the frame clock, and owns facing.
   * Also the one place kick timers count down (every player has this
   * behavior and it runs even while the match FSM freezes gameplay — the
   * celebration states are exactly when victory/losing must animate).
   *
   * Priority per the spec: knocked down (frozen 'losing' frame) > statue
   * (Flat-Footed freeze) > mood (victory/losing) > sliding/kicking >
   * running > idle. Facing never flips while down/frozen/sliding.
   */
  window.Footie.behaviors.implementations.animate = function animate() {
    const set = (thing, name, fps) => {
      if (thing.anim.name === name) return
      thing.anim = { name, t: 0, fps }
    }

    return {
      update(thing, ctx, dt) {
        const A = ctx.tuning.anim
        if (thing.kickCooldown > 0) thing.kickCooldown -= dt
        if (thing.kickAnimT > 0)    thing.kickAnimT   -= dt

        // Flattened: hold frame 0 of the losing pose, face where we fell.
        if (thing.downT > 0) {
          thing.anim = { name: 'losing', t: 0, fps: 0 }
          return
        }
        // Flat-Footed statue: keep whatever frame we're on, don't advance.
        if (thing.frozenT > 0) return

        if (thing.mood === 'victory')      set(thing, 'victory', A.fps.victory)
        else if (thing.mood === 'losing')  set(thing, 'losing', A.fps.losing)
        else if (thing.slide)              set(thing, 'kick', A.fps.kick)   // slide rides the kick pose
        else if (thing.kickAnimT > 0)      set(thing, 'kick', A.fps.kick)
        else if (Math.hypot(thing.vx, thing.vy) > A.runThreshold) set(thing, 'run', A.fps.run)
        else                               set(thing, 'idle', A.fps.idle)

        thing.anim.t += dt

        // Face the way we're moving; hold facing when idle or sliding.
        if (!ctx.world.freeze && !thing.slide && Math.abs(thing.vx) > 5)
          thing.flipX = thing.vx < 0
      },
    }
  }
})()

// ---- src/behaviors/implementations/animateFan.js ----
;(function () {
  'use strict'

  /**
   * Crowd animation. Two layers:
   *
   *   Mood bursts — the match FSM flips whole stands to 'cheer'/'boo' for a
   *   while via thing.mood + moodT (goals, eruptions; moodFps overrides the
   *   default cheer rate for Star Power eruptions).
   *
   *   Heat — while idle, each side's stand tracks its team's Star Power
   *   meter (world.crowdHeat, a tier of {fraction, fps}): a fan joins the
   *   bounce when its random phase falls inside the tier's fraction, so the
   *   participating set is stable and GROWS as the meter fills — the same
   *   superfans keep bouncing while their neighbours join in. An x-based
   *   stagger ripples the motion down the stand instead of lockstep.
   */
  window.Footie.behaviors.implementations.animateFan = function animateFan() {
    return {
      update(thing, ctx, dt) {
        const fps = ctx.tuning.anim.fps
        if (thing.mood !== 'idle') {
          thing.moodT -= dt
          if (thing.moodT <= 0) { thing.mood = 'idle'; thing.moodFps = null; thing.anim.t = 0 }
        }

        if (thing.mood === 'idle') {
          const heat = ctx.world.crowdHeat?.[thing.side]
          const STAR = window.Footie.defs.STAR
          if (heat && heat.fraction > 0 && (thing.phase / 4) < heat.fraction) {
            thing.anim.name = 'cheer'
            thing.anim.fps  = heat.fps
            // Wave: offset the clock by position so the bounce rolls along the row.
            thing.anim.t += dt
            thing.anim.waveOffset = thing.x * STAR.audience.waveStaggerPerPx
            return
          }
          thing.anim.name = 'cheer'
          thing.anim.fps  = 0
          thing.anim.waveOffset = 0
          thing.anim.t += dt
          return
        }

        thing.anim.name = thing.mood === 'boo' ? 'boo' : 'cheer'
        thing.anim.fps  = thing.moodFps ?? (thing.mood === 'boo' ? fps.boo : fps.cheer)
        thing.anim.waveOffset = 0
        thing.anim.t += dt
      },
    }
  }
})()

// ---- src/behaviors/createBehavior.js ----
;(function () {
  'use strict'

  /**
   * The behavior creator. Thingdefs reference behaviors by name + params
   * (data); the implementations registry (behaviors/implementations/) turns
   * each entry into a live implementation with the params closed over.
   * Adding a behavior = one implementation file, zero engine edits.
   */
  window.Footie.behaviors.createBehavior = function createBehavior([name, params]) {
    const factory = window.Footie.behaviors.implementations[name]
    if (!factory) throw new Error(`createBehavior: unknown behavior "${name}"`)
    return factory(params)
  }
})()

// ---- src/things/createThing.js ----
;(function () {
  'use strict'

  /**
   * The thingdef creator. Every entity — players, ball, fans — is built here
   * from its def: `def.init` supplies per-kind fields, `props` per-instance
   * overrides (position, variant, …), and behaviors are instantiated fresh
   * through the behavior creator so per-match behavior state never leaks
   * between matches.
   */
  window.Footie.things.createThing = function createThing(def, props = {}) {
    return {
      def,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      alive: true,
      anim: { name: 'idle', t: 0 },
      ...(def.init ? JSON.parse(JSON.stringify(def.init)) : {}),
      ...props,
      behaviors: (def.behaviors ?? []).map(window.Footie.behaviors.createBehavior),
    }
  }
})()

// ---- src/things/painters.js ----
;(function () {
  'use strict'

  /**
   * Painter implementations, registered by visual `kind` (see RenderEngine).
   * Every painter tries the real sheet art first and falls back to flat
   * shapes while images load (or if art is ever removed) — the game is
   * playable art-less. Painters receive { tileset, sheets } and blit
   * through them; nothing here touches the GPU or the DOM.
   */
  const PALETTE = {
    red:      '#d5382f',
    redDark:  '#8f1f19',
    teal:     '#2fa7a0',
    tealDark: '#1a6b66',
    skin:     '#e8b88a',
    white:    '#ffffff',
    shadow:   'rgba(20, 40, 20, 0.35)',
  }

  const frameOf = thing => Math.floor(thing.anim.t * (thing.anim.fps ?? 6))

  const painters = {
    /** Field player: ground ring for the controlled one, then sheet art (feet at x,y). */
    fieldPlayer(ctx, thing, view, { sheets }) {
      // Soft ground shadow sells the top-down-ish perspective.
      ctx.fillStyle = PALETTE.shadow
      ctx.beginPath()
      ctx.ellipse(thing.x, thing.y + 1, 6, 2.5, 0, 0, Math.PI * 2)
      ctx.fill()

      if (thing.isControlled && !(thing.downT > 0)) {
        ctx.strokeStyle = PALETTE.white
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.ellipse(thing.x, thing.y + 1, 8, 3.5, 0, 0, Math.PI * 2)
        ctx.stroke()
      }

      // Knocked down: the sheet has no prone art, so lay the sprite on its
      // back (SpriteSheetEngine can't rotate — the painter owns the transform).
      if (thing.downT > 0) {
        ctx.save()
        ctx.translate(thing.x, thing.y)
        ctx.rotate(thing.flipX ? Math.PI / 2 : -Math.PI / 2)
        ctx.translate(-thing.x, -thing.y)
      }
      // Sliding: lean the kick pose into the lunge.
      else if (thing.slide && thing.slide.phase === 'sliding') {
        ctx.save()
        ctx.translate(thing.x, thing.y)
        ctx.rotate((thing.flipX ? -1 : 1) * 0.5)
        ctx.translate(-thing.x, -thing.y)
      }
      const restore = thing.downT > 0 || (thing.slide && thing.slide.phase === 'sliding')

      const key = `${thing.team}${thing.variant}-${thing.anim.name}`
      if (sheets && sheets.ready(key)) {
        sheets.draw(ctx, key, frameOf(thing), thing.x, thing.y, { flipX: thing.flipX })
        if (restore) ctx.restore()
        return
      }

      // Shape stand-in: little jersey block + head, team colored.
      const c = thing.team === 'player' ? PALETTE.red : PALETTE.teal
      const d = thing.team === 'player' ? PALETTE.redDark : PALETTE.tealDark
      ctx.fillStyle = d
      ctx.fillRect(thing.x - 4, thing.y - 12, 8, 12)
      ctx.fillStyle = c
      ctx.fillRect(thing.x - 4, thing.y - 12, 8, 8)
      ctx.fillStyle = PALETTE.skin
      ctx.fillRect(thing.x - 3, thing.y - 18, 6, 6)
      if (restore) ctx.restore()
    },

    /**
     * The ball. (x, y) is the GROUND position (physics/sorting space); an
     * airborne ball draws lifted by z with the shadow left on the turf —
     * the widening shadow-to-sprite gap IS the height cue.
     */
    ball(ctx, thing, view, { sheets }) {
      const z = thing.z ?? 0
      const shadowScale = Math.max(0.3, 1 - z / 60)
      ctx.fillStyle = PALETTE.shadow
      ctx.beginPath()
      ctx.ellipse(thing.x, thing.y + 3, 3 * shadowScale, 1.2 * shadowScale, 0, 0, Math.PI * 2)
      ctx.fill()

      const drawY = thing.y - z * 0.9
      const lift  = 1 + z / 80   // subtly larger when closer to "camera"
      if (sheets && sheets.ready('ball')) {
        sheets.draw(ctx, 'ball', 0, thing.x, drawY, { scale: window.Footie.defs.SPRITE_DEF.ballDrawScale * lift })
        return
      }
      ctx.fillStyle = PALETTE.white
      ctx.beginPath()
      ctx.arc(thing.x, drawY, 3 * lift, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#222'
      ctx.fillRect(thing.x - 1, drawY - 1, 2, 2)
    },

    /** Stand fan (feet at x,y). Idles on frame 0 of the cheer sheet. */
    fan(ctx, thing, view, { sheets }) {
      const mood = thing.anim.name === 'boo' ? 'boo' : 'cheer'
      const key  = `fan-${thing.side}${thing.variant}-${mood}`
      if (sheets && sheets.ready(key)) {
        // waveOffset (heat ripple) shifts the clock by seat position so hot
        // stands roll like a wave rather than bouncing in lockstep.
        const clock = thing.anim.t + (thing.anim.waveOffset ?? 0)
        const frame = thing.anim.fps === 0 ? 0 : Math.floor(clock * thing.anim.fps + thing.phase)
        sheets.draw(ctx, key, frame, thing.x, thing.y, { flipX: thing.flipX })
        return
      }
      ctx.fillStyle = thing.side === 'red' ? PALETTE.red : PALETTE.teal
      ctx.fillRect(thing.x - 3, thing.y - 10, 6, 10)
      ctx.fillStyle = PALETTE.skin
      ctx.fillRect(thing.x - 2, thing.y - 14, 4, 4)
    },
  }

  window.Footie.things.painters = painters
  window.Footie.things.PALETTE  = PALETTE
})()

// ---- src/game/StadiumBuilder.js ----
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

      // Penalty spots, 12 yd from each goal line.
      const spotL = R.x + F.penaltySpotDist
      const spotR = R.x + R.w - F.penaltySpotDist
      ctx.fillRect(spotL, F.center.y, 1, 1)
      ctx.fillRect(spotR, F.center.y, 1, 1)

      // Penalty arcs ("D"s): centre-circle radius around each spot, only the
      // part outside the box. cos θ = (box edge − spot) / radius.
      const r = F.centerCircleRadius
      const half = Math.acos((R.x + pb.depth - spotL) / r)
      ctx.beginPath()
      ctx.arc(spotL + 0.5, F.center.y + 0.5, r, -half, half)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(spotR + 0.5, F.center.y + 0.5, r, Math.PI - half, Math.PI + half)
      ctx.stroke()

      // Corner arcs, 1 yd quarter circles inside each pitch corner.
      const c = F.cornerRadius
      const corner = (cx, cy, start) => {
        ctx.beginPath()
        ctx.arc(cx + 0.5, cy + 0.5, c, start, start + Math.PI / 2)
        ctx.stroke()
      }
      corner(R.x, R.y, 0)                          // top-left: arc into the pitch
      corner(R.x + R.w, R.y, Math.PI / 2)          // top-right
      corner(R.x + R.w, R.y + R.h, Math.PI)        // bottom-right
      corner(R.x, R.y + R.h, -Math.PI / 2)         // bottom-left
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

// ---- src/game/overlayPainter.js ----
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
    const k = world.control.k
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

// ---- src/game/StarFx.js ----
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

// ---- src/game/ui/UISystem.js ----
;(function () {
  'use strict'
  const F = window.Footie

  /**
   * DOM layer: menu / game-over screens, HUD (score, clock, formation),
   * and the fx layer for big center toasts (countdown, GOAL!, sudden
   * death) and the fading formation notice. All copy comes from
   * defs/uiDefs.js; no gameplay knowledge lives here.
   */
  class UISystem {
    /** @param {Document|ShadowRoot} root — document on the standalone page, or the
     *  ShadowRoot an embedding host's mount() built the shell into. */
    constructor(root) {
      this.root = root
      const UI = F.defs.UI
      this.menuEl  = root.getElementById(UI.screens.menu)
      this.setupEl = root.getElementById(UI.screens.setup)
      this.overEl  = root.getElementById(UI.screens.over)
      this.hudEl   = root.getElementById(UI.screens.hud)
      this.fxEl    = root.getElementById('fx-layer')

      this.hudScoreEl     = root.getElementById('hud-score')
      this.hudClockEl     = root.getElementById('hud-clock')
      this.hudFormationEl = root.getElementById('hud-formation')
      this.overHeadingEl  = root.getElementById('over-heading')
      this.overScoreEl    = root.getElementById('over-score')

      this.onStart          = () => {}
      this.onRematch        = () => {}
      this.onMenu           = () => {}
      this.onDifficultyPick = () => {}
      this.onShapePick      = () => {}
      this.onPowerPick      = () => {}
      this.onKickoff        = () => {}
      this.onSetupBack      = () => {}

      this._pausedToast = null
      this._lastHud = ''
      this._lastStar = ''
      this._populateStaticCopy()
      this._wireButtons()
    }

    _populateStaticCopy() {
      const UI = F.defs.UI
      const root = this.root
      root.getElementById('menu-title').textContent    = UI.menu.title
      root.getElementById('menu-subtitle').textContent = UI.menu.subtitle
      root.getElementById('menu-difficulty-heading').textContent = UI.menu.difficultyHeading
      root.querySelector('#btn-start .btn__label').textContent   = UI.menu.startLabel
      root.querySelector('#btn-rematch .btn__label').textContent = UI.over.rematchLabel
      root.querySelector('#btn-menu .btn__label').textContent    = UI.over.menuLabel
      const keyLines = UI.menu.keys.map(([action, binding]) =>
        `<span class="keys__line"><strong>${action}</strong><span>${binding}</span></span>`
      ).join('')
      root.getElementById('menu-keys').innerHTML = keyLines
      root.getElementById('hud-legend').innerHTML = keyLines

      root.getElementById('setup-title').textContent         = UI.setup.title
      root.getElementById('setup-subtitle').textContent      = UI.setup.subtitle
      root.getElementById('setup-shape-heading').textContent = UI.setup.shapeHeading
      root.getElementById('setup-power-heading').textContent = UI.setup.powerHeading
      root.querySelector('#btn-kickoff .btn__label').textContent    = UI.setup.kickoffLabel
      root.querySelector('#btn-setup-back .btn__label').textContent = UI.setup.backLabel
      root.getElementById('hud-star-hint').textContent = UI.hud.starReadyHint
    }

    _wireButtons() {
      const UI = F.defs.UI
      const root = this.root
      root.getElementById('btn-start').addEventListener('click', () => this.onStart())
      root.getElementById('btn-rematch').addEventListener('click', () => this.onRematch())
      root.getElementById('btn-menu').addEventListener('click', () => this.onMenu())

      const wrap = root.getElementById('difficulty-select')
      for (const d of UI.menu.difficulties) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'diff-btn'
        btn.dataset.id = d.id
        btn.textContent = d.label
        btn.addEventListener('click', () => this.onDifficultyPick(d.id))
        wrap.appendChild(btn)
      }

      root.getElementById('btn-kickoff').addEventListener('click', () => this.onKickoff())
      root.getElementById('btn-setup-back').addEventListener('click', () => this.onSetupBack())

      // Formation shapes come from game data (labels live with the shapes),
      // rendered exactly like the difficulty picker.
      const FORMATIONS = F.defs.FORMATIONS
      const shapeWrap = root.getElementById('formation-select')
      for (const id of FORMATIONS.shapeOrder) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'diff-btn shape-btn'
        btn.dataset.id = id
        btn.textContent = FORMATIONS.shapes[id].label
        btn.addEventListener('click', () => this.onShapePick(id))
        shapeWrap.appendChild(btn)
      }

      // Star Power pick — copy lives in uiDefs.setup.powers.
      const powerWrap = root.getElementById('star-power-select')
      for (const power of UI.setup.powers) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'diff-btn power-btn'
        btn.dataset.id = power.id
        btn.textContent = power.label
        btn.addEventListener('click', () => this.onPowerPick(power.id))
        powerWrap.appendChild(btn)
      }
    }

    setSelectedDifficulty(id) {
      this.root.querySelectorAll('.diff-btn:not(.shape-btn):not(.power-btn)').forEach(b =>
        b.classList.toggle('diff-btn--active', b.dataset.id === id))
    }

    setSelectedShape(id) {
      this.root.querySelectorAll('.shape-btn').forEach(b =>
        b.classList.toggle('diff-btn--active', b.dataset.id === id))
    }

    setSelectedPower(id) {
      const UI = F.defs.UI
      this.root.querySelectorAll('.power-btn').forEach(b =>
        b.classList.toggle('diff-btn--active', b.dataset.id === id))
      const power = UI.setup.powers.find(p => p.id === id)
      this.root.getElementById('setup-power-blurb').textContent = power ? power.blurb : ''
    }

    /** Host config can switch the whole Star Power system off. */
    setStarPowerVisible(visible) {
      for (const elId of ['setup-power-heading', 'star-power-select', 'setup-power-blurb', 'hud-star', 'hud-star-enemy']) {
        const el = this.root.getElementById(elId)
        if (el) el.hidden = !visible
      }
    }

    /** Star meter bars — own quantized memo so the DOM only changes when a
     *  whole percent does (updateHUD's dirty key stays untouched). */
    updateStarMeter(playerValue, enemyValue, playerReady) {
      const key = `${Math.round(playerValue)}|${Math.round(enemyValue)}|${playerReady}`
      if (key === this._lastStar) return
      this._lastStar = key
      const max = F.defs.STAR.meter.max
      this.root.getElementById('hud-star-fill').style.width = `${Math.round(100 * playerValue / max)}%`
      this.root.getElementById('hud-star-enemy-fill').style.width = `${Math.round(100 * enemyValue / max)}%`
      this.root.getElementById('hud-star').classList.toggle('hud-star--ready', !!playerReady)
      this.root.getElementById('hud-star-hint').hidden = !playerReady
    }

    // ── Screens ─────────────────────────────────────────────────────────
    showMenu()    { this._show(this.menuEl); this._hide(this.setupEl); this._hide(this.overEl); this.hudEl.hidden = true }
    showSetup()   { this._show(this.setupEl); this._hide(this.menuEl); this._hide(this.overEl); this.hudEl.hidden = true }
    showPlaying() { this._hide(this.menuEl); this._hide(this.setupEl); this._hide(this.overEl); this.hudEl.hidden = false }
    showOver({ outcome, scoreLine }) {
      const UI = F.defs.UI
      this.overHeadingEl.textContent =
        outcome === 'win' ? UI.over.win : outcome === 'draw' ? UI.over.draw : UI.over.lose
      this.overHeadingEl.classList.toggle('over-heading--lose', outcome === 'lose')
      this.overHeadingEl.classList.toggle('over-heading--draw', outcome === 'draw')
      this.overScoreEl.textContent = scoreLine
      this._show(this.overEl)
    }

    _show(el) { el.hidden = false; el.classList.add('screen--visible') }
    _hide(el) { el.hidden = true;  el.classList.remove('screen--visible') }

    // ── HUD ─────────────────────────────────────────────────────────────
    updateHUD({ playerScore, enemyScore, timeLeft, formationLabel, suddenDeath }) {
      const UI = F.defs.UI
      const mm = String(Math.floor(Math.max(0, timeLeft) / 60)).padStart(2, '0')
      const ss = String(Math.floor(Math.max(0, timeLeft) % 60)).padStart(2, '0')
      const key = `${playerScore}|${enemyScore}|${mm}${ss}|${formationLabel}|${suddenDeath}`
      if (key === this._lastHud) return
      this._lastHud = key
      this.hudScoreEl.textContent = `${UI.hud.teams.player} ${playerScore} - ${enemyScore} ${UI.hud.teams.enemy}`
      this.hudClockEl.textContent = suddenDeath ? '⚡ ' + mm + ':' + ss : mm + ':' + ss
      this.hudFormationEl.textContent = UI.hud.formationPrefix + formationLabel
    }

    // ── FX toasts ───────────────────────────────────────────────────────
    /** Big center text that pops and fades. */
    toast(text, { ms = 900, cls = '' } = {}) {
      const el = document.createElement('div')
      el.className = `fx-toast ${cls}`
      el.textContent = text
      this.fxEl.appendChild(el)
      setTimeout(() => el.classList.add('fx-toast--out'), ms)
      setTimeout(() => el.remove(), ms + 400)
      return el
    }

    formationToast(label) {
      this.toast(F.defs.UI.hud.formationPrefix + label, { ms: 1000, cls: 'fx-toast--formation' })
    }

    showPaused() {
      if (this._pausedToast) return
      this._pausedToast = document.createElement('div')
      this._pausedToast.className = 'fx-toast fx-toast--paused'
      this._pausedToast.textContent = F.defs.UI.toasts.paused
      this.fxEl.appendChild(this._pausedToast)
    }
    hidePaused() {
      this._pausedToast?.remove()
      this._pausedToast = null
    }
  }

  F.game.UISystem = UISystem
})()

// ---- src/game/FootieGame.js ----
;(function () {
  'use strict'
  const F = window.Footie

  const STATE = {
    MENU:    'menu',
    SETUP:   'setup',
    KICKOFF: 'kickoff',
    PLAYING: 'playing',
    GOAL:    'goal',
    RESET:   'reset',
    OVER:    'over',
    PAUSED:  'paused',
  }

  /**
   * Composition root — the only layer that knows both the generic engines
   * and the concrete defs. Owns the world (players, ball, fans), the match
   * lifecycle FSM, scoring, sudden death, Shift player switching and Alt
   * formation cycling. The render loop runs in every state (the frozen
   * stadium is the menu backdrop; celebrations animate during freezes) —
   * `world.freeze` is what stops gameplay, not the loop.
   */
  class FootieGame {
    /** @param {{canvas, ui, input, events, tileset, sheets, config?}} deps
     *  `config` is the RESOLVED runtime config (see defs/configDefs.js) — either
     *  pure defaults (standalone) or host overrides already merged+validated by
     *  mount(). `config.hostProvided` decides whether host values or the
     *  player's saved localStorage picks win as the initial selection. */
    constructor({ canvas, ui, input, events, tileset, sheets, config }) {
      const { GameLoop, GameStateMachine, BehaviorEngine, RenderEngine } = F.engine
      const FIELD = F.defs.FIELD

      this.config = config ?? F.defs.CONFIG.defaults()

      this.ui     = ui
      this.input  = input
      this.events = events
      this.stadium = new F.game.StadiumBuilder({
        tileset,
        field: FIELD,
        layout: F.defs.STADIUM_LAYOUT,
      })
      this.render = new RenderEngine(canvas, {
        worldW: FIELD.world.w,
        worldH: FIELD.world.h,
        viewW: FIELD.view.w,
        viewH: FIELD.view.h,
        painters: F.things.painters,
        background: (ctx) => this.stadium.paint(ctx),
        tileset,
        sheets,
      })
      // Camera center in world px; lerped toward the ball each tick.
      this._cam = { x: FIELD.center.x, y: FIELD.center.y }
      this.loop     = new GameLoop()
      this.behavior = new BehaviorEngine()

      // Host-provided values win as the INITIAL selection (campaign first
      // plays must be deterministic); otherwise the player's saved picks do.
      // Either way the player can still change both in the UI afterward.
      this.difficultyId = this.config.hostProvided
        ? this.config.difficulty
        : this._loadDifficulty(this.config.difficulty)
      this.formationShape = this.config.hostProvided
        ? this.config.formation
        : this._loadFormation(this.config.formation)
      const powerDefault = this.config.starPower ?? F.defs.STAR.defaultPower
      this.starPowerId = this.config.hostProvided
        ? powerDefault
        : this._loadStarPower(powerDefault)
      this.starEnabled = this.config.starPowerEnabled ?? F.defs.STAR.enabledDefault
      this.world  = null
      this._stateT = 0
      this._countStep = -1
      // Star Power slow-mo request (see _tick's arbitration).
      this._slowMoT = 0
      this._slowMoScale = 1

      this.sm = new GameStateMachine()
      this._registerStates()
      this._wireEvents()

      this._resetWorld()
      this.sm.transition(STATE.MENU)
      this.loop.start(dt => this._tick(dt))
    }

    get state() { return this.sm.current }
    isPlaying() { return this.sm.is(STATE.PLAYING) }

    // ── States ──────────────────────────────────────────────────────────

    _registerStates() {
      const TUNING = F.defs.TUNING
      const UI     = F.defs.UI

      this.sm.register(STATE.MENU, {
        onEnter: () => {
          this._resetWorld()
          this.ui.showMenu()
          this.ui.setSelectedDifficulty(this.difficultyId)
        },
      })

      this.sm.register(STATE.SETUP, {
        onEnter: () => {
          this.ui.showSetup()
          this.ui.setSelectedShape(this.formationShape)
          this.ui.setStarPowerVisible(this.starEnabled)
          this.ui.setSelectedPower(this.starPowerId)
        },
      })

      this.sm.register(STATE.KICKOFF, {
        onEnter: (payload, prev) => {
          if (prev === STATE.MENU || prev === STATE.SETUP || prev === STATE.OVER) this._resetMatch()
          this._placeKickoff()
          // Snap the camera to the kickoff spot — a fresh match shouldn't
          // open with a pan across the whole stadium.
          this._cam.x = this.world.ball.x
          this._cam.y = this.world.ball.y
          this.ui.showPlaying()
          this._stateT = 0
          this._countStep = -1
        },
      })

      this.sm.register(STATE.PLAYING, {
        onEnter: () => { this.world.freeze = false },
        onExit:  () => { this.world.freeze = true },
      })

      this.sm.register(STATE.GOAL, {
        onEnter: ({ scoringTeam }) => {
          this._stateT = 0
          this._pendingAfterGoal = null
          const w = this.world
          if (scoringTeam === 'player') w.score.player++
          else w.score.enemy++

          this._setTeamMood(scoringTeam, 'victory')
          this._setTeamMood(scoringTeam === 'player' ? 'enemy' : 'player', 'losing')
          this._crowdReact(scoringTeam)
          this.ui.toast(
            scoringTeam === 'player' ? UI.toasts.playerGoal : UI.toasts.enemyGoal,
            { ms: TUNING.match.goalPauseSeconds * 1000, cls: scoringTeam === 'player' ? 'fx-toast--goal' : 'fx-toast--enemy-goal' },
          )
          if (w.suddenDeath) this._pendingAfterGoal = STATE.OVER
        },
        onExit: () => {
          this._setTeamMood('player', null)
          this._setTeamMood('enemy', null)
        },
      })

      this.sm.register(STATE.RESET, {
        onEnter: () => {
          this._placeKickoff()
          this._stateT = 0
        },
      })

      this.sm.register(STATE.OVER, {
        onEnter: () => {
          const w = this.world
          const outcome = w.score.player > w.score.enemy ? 'win'
            : w.score.player < w.score.enemy ? 'lose' : 'draw'
          if (outcome === 'draw') {
            // Sporting applause on both sides; nobody sulks over a draw.
            for (const fan of w.fans) { fan.mood = 'cheer'; fan.moodT = 2; fan.anim.t = 0 }
          } else {
            const winner = outcome === 'win' ? 'player' : 'enemy'
            const loser  = outcome === 'win' ? 'enemy'  : 'player'
            this._setTeamMood(winner, 'victory')
            this._setTeamMood(loser, 'losing')
            this._crowdReact(winner, 4)
          }
          this.ui.showOver({ outcome, scoreLine: `${w.score.player} - ${w.score.enemy}` })
          this._signalGameCompleted(outcome, w.score)
        },
      })

      this.sm.register(STATE.PAUSED, {
        onEnter: () => this.ui.showPaused(),
        onExit:  () => this.ui.hidePaused(),
      })
    }

    _wireEvents() {
      const STAR = F.defs.STAR
      this.events.on('goal', ({ scoringTeam }) => {
        if (this.sm.is(STATE.PLAYING)) {
          this._gainMeter(scoringTeam, STAR.meter.gains.goal)
          this._gainMeter(scoringTeam === 'player' ? 'enemy' : 'player', STAR.meter.gains.concede)
          this.sm.transition(STATE.GOAL, { scoringTeam })
        }
      })
      // Big hits get the crowd going even without a goal — and a hard kick by
      // a Screamer-armed team is the pierce trigger.
      this.events.on('kick', ({ by, power }) => {
        if (!this.sm.is(STATE.PLAYING)) return
        if (power > 200) this._crowdReact(by.team, 1.2)
        const star = this.world.star
        const armed = star?.active[by.team]
        if (armed && armed.id === 'screamer' && power >= STAR.powers.screamer.minShotPower) {
          star.pendingPierce = { team: by.team }
        }
      })
      // ── Star Power meter: good play charges the crowd ──────────────────
      this.events.on('pass-completed', ({ from, bypassed }) => {
        this._gainMeter(from.team, bypassed > 0 ? STAR.meter.gains.passBypass : STAR.meter.gains.pass)
      })
      this.events.on('tackle', ({ by, hit }) => {
        if (hit) this._gainMeter(by.team, STAR.meter.gains.cleanTackle)
      })
      this.events.on('shot-on-target', ({ by }) => {
        this._gainMeter(by.team, STAR.meter.gains.shotOnTarget)
        // Bait for a defending First Touch (enemy AI reacts to player shots).
        if (by.team === 'player' && this.world.star) this.world.star.threat = { t: 0.3 }
      })
      this.events.on('star-activated', ({ team, power }) => {
        this._slowMoT = STAR.slowMo.activation.seconds
        this._slowMoScale = STAR.slowMo.activation.scale
        this._crowdErupt(team)
        this.ui.toast(F.defs.UI.toasts.starActivated[power],
          { ms: 1200, cls: team === 'player' ? 'fx-toast--star' : 'fx-toast--star-enemy' })
      })
      // Gaining possession pulls control to the new carrier — field players
      // only; the goalie's save/clear stays AI-driven.
      this.events.on('possession-changed', ({ to }) => {
        if (to.team === 'player' && !to.isGoalie && !to.isControlled)
          this._setControlled(to)
      })
      // J without the ball (controlInput emits) — switch to the player best
      // placed to challenge, PES-style, instead of the old fixed Shift cycle.
      this.events.on('switch-player', () => {
        if (this.sm.is(STATE.PLAYING)) this._switchNearestBall()
      })
    }

    /** Control the player-team outfielder nearest the ball's near-future spot
     *  (GK joins the candidates only while the ball threatens our box). */
    _switchNearestBall() {
      const FIELD = F.defs.FIELD
      const w = this.world
      const b = w.ball
      const lead = { x: b.x + b.vx * 0.3, y: b.y + b.vy * 0.3 }
      const inBox = FIELD.inPenaltyBox('player', b.x, b.y)
      const candidates = w.players.filter(p =>
        p.team === 'player' && p !== w.controlled && (!p.isGoalie || inBox))
      if (!candidates.length) return
      const next = candidates.reduce((a, c) =>
        Math.hypot(a.x - lead.x, a.y - lead.y) < Math.hypot(c.x - lead.x, c.y - lead.y) ? a : c)
      this._setControlled(next)
    }

    openSetup()  { this.sm.transition(STATE.SETUP) }
    startMatch() { this.sm.transition(STATE.KICKOFF) }
    toMenu()     { this.sm.transition(STATE.MENU) }

    /** Same-document host bridge: announce a match's start under its correlation id. */
    _signalGameStarted() {
      this.render.canvas.dispatchEvent(new CustomEvent('GamePlayStarted', {
        bubbles: true,
        composed: true,
        detail: { gameId: 'footie', correlationId: this._playCorrelationId },
      }))
    }

    /**
     * Host bridge (e.g. the Encore Games widget mounting this game inline):
     * announce the final result once per match so the host can record the
     * play. Same-document only — a bubbling, composed CustomEvent reaches a
     * listener on any ancestor the game's DOM is mounted under (canvas has no
     * descendants of its own, so composed:true is what lets it cross a Shadow
     * DOM boundary if the host used one).
     */
    _signalGameCompleted(outcome, score) {
      if (this._completedSignalled) return
      this._completedSignalled = true
      this.render.canvas.dispatchEvent(new CustomEvent('GamePlayCompleted', {
        bubbles: true,
        composed: true,
        detail: {
          gameId: 'footie',
          // 'draw' joined the outcomes with golden-goal overtime; `won` keeps
          // hosts that only branch on win/not-win working without string checks.
          outcome,
          won: outcome === 'win',
          score: score.player,
          opponentScore: score.enemy,
          correlationId: this._playCorrelationId,
        },
      }))
    }

    setDifficulty(id) {
      this.difficultyId = id
      try { localStorage.setItem(F.defs.TUNING.difficultyKey, id) } catch (e) { /* storage unavailable, e.g. file:// */ }
      this.ui.setSelectedDifficulty(id)
    }
    _loadDifficulty(fallback) {
      let saved = null
      try { saved = localStorage.getItem(F.defs.TUNING.difficultyKey) } catch (e) { /* storage unavailable, e.g. file:// */ }
      return F.defs.TUNING.difficulties[saved] ? saved : fallback
    }

    /** Team Management pick — rebuilds the world when the shape changed, so
     *  the roster on the pitch always matches the selection. */
    setFormationShape(id) {
      if (!F.defs.FORMATIONS.shapes[id]) return
      this.formationShape = id
      try { localStorage.setItem(F.defs.FORMATIONS.storageKey, id) } catch (e) { /* storage unavailable, e.g. file:// */ }
      if (this.world && this.world.formationShape !== id) this._resetWorld()
      this.ui.setSelectedShape(id)
    }
    _loadFormation(fallback) {
      let saved = null
      try { saved = localStorage.getItem(F.defs.FORMATIONS.storageKey) } catch (e) { /* storage unavailable, e.g. file:// */ }
      return F.defs.FORMATIONS.shapes[saved] ? saved : fallback
    }

    /** Team Management pick — the star power the player brings to kickoff. */
    setStarPower(id) {
      if (!F.defs.STAR.powers[id]) return
      this.starPowerId = id
      try { localStorage.setItem(F.defs.STAR.storageKey, id) } catch (e) { /* storage unavailable, e.g. file:// */ }
      if (this.world?.star) this.world.star.power.player = id
      this.ui.setSelectedPower(id)
    }
    _loadStarPower(fallback) {
      let saved = null
      try { saved = localStorage.getItem(F.defs.STAR.storageKey) } catch (e) { /* storage unavailable, e.g. file:// */ }
      return F.defs.STAR.powers[saved] ? saved : fallback
    }

    // ── World lifecycle ─────────────────────────────────────────────────

    _resetWorld() {
      const { createThing } = F.things
      const TEAM_DEFS  = F.defs.TEAM_DEFS
      const FORMATIONS = F.defs.FORMATIONS

      // The player team fields the chosen shape; the enemy always fields the
      // default shape (and plays balanced) — see docs/initial.md addendum.
      const players = []
      for (const team of ['player', 'enemy'])
        for (const def of TEAM_DEFS.rosterFor(team, this._shapeFor(team)))
          players.push(createThing(def))

      const ball = createThing(F.defs.BALL_DEF)

      this.world = {
        players,
        ball,
        fans: this._createFans(),
        score: { player: 0, enemy: 0 },
        timeLeft: this.config.match.timeSeconds,
        suddenDeath: false,
        otLeft: 0,
        formation: 'balanced',
        formationShape: this.formationShape,
        controlled: null,
        control: {},        // the controlled player's charge/aim state (controlInput)
        timeScale: 1,       // computed per tick; behaviors read, never write
        clock: 0,
        freeze: true,
        tactics: { player: { lastCalc: -1 }, enemy: { lastCalc: -1 } },
        // Star Power state — null when the host disabled the system, which is
        // what gates the starPower behavior, the meter and the crowd heat.
        star: this.starEnabled ? {
          meter: { player: 0, enemy: 0 },
          power: { player: this.starPowerId, enemy: F.defs.STAR.defaultPower },
          active: { player: null, enemy: null },
          ghostAim: null,
          pendingPierce: null,
          threat: null,
          enemyAI: { checkT: 0 },
          fx: [],
        } : null,
      }
      this._setControlled(this._playerByRole(FORMATIONS.shiftCycle[this.formationShape][0]))
      this._placeKickoff()
    }

    _shapeFor(team) {
      return team === 'player' ? this.formationShape : F.defs.FORMATIONS.defaultShape
    }

    _playerByRole(role) {
      return this.world
        ? this.world.players.find(p => p.team === 'player' && p.role === role)
        : null
    }

    _resetMatch() {
      const w = this.world
      w.score = { player: 0, enemy: 0 }
      w.timeLeft = this.config.match.timeSeconds
      w.suddenDeath = false
      w.otLeft = 0
      w.formation = 'balanced'
      if (w.star) {
        const order = F.defs.STAR.order
        w.star.meter = { player: 0, enemy: 0 }
        w.star.power.player = this.starPowerId
        w.star.power.enemy = order[Math.floor(Math.random() * order.length)]
        w.star.active = { player: null, enemy: null }
        // Tell the player what they're up against, once per match.
        const label = F.defs.UI.setup.powers.find(p => p.id === w.star.power.enemy)?.label ?? w.star.power.enemy
        this.ui.toast(F.defs.UI.toasts.enemyStarPrefix + label, { ms: 1800, cls: 'fx-toast--star-enemy' })
      }
      this._setTeamMood('player', null)
      this._setTeamMood('enemy', null)
      this._setControlled(this._playerByRole(F.defs.FORMATIONS.shiftCycle[this.formationShape][0]))
      // Host bridge (e.g. the Encore Games widget mounting this game inline):
      // a fresh correlation id per match lets the host tie a GamePlayStarted
      // to its eventual GamePlayCompleted and dedupe a repeated completion
      // signal; re-armed here on every new match, with a started signal fired
      // under the new id.
      this._playCorrelationId = FootieGame._makeCorrelationId()
      this._completedSignalled = false
      this._signalGameStarted()
    }

    static _makeCorrelationId() {
      return window.crypto?.randomUUID?.()
        ?? `footie-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`
    }

    _placeKickoff() {
      const FIELD      = F.defs.FIELD
      const FORMATIONS = F.defs.FORMATIONS
      const w = this.world
      for (const p of w.players) {
        const spot = FORMATIONS.kickoff[this._shapeFor(p.team)][p.role]
        const pos  = FIELD.normFor(p.team, spot.x, spot.y)
        p.x = pos.x; p.y = pos.y
        p.vx = 0; p.vy = 0
        p.moveTarget = null
        p.moveDir = null
        p.sprinting = false
        p.faceX = p.team === 'player' ? 1 : -1
        p.faceY = 0
        p.downT = 0
        p.downImmuneT = 0
        p.frozenT = 0
        p.slide = null
        p.hasBall = false
        p.kickCooldown = 0
        p.kickAnimT = 0
        p.flipX = p.team === 'enemy'
        p.aiRole = 'Support'
      }
      const ball = w.ball
      ball.x = FIELD.center.x; ball.y = FIELD.center.y
      ball.vx = 0; ball.vy = 0
      ball.z = 0; ball.vz = 0
      ball.curve = 0
      ball.pierceT = 0
      ball.frozenT = 0
      ball.frozenStash = null
      ball.lastKicker = null
      ball.owner = null
      ball.lastTouchedTeam = null
      ball.noPickupBy = null
      ball.pressure = null
      ball.stealImmunityT = 0
      w.tactics.player.lastCalc = -1
      w.tactics.enemy.lastCalc = -1
      w.control = {}
      if (w.star) {
        // Meters deliberately SURVIVE goals — only live effects clear.
        w.star.active = { player: null, enemy: null }
        w.star.ghostAim = null
        w.star.pendingPierce = null
        w.star.threat = null
        w.star.fx = []
      }
      w.freeze = true
    }

    _createFans() {
      const { createThing } = F.things
      const layout   = F.defs.STADIUM_LAYOUT
      const variants = F.defs.SPRITE_DEF.fanVariants
      const fans = []
      const worldW = F.defs.FIELD.world.w
      const mid = worldW / 2
      for (const row of layout.fanRows) {
        for (let x = row.inset; x <= worldW - row.inset; x += row.spacing) {
          const side = x < mid ? 'red' : 'teal'
          const pool = variants[side]
          fans.push(createThing(F.defs.FAN_DEF, {
            x: x + Math.floor(Math.random() * 9) - 4,
            y: row.footY,
            side,
            variant: pool[Math.floor(Math.random() * pool.length)],
            phase: Math.random() * 4,
            flipX: Math.random() < 0.5,
          }))
        }
      }
      return fans
    }

    // ── Controlled player / formation ───────────────────────────────────

    _setControlled(thing) {
      for (const p of this.world.players) p.isControlled = false
      thing.isControlled = true
      this.world.controlled = thing
    }

    _cycleControlled() {
      const FIELD = F.defs.FIELD
      const w = this.world
      const cycle = [...F.defs.FORMATIONS.shiftCycle[w.formationShape]]
      // The goalie joins the cycle while the ball threatens our box.
      if (FIELD.inPenaltyBox('player', w.ball.x, w.ball.y)) cycle.push('GK')
      const mates = cycle.map(role => w.players.find(p => p.team === 'player' && p.role === role))
      const idx = mates.indexOf(w.controlled)
      this._setControlled(mates[(idx + 1) % mates.length])
    }

    _cycleFormation() {
      const FORMATIONS = F.defs.FORMATIONS
      const w = this.world
      const modes = FORMATIONS.modes
      w.formation = modes[(modes.indexOf(w.formation) + 1) % modes.length]
      this.ui.formationToast(FORMATIONS.modeLabels[w.formation])
    }

    _setTeamMood(team, mood) {
      for (const p of this.world.players) if (p.team === team) p.mood = mood
    }

    /** Fans of `team` cheer, the other side boos. */
    _crowdReact(team, seconds = 2.5) {
      const cheerSide = team === 'player' ? 'red' : 'teal'
      for (const fan of this.world.fans) {
        fan.mood  = fan.side === cheerSide ? 'cheer' : 'boo'
        fan.moodT = seconds + Math.random() * 0.6
        fan.moodFps = null
        fan.anim.t = 0
      }
    }

    /** Meter accrual — playing only; crossing full triggers the eruption. */
    _gainMeter(team, amount) {
      const star = this.world.star
      if (!star || !this.sm.is(STATE.PLAYING)) return
      const STAR = F.defs.STAR
      const before = star.meter[team]
      star.meter[team] = Math.min(STAR.meter.max, before + amount)
      if (before < STAR.meter.max && star.meter[team] >= STAR.meter.max) {
        this.events.emit('star-ready', { team })
        this._crowdErupt(team)
        if (team === 'player') this.ui.toast(F.defs.UI.toasts.starReady, { ms: 1400, cls: 'fx-toast--star' })
      }
    }

    /** One side's stand erupts (their meter filled / their power fired);
     *  the rival block jeers back. */
    _crowdErupt(team) {
      const STAR = F.defs.STAR
      const cheerSide = team === 'player' ? 'red' : 'teal'
      for (const fan of this.world.fans) {
        if (fan.side === cheerSide) {
          fan.mood = 'cheer'
          fan.moodT = STAR.audience.eruption.seconds + Math.random() * 0.6
          fan.moodFps = STAR.audience.eruption.fps
        } else {
          fan.mood = 'boo'
          fan.moodT = STAR.audience.rivalBoo.seconds + Math.random() * 0.4
          fan.moodFps = null
        }
        fan.anim.t = 0
      }
    }

    // ── Tick ────────────────────────────────────────────────────────────

    _tick(dt) {
      const TUNING = F.defs.TUNING
      const w = this.world

      // Slow motion — single owner, two sources: a held precise-shot charge
      // (world.control.k.precise, set by controlInput) and a Star Power beat
      // (this._slowMoT, set by the star event wiring). Only the WORLD slows:
      // behaviors get scaled dt, while state timers, the match clock, the
      // camera and the HUD keep wall time.
      this._slowMoT = Math.max(0, this._slowMoT - dt)
      const preciseScale = w.control?.k?.precise ? TUNING.shot.precise.timeScale : 1
      const starScale    = this._slowMoT > 0 ? this._slowMoScale : 1
      w.timeScale = Math.min(preciseScale, starScale)
      const sdt = dt * w.timeScale
      w.clock += sdt

      this._handleKeys()
      this._updateStateTimers(dt)

      const ctx = {
        world: w,
        input: this.input.state,
        view: { toWorld: (cx, cy) => this.render.toWorld(cx, cy) },
        events: this.events,
        tuning: TUNING,
        field: F.defs.FIELD,
        difficulty: TUNING.difficulties[this.difficultyId],
      }
      this.behavior.update([...w.players, w.ball, ...w.fans], ctx, sdt)
      this.input.state.pressed.length = 0
      this.input.state.released.length = 0

      if (this.sm.is(STATE.PLAYING)) {
        if (!w.suddenDeath) {
          w.timeLeft -= dt
          if (w.timeLeft <= 0) this._onFullTime()
        } else {
          // Golden-goal overtime is hard-capped; running out means a draw.
          w.otLeft -= dt
          if (w.otLeft <= 0) { w.otLeft = 0; this.sm.transition(STATE.OVER) }
        }
      }

      // Crowd heat: the stands ARE the star meter — each side's idle bounce
      // tracks its team's charge (animateFan reads this).
      if (w.star) {
        const tiers = F.defs.STAR.audience.tiers
        const tierFor = m => tiers.reduce((acc, t) => (m >= t.at ? t : acc), tiers[0])
        w.crowdHeat = { red: tierFor(w.star.meter.player), teal: tierFor(w.star.meter.enemy) }
      } else {
        w.crowdHeat = null
      }

      this._updateCamera(dt)
      this.render.render({
        things: [...w.fans, ...w.players, w.ball],
        overlay: (octx, view) => F.game.paintOverlay(octx, view, w, F.defs),
      })
      if (w.star && !this.sm.is(STATE.MENU)) {
        this.ui.updateStarMeter(w.star.meter.player, w.star.meter.enemy,
          w.star.meter.player >= F.defs.STAR.meter.max)
      }
      if (!this.sm.is(STATE.MENU)) {
        this.ui.updateHUD({
          playerScore: w.score.player,
          enemyScore: w.score.enemy,
          timeLeft: w.suddenDeath ? w.otLeft : w.timeLeft,
          formationLabel: `${F.defs.FORMATIONS.shapes[w.formationShape].label} · ${F.defs.FORMATIONS.modeLabels[w.formation]}`,
          suddenDeath: w.suddenDeath,
        })
      }
    }

    /**
     * The camera chases the ball (the menu backdrop parks at midfield),
     * exponentially smoothed; RenderEngine.setCamera clamps the window to
     * the world so the pan stops at the touchline stands.
     */
    _updateCamera(dt) {
      const FIELD = F.defs.FIELD
      const target = this.sm.is(STATE.MENU)
        ? FIELD.center
        : { x: this.world.ball.x, y: this.world.ball.y }
      const k = Math.min(1, F.defs.TUNING.camera.lerpPerSecond * dt)
      this._cam.x += (target.x - this._cam.x) * k
      this._cam.y += (target.y - this._cam.y) * k
      this.render.setCamera(this._cam.x - FIELD.view.w / 2, this._cam.y - FIELD.view.h / 2)
    }

    _handleKeys() {
      for (const key of this.input.state.pressed) {
        if (key === 'alt' && this.sm.is(STATE.PLAYING)) this._cycleFormation()
        else if (key === 'escape') {
          if (this.sm.is(STATE.PLAYING)) this.sm.transition(STATE.PAUSED)
          else if (this.sm.is(STATE.PAUSED)) this.sm.transition(STATE.PLAYING)
        }
      }
    }

    _updateStateTimers(dt) {
      const TUNING = F.defs.TUNING
      const UI     = F.defs.UI
      this._stateT += dt

      if (this.sm.is(STATE.KICKOFF)) {
        const step = Math.floor(this._stateT / TUNING.match.kickoffStepSeconds)
        if (step !== this._countStep && step < UI.toasts.countdown.length) {
          this._countStep = step
          this.ui.toast(UI.toasts.countdown[step], { ms: TUNING.match.kickoffStepSeconds * 900, cls: 'fx-toast--count' })
        }
        if (step >= UI.toasts.countdown.length) this.sm.transition(STATE.PLAYING)
      } else if (this.sm.is(STATE.GOAL)) {
        if (this._stateT >= TUNING.match.goalPauseSeconds)
          this.sm.transition(this._pendingAfterGoal ?? STATE.RESET)
      } else if (this.sm.is(STATE.RESET)) {
        if (this._stateT >= TUNING.match.resetCountdownSeconds) {
          this.ui.toast(UI.toasts.countdown[UI.toasts.countdown.length - 1], { ms: 500, cls: 'fx-toast--count' })
          this.sm.transition(STATE.PLAYING)
        }
      }
    }

    _onFullTime() {
      const w = this.world
      w.timeLeft = 0
      if (w.score.player === w.score.enemy && this.config.match.suddenDeathEnabled) {
        // Golden goal: a capped overtime — first goal wins, running out = draw.
        w.suddenDeath = true
        w.otLeft = F.defs.TUNING.match.goldenGoalSeconds
        this.ui.toast(F.defs.UI.toasts.goldenGoal, { ms: 1600, cls: 'fx-toast--golden' })
      } else {
        this.sm.transition(STATE.OVER)
      }
    }
  }

  F.game.STATE      = STATE
  F.game.FootieGame = FootieGame
})()

// ---- src/main.js ----
;(function () {
  'use strict'
  const F = window.Footie

  /**
   * Boot the game scoped to `root` — either `document` (the standalone page,
   * which already ships the #app shell) or a ShadowRoot an embedding host's
   * mount() built the shell into. `root.getElementById`/`querySelector` work
   * identically on both (ShadowRoot has supported them for years).
   *
   * `config` is an already-RESOLVED runtime config (defs/configDefs.js):
   * omitted on the standalone page (pure defaults), or the validated merge of
   * a host's mount options (see mount.js).
   */
  function boot(root, config) {
    const canvas  = root.getElementById('game-canvas')
    const events  = new F.engine.EventBus()
    const tileset = new F.engine.TilesetEngine(F.defs.TILESET_DEF)
    const sheets  = new F.engine.SpriteSheetEngine(F.defs.SPRITE_DEF)
    const ui      = new F.game.UISystem(root)

    let game = null
    const input = new F.engine.InputEngine({
      blockTouchWhen: () => game !== null && game.isPlaying(),
      surface: canvas,
    })
    game = new F.game.FootieGame({ canvas, ui, input, events, tileset, sheets, config })
    F.game.instance = game   // debug/inspection hook

    ui.onStart          = () => game.openSetup()
    ui.onKickoff        = () => game.startMatch()
    ui.onSetupBack      = () => game.toMenu()
    ui.onRematch        = () => game.startMatch()
    ui.onMenu           = () => game.toMenu()
    ui.onDifficultyPick = id => game.setDifficulty(id)
    ui.onShapePick      = id => game.setFormationShape(id)
    ui.onPowerPick      = id => game.setStarPower(id)

    input.onKeyDown(e => {
      if (e.key !== 'Enter' || e.repeat) return
      const STATE = F.game.STATE
      if (game.state === STATE.MENU) game.openSetup()
      else if (game.state === STATE.SETUP || game.state === STATE.OVER) game.startMatch()
    })

    return game
  }

  F.boot = boot

  // Standalone: index.html already ships the #app shell — boot straight into
  // the document. An embedding host has no #app yet at this point; it calls
  // F.boot itself (via GameWorkshopGame.mount, see mount.js) once it has
  // built the shell, so this simply does nothing there.
  const standaloneApp = document.getElementById('app')
  if (standaloneApp !== null && document.getElementById('game-canvas') !== null) {
    boot(document)
  }
})()

// ---- src/embedShell.js ----
;(function () {
  'use strict'

  /**
   * The game's own DOM shell (the #app subtree) + its full stylesheet, for the
   * EMBEDDED (mounted) path only. mount.js builds SHELL_HTML inside a Shadow
   * DOM root and injects EMBED_CSS as that shadow root's own <style> — Shadow
   * DOM gives full style encapsulation in BOTH directions, so this can be a
   * verbatim copy of styles/main.css (including its `*`/`html,body` rules,
   * which simply match nothing inside a shadow tree — there is no <html>/
   * <body> element in there) with no risk of leaking onto the embedding host
   * page, and no risk of the host page's own styles bleeding in.
   *
   * The ONE real change from main.css: #app is `position:fixed; inset:0` there
   * (the standalone page IS the viewport), which would make an embedded
   * instance cover the whole browser window instead of just its widget. The
   * override at the bottom gives it a normal, bounded, in-flow box instead —
   * RenderEngine already sizes/letterboxes purely off the canvas's own
   * offsetWidth/offsetHeight via ResizeObserver, so no game logic depends on
   * this box being any particular size.
   *
   * Mirrors index.html's own #app markup + styles/main.css exactly (this is
   * the embedded path; the standalone page is untouched and keeps using its
   * own copies directly) — keep the two in sync when either changes.
   */

  const SHELL_HTML = `
<div id="app">
  <canvas id="game-canvas"></canvas>

  <div id="ui-root">
    <div id="screen-menu" class="screen screen--visible">
      <div class="menu-panel">
        <h1 id="menu-title" class="menu-title"></h1>
        <p id="menu-subtitle" class="menu-subtitle"></p>
        <p id="menu-keys" class="keys"></p>
        <p id="menu-difficulty-heading" class="menu-heading-small"></p>
        <div id="difficulty-select" class="difficulty-select"></div>
        <div class="menu-actions">
          <button type="button" id="btn-start" class="btn"><span class="btn__label"></span></button>
        </div>
      </div>
    </div>

    <div id="screen-setup" class="screen" hidden>
      <div class="menu-panel">
        <h2 id="setup-title" class="menu-title menu-title--small"></h2>
        <p id="setup-subtitle" class="menu-subtitle"></p>
        <p id="setup-shape-heading" class="menu-heading-small"></p>
        <div id="formation-select" class="difficulty-select"></div>
        <p id="setup-power-heading" class="menu-heading-small"></p>
        <div id="star-power-select" class="difficulty-select"></div>
        <p id="setup-power-blurb" class="power-blurb"></p>
        <div class="menu-actions">
          <button type="button" id="btn-kickoff" class="btn"><span class="btn__label"></span></button>
          <button type="button" id="btn-setup-back" class="btn btn--secondary"><span class="btn__label"></span></button>
        </div>
      </div>
    </div>

    <div id="screen-over" class="screen" hidden>
      <div class="menu-panel over-panel">
        <h2 id="over-heading" class="over-heading"></h2>
        <p id="over-score" class="over-score"></p>
        <div class="menu-actions">
          <button type="button" id="btn-rematch" class="btn"><span class="btn__label"></span></button>
          <button type="button" id="btn-menu" class="btn btn--secondary"><span class="btn__label"></span></button>
        </div>
      </div>
    </div>

    <div id="hud" hidden>
      <div id="hud-legend"></div>
      <div id="hud-score"></div>
      <div id="hud-clock"></div>
      <div id="hud-formation"></div>
      <div id="hud-star"><div id="hud-star-fill"></div><span id="hud-star-hint" hidden></span></div>
      <div id="hud-star-enemy"><div id="hud-star-enemy-fill"></div></div>
    </div>
    <div id="fx-layer"></div>
  </div>
</div>`

  const EMBED_CSS = `
/* Footie — cute irreverent pixel look. Chunky system fonts, no webfonts
   (must work offline over file://), no filters heavier than a text-shadow. */

:root {
  --grass: #79b043;
  --grass-dark: #4c7a28;
  --night: #12240f;
  --paper: #fdf6e3;
  --ink: #23301c;
  --red: #d5382f;
  --teal: #2fa7a0;
  --gold: #f4b942;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

html, body {
  height: 100%;
  overflow: hidden;
  background: var(--night);
  font-family: "Verdana", "Tahoma", sans-serif;
  user-select: none;
  -webkit-user-select: none;
}

#app { position: fixed; inset: 0; }

#game-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  cursor: crosshair;
  touch-action: none;
}

#ui-root { position: absolute; inset: 0; pointer-events: none; }
#ui-root .screen { pointer-events: auto; }

/* ── Screens ─────────────────────────────────────────────────────────── */

.screen {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(18, 36, 15, 0.55);
  opacity: 0;
  transition: opacity 160ms ease-out;
}
.screen--visible { opacity: 1; }
.screen[hidden] { display: none; }

.menu-panel {
  background: var(--paper);
  color: var(--ink);
  border: 4px solid var(--ink);
  border-radius: 4px;
  box-shadow: 0 6px 0 rgba(0, 0, 0, 0.45);
  padding: 28px 40px 32px;
  text-align: center;
  max-width: 420px;
}

.menu-title {
  font-size: 52px;
  letter-spacing: 6px;
  color: var(--grass-dark);
  text-shadow: 3px 3px 0 var(--gold), 6px 6px 0 rgba(0,0,0,0.15);
  margin-bottom: 4px;
}

/* Sub-screen headings (Team Management) — same look, less shouting. */
.menu-title--small { font-size: 30px; letter-spacing: 3px; }

.menu-subtitle { font-size: 13px; margin-bottom: 16px; opacity: 0.75; font-style: italic; }

.menu-heading-small {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 2px;
  opacity: 0.6;
  margin: 14px 0 6px;
}

.keys { display: flex; flex-direction: column; gap: 3px; font-size: 12px; }
.keys__line { display: flex; justify-content: space-between; gap: 24px; }
.keys__line strong { text-transform: uppercase; letter-spacing: 1px; }
.keys__line span { opacity: 0.75; }

.difficulty-select { display: flex; gap: 8px; justify-content: center; margin-bottom: 8px; }

.diff-btn {
  font: inherit;
  font-size: 12px;
  padding: 6px 14px;
  border: 2px solid var(--ink);
  border-radius: 3px;
  background: transparent;
  color: var(--ink);
  cursor: pointer;
}
.diff-btn--active { background: var(--grass); color: #fff; box-shadow: inset 0 -2px 0 rgba(0,0,0,0.25); }

/* Star Power blurb under the power picker (Team Management). */
.power-blurb { font-size: 11px; font-style: italic; opacity: 0.7; margin-top: 6px; min-height: 14px; }

.menu-actions { display: flex; gap: 10px; justify-content: center; margin-top: 16px; }

.btn {
  font: inherit;
  font-weight: bold;
  font-size: 16px;
  padding: 12px 26px;
  border: 3px solid var(--ink);
  border-radius: 4px;
  background: var(--red);
  color: #fff;
  cursor: pointer;
  box-shadow: 0 4px 0 rgba(0, 0, 0, 0.4);
  text-shadow: 1px 1px 0 rgba(0,0,0,0.35);
}
.btn:active { transform: translateY(2px); box-shadow: 0 2px 0 rgba(0, 0, 0, 0.4); }
.btn--secondary { background: #6b7261; }

/* ── Game over ───────────────────────────────────────────────────────── */

.over-heading { font-size: 38px; color: var(--grass-dark); text-shadow: 2px 2px 0 var(--gold); }
.over-heading--lose { color: var(--red); text-shadow: 2px 2px 0 rgba(0,0,0,0.2); }
.over-heading--draw { color: var(--ink); text-shadow: 2px 2px 0 rgba(0,0,0,0.15); }
.over-score { font-size: 22px; font-weight: bold; margin-top: 8px; }

/* ── HUD ─────────────────────────────────────────────────────────────── */

#hud {
  position: absolute;
  top: 10px;
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  pointer-events: none;
  color: #fff;
  text-shadow: 2px 2px 0 rgba(0, 0, 0, 0.55);
}
#hud-legend {
  position: absolute;
  top: 0;
  left: 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 10px;
  opacity: 0.75;
}
#hud-legend .keys__line { display: flex; justify-content: space-between; gap: 14px; }
#hud-legend strong { text-transform: uppercase; letter-spacing: 1px; }

#hud-score { font-size: 20px; font-weight: bold; letter-spacing: 1px; }
#hud-clock { font-size: 15px; font-weight: bold; color: var(--gold); }
#hud-formation { font-size: 11px; opacity: 0.85; text-transform: uppercase; letter-spacing: 1px; }

/* Star Power meters — chunky pixel bars, hard borders, no gradients. */
#hud-star {
  position: relative;
  width: 180px;
  height: 10px;
  margin-top: 4px;
  border: 2px solid rgba(0, 0, 0, 0.55);
  background: rgba(18, 36, 15, 0.6);
  pointer-events: none;
}
#hud-star-fill { height: 100%; width: 0%; background: var(--gold); }
#hud-star.hud-star--ready { animation: star-pulse 0.7s steps(2) infinite; }
#hud-star-hint {
  position: absolute;
  right: -46px;
  top: -2px;
  font-size: 9px;
  font-weight: bold;
  letter-spacing: 1px;
  color: var(--gold);
}
#hud-star-enemy {
  width: 120px;
  height: 4px;
  margin-top: 2px;
  border: 2px solid rgba(0, 0, 0, 0.45);
  background: rgba(18, 36, 15, 0.6);
  pointer-events: none;
}
#hud-star-enemy-fill { height: 100%; width: 0%; background: var(--teal); }
@keyframes star-pulse { 50% { box-shadow: 0 0 0 2px var(--gold); } }

/* ── FX toasts ───────────────────────────────────────────────────────── */

#fx-layer { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }

.fx-toast {
  position: absolute;
  left: 50%;
  top: 42%;
  transform: translate(-50%, -50%) scale(1);
  font-size: 56px;
  font-weight: bold;
  letter-spacing: 4px;
  color: #fff;
  text-shadow: 3px 3px 0 rgba(0, 0, 0, 0.5);
  animation: toast-pop 180ms ease-out;
  transition: opacity 350ms ease-out, transform 350ms ease-out;
}
.fx-toast--out { opacity: 0; transform: translate(-50%, -60%) scale(1.15); }

.fx-toast--goal        { color: var(--gold); font-size: 72px; }
.fx-toast--enemy-goal  { color: #ff6a5e; }
.fx-toast--count       { color: #fff; font-size: 64px; }
.fx-toast--golden      { color: var(--gold); font-size: 48px; }
.fx-toast--star        { color: var(--gold); font-size: 44px; }
.fx-toast--star-enemy  { color: #7ee4dd; font-size: 30px; }
.fx-toast--paused      { color: #fff; font-size: 40px; }
.fx-toast--formation {
  top: 24%;
  font-size: 22px;
  letter-spacing: 2px;
  color: #eaf6d9;
}

@keyframes toast-pop {
  from { transform: translate(-50%, -50%) scale(0.4); }
  to   { transform: translate(-50%, -50%) scale(1); }
}

/* ── Embedded-only override ─────────────────────────────────────────────
   Standalone's #app is position:fixed;inset:0 because that page IS the
   viewport. An embedding host's container is not the viewport — give #app a
   normal, bounded, in-flow box instead so the game only occupies its own
   widget area. 16:9 at three-pointer's own 960px width, for visual
   consistency across games embedded in the same arcade context; footie has
   no "native" size of its own to match (RenderEngine letterboxes to
   whatever box the canvas actually gets, so this figure is a presentation
   choice, not a functional constraint). */
#app {
  position: relative;
  width: 960px;
  max-width: 100%;
  aspect-ratio: 16 / 9;
  margin: 0 auto;
}`

  window.Footie.embedShell = { SHELL_HTML, EMBED_CSS }
})()

// ---- src/mount.js ----
;(function () {
  'use strict'

  /**
   * Embedding entry point. footie ships as ~30 separate classic scripts (no
   * ES modules, no bundler — runs from file:// for local dev), unlike
   * three-pointer's single esbuild bundle. The dist build
   * (tools/build-classic-game.mjs) concatenates them all — in the exact
   * order index.html loads them — into ONE file with this module appended
   * last, so the shipped dist/footie.bundle.js still satisfies the same
   * "one <script src>, exposes window.GameWorkshopGame.mount" contract an
   * embedding host (the Encore Games widget) already relies on for
   * three-pointer.
   *
   * Uses a Shadow DOM for the mounted instance: footie's ids/classes (#app,
   * #hud, .screen, .btn, ...) are generic enough to plausibly collide with
   * an embedding host's own markup, unlike three-pointer's unusual ones —
   * Shadow DOM gives real encapsulation in both directions (the host's CSS
   * can't bleed in, footie's CSS/ids can't bleed out) instead of relying on
   * every selector staying accidentally unique. The GamePlayCompleted event
   * is dispatched with composed:true (see FootieGame.js), which is exactly
   * what lets a bubbling event cross a shadow boundary and still reach a
   * listener on the light-DOM host container.
   */
  /**
   * @param {HTMLElement} container
   * @param {{config?: object}} [mountOptions] — `config` is the host's stored
   *   admin settings (nested; dot-path keys expanded host-side), the values
   *   its settings panel collected from this game's settings-manifest.json.
   *   Merged over the game's defaults and validated by defs/configDefs.js;
   *   ANY validation issue logs once and mounts on pure defaults instead of
   *   half-applying a broken config (the treasure-chest gate). No URL
   *   parameters are ever read — the host owns its URL.
   */
  const mount = (container, mountOptions) => {
    const F = window.Footie

    let config
    if (mountOptions && mountOptions.config !== undefined) {
      const { config: resolved, issues } = F.defs.CONFIG.resolve(mountOptions.config)
      if (issues.length > 0) {
        console.error('footie: host config rejected, mounting with defaults', issues)
        config = F.defs.CONFIG.defaults()
      } else {
        config = resolved
      }
    }

    const shadow = container.attachShadow({ mode: 'open' })

    const style = document.createElement('style')
    style.textContent = F.embedShell.EMBED_CSS
    shadow.appendChild(style)

    const wrapper = document.createElement('div')
    wrapper.innerHTML = F.embedShell.SHELL_HTML
    shadow.appendChild(wrapper)

    F.boot(shadow, config)
  }

  // `capabilities.hostBridge` tells a host this bundle honors mount options —
  // an older bundle would silently ignore them, which a host that passes
  // config must treat as a hard error rather than a quiet fallback.
  window.GameWorkshopGame = { capabilities: { hostBridge: true }, mount }
})()
