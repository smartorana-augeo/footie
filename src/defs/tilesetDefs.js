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
