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
