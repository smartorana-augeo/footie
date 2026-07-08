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
    constructor() {
      const UI = F.defs.UI
      this.menuEl = document.getElementById(UI.screens.menu)
      this.overEl = document.getElementById(UI.screens.over)
      this.hudEl  = document.getElementById(UI.screens.hud)
      this.fxEl   = document.getElementById('fx-layer')

      this.hudScoreEl     = document.getElementById('hud-score')
      this.hudClockEl     = document.getElementById('hud-clock')
      this.hudFormationEl = document.getElementById('hud-formation')
      this.overHeadingEl  = document.getElementById('over-heading')
      this.overScoreEl    = document.getElementById('over-score')

      this.onStart          = () => {}
      this.onRematch        = () => {}
      this.onMenu           = () => {}
      this.onDifficultyPick = () => {}

      this._pausedToast = null
      this._lastHud = ''
      this._populateStaticCopy()
      this._wireButtons()
    }

    _populateStaticCopy() {
      const UI = F.defs.UI
      document.getElementById('menu-title').textContent    = UI.menu.title
      document.getElementById('menu-subtitle').textContent = UI.menu.subtitle
      document.getElementById('menu-difficulty-heading').textContent = UI.menu.difficultyHeading
      document.querySelector('#btn-start .btn__label').textContent   = UI.menu.startLabel
      document.querySelector('#btn-rematch .btn__label').textContent = UI.over.rematchLabel
      document.querySelector('#btn-menu .btn__label').textContent    = UI.over.menuLabel
      const keyLines = UI.menu.keys.map(([action, binding]) =>
        `<span class="keys__line"><strong>${action}</strong><span>${binding}</span></span>`
      ).join('')
      document.getElementById('menu-keys').innerHTML = keyLines
      document.getElementById('hud-legend').innerHTML = keyLines
    }

    _wireButtons() {
      const UI = F.defs.UI
      document.getElementById('btn-start').addEventListener('click', () => this.onStart())
      document.getElementById('btn-rematch').addEventListener('click', () => this.onRematch())
      document.getElementById('btn-menu').addEventListener('click', () => this.onMenu())

      const wrap = document.getElementById('difficulty-select')
      for (const d of UI.menu.difficulties) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'diff-btn'
        btn.dataset.id = d.id
        btn.textContent = d.label
        btn.addEventListener('click', () => this.onDifficultyPick(d.id))
        wrap.appendChild(btn)
      }
    }

    setSelectedDifficulty(id) {
      document.querySelectorAll('.diff-btn').forEach(b =>
        b.classList.toggle('diff-btn--active', b.dataset.id === id))
    }

    // ── Screens ─────────────────────────────────────────────────────────
    showMenu()    { this._show(this.menuEl); this._hide(this.overEl); this.hudEl.hidden = true }
    showPlaying() { this._hide(this.menuEl); this._hide(this.overEl); this.hudEl.hidden = false }
    showOver({ won, scoreLine }) {
      const UI = F.defs.UI
      this.overHeadingEl.textContent = won ? UI.over.win : UI.over.lose
      this.overHeadingEl.classList.toggle('over-heading--lose', !won)
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
