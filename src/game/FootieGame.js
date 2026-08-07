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
