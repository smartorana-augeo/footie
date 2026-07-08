;(function () {
  'use strict'
  const F = window.Footie

  const STATE = {
    MENU:    'menu',
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
    /** @param {{canvas, ui, input, events, tileset, sheets}} deps */
    constructor({ canvas, ui, input, events, tileset, sheets }) {
      const { GameLoop, GameStateMachine, BehaviorEngine, RenderEngine } = F.engine
      const FIELD = F.defs.FIELD

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
        painters: F.things.painters,
        background: (ctx) => this.stadium.paint(ctx),
        tileset,
        sheets,
      })
      this.loop     = new GameLoop()
      this.behavior = new BehaviorEngine()

      this.difficultyId = this._loadDifficulty()
      this.world  = null
      this._stateT = 0
      this._countStep = -1

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

      this.sm.register(STATE.KICKOFF, {
        onEnter: (payload, prev) => {
          if (prev === STATE.MENU || prev === STATE.OVER) this._resetMatch()
          this._placeKickoff()
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
          const w   = this.world
          const won = w.score.player > w.score.enemy
          this._setTeamMood(won ? 'player' : 'enemy', 'victory')
          this._setTeamMood(won ? 'enemy' : 'player', 'losing')
          this._crowdReact(won ? 'player' : 'enemy', 4)
          this.ui.showOver({ won, scoreLine: `${w.score.player} - ${w.score.enemy}` })
        },
      })

      this.sm.register(STATE.PAUSED, {
        onEnter: () => this.ui.showPaused(),
        onExit:  () => this.ui.hidePaused(),
      })
    }

    _wireEvents() {
      this.events.on('goal', ({ scoringTeam }) => {
        if (this.sm.is(STATE.PLAYING)) this.sm.transition(STATE.GOAL, { scoringTeam })
      })
      // Big hits get the crowd going even without a goal.
      this.events.on('kick', ({ by, power }) => {
        if (power > 200 && this.sm.is(STATE.PLAYING))
          this._crowdReact(by.team, 1.2)
      })
    }

    startMatch() { this.sm.transition(STATE.KICKOFF) }
    toMenu()     { this.sm.transition(STATE.MENU) }

    setDifficulty(id) {
      this.difficultyId = id
      try { localStorage.setItem(F.defs.TUNING.difficultyKey, id) } catch (e) { /* storage unavailable, e.g. file:// */ }
      this.ui.setSelectedDifficulty(id)
    }
    _loadDifficulty() {
      let saved = null
      try { saved = localStorage.getItem(F.defs.TUNING.difficultyKey) } catch (e) { /* storage unavailable, e.g. file:// */ }
      return F.defs.TUNING.difficulties[saved] ? saved : F.defs.TUNING.defaultDifficulty
    }

    // ── World lifecycle ─────────────────────────────────────────────────

    _resetWorld() {
      const { createThing } = F.things
      const TEAM_DEFS = F.defs.TEAM_DEFS
      const FIELD     = F.defs.FIELD

      const players = []
      for (const team of ['player', 'enemy'])
        for (const def of TEAM_DEFS[team]) players.push(createThing(def))

      const ball = createThing(F.defs.BALL_DEF)

      this.world = {
        players,
        ball,
        fans: this._createFans(),
        score: { player: 0, enemy: 0 },
        timeLeft: F.defs.TUNING.match.timeSeconds,
        suddenDeath: false,
        formation: 'balanced',
        controlled: null,
        clock: 0,
        freeze: true,
        tactics: { player: { lastCalc: -1 }, enemy: { lastCalc: -1 } },
      }
      this._setControlled(players.find(p => p.team === 'player' && p.role === 'FW'))
      this._placeKickoff()
    }

    _resetMatch() {
      const TUNING = F.defs.TUNING
      const w = this.world
      w.score = { player: 0, enemy: 0 }
      w.timeLeft = TUNING.match.timeSeconds
      w.suddenDeath = false
      w.formation = 'balanced'
      this._setTeamMood('player', null)
      this._setTeamMood('enemy', null)
      this._setControlled(w.players.find(p => p.team === 'player' && p.role === 'FW'))
    }

    _placeKickoff() {
      const FIELD = F.defs.FIELD
      const w = this.world
      for (const p of w.players) {
        const pos = FIELD.normFor(p.team, FIELD.kickoff[p.role].x, FIELD.kickoff[p.role].y)
        p.x = pos.x; p.y = pos.y
        p.vx = 0; p.vy = 0
        p.moveTarget = null
        p.hasBall = false
        p.kickCooldown = 0
        p.kickAnimT = 0
        p.flipX = p.team === 'enemy'
        p.aiRole = 'Support'
      }
      const ball = w.ball
      ball.x = FIELD.center.x; ball.y = FIELD.center.y
      ball.vx = 0; ball.vy = 0
      ball.owner = null
      ball.lastTouchedTeam = null
      ball.noPickupBy = null
      ball.pressure = null
      ball.stealImmunityT = 0
      w.tactics.player.lastCalc = -1
      w.tactics.enemy.lastCalc = -1
      w.freeze = true
    }

    _createFans() {
      const { createThing } = F.things
      const layout   = F.defs.STADIUM_LAYOUT
      const variants = F.defs.SPRITE_DEF.fanVariants
      const fans = []
      const mid = F.defs.FIELD.world.w / 2
      for (const row of layout.fanRows) {
        for (let x = row.xStart; x <= row.xEnd; x += row.spacing) {
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
      const cycle = [...F.defs.TEAM_DEFS.shiftCycle]
      // The goalie joins the cycle while the ball threatens our box.
      if (FIELD.inPenaltyBox('player', w.ball.x, w.ball.y)) cycle.push('GK')
      const mates = cycle.map(role => w.players.find(p => p.team === 'player' && p.role === role))
      const idx = mates.indexOf(w.controlled)
      this._setControlled(mates[(idx + 1) % mates.length])
    }

    _cycleFormation() {
      const modes = F.defs.FORMATIONS.cycle
      const w = this.world
      w.formation = modes[(modes.indexOf(w.formation) + 1) % modes.length]
      this.ui.formationToast(F.defs.FORMATIONS[w.formation].label)
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
        fan.anim.t = 0
      }
    }

    // ── Tick ────────────────────────────────────────────────────────────

    _tick(dt) {
      const TUNING = F.defs.TUNING
      const w = this.world
      w.clock += dt

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
      this.behavior.update([...w.players, w.ball, ...w.fans], ctx, dt)
      this.input.state.pressed.length = 0

      if (this.sm.is(STATE.PLAYING)) {
        if (!w.suddenDeath) {
          w.timeLeft -= dt
          if (w.timeLeft <= 0) this._onFullTime()
        }
      }

      this.render.render({ things: [...w.fans, ...w.players, w.ball] })
      if (!this.sm.is(STATE.MENU)) {
        this.ui.updateHUD({
          playerScore: w.score.player,
          enemyScore: w.score.enemy,
          timeLeft: w.timeLeft,
          formationLabel: F.defs.FORMATIONS[w.formation].label,
          suddenDeath: w.suddenDeath,
        })
      }
    }

    _handleKeys() {
      for (const key of this.input.state.pressed) {
        if (key === 'Shift' && this.sm.is(STATE.PLAYING)) this._cycleControlled()
        else if (key === 'Alt' && this.sm.is(STATE.PLAYING)) this._cycleFormation()
        else if (key === 'Escape') {
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
      const TUNING = F.defs.TUNING
      const w = this.world
      w.timeLeft = 0
      if (w.score.player === w.score.enemy && TUNING.match.suddenDeathEnabled) {
        w.suddenDeath = true
        this.ui.toast(F.defs.UI.toasts.suddenDeath, { ms: 1600, cls: 'fx-toast--sudden' })
      } else {
        this.sm.transition(STATE.OVER)
      }
    }
  }

  F.game.STATE      = STATE
  F.game.FootieGame = FootieGame
})()
