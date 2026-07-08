;(function () {
  'use strict'
  const F = window.Footie

  const canvas  = document.getElementById('game-canvas')
  const events  = new F.engine.EventBus()
  const tileset = new F.engine.TilesetEngine(F.defs.TILESET_DEF)
  const sheets  = new F.engine.SpriteSheetEngine(F.defs.SPRITE_DEF)
  const ui      = new F.game.UISystem()

  let game = null
  const input = new F.engine.InputEngine({ blockTouchWhen: () => game !== null && game.isPlaying() })
  game = new F.game.FootieGame({ canvas, ui, input, events, tileset, sheets })
  F.game.instance = game   // debug/inspection hook

  ui.onStart          = () => game.startMatch()
  ui.onRematch        = () => game.startMatch()
  ui.onMenu           = () => game.toMenu()
  ui.onDifficultyPick = id => game.setDifficulty(id)

  input.onKeyDown(e => {
    if (e.key !== 'Enter' || e.repeat) return
    if (game.state === F.game.STATE.MENU || game.state === F.game.STATE.OVER) game.startMatch()
  })
})()
