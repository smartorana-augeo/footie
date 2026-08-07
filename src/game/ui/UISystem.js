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
