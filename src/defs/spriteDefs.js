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
