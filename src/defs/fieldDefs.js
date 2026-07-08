;(function () {
  'use strict'

  /**
   * Field geometry — pure data, all in world art pixels (16px tiles).
   * Horizontal orientation per the sample reference: stands along the top,
   * player team defends the LEFT goal and attacks RIGHT; enemy mirrors.
   *
   * Normalized tactical coords: x 0.0 = own (left) goal line … 1.0 = enemy
   * (right) goal line, y 0.0 = top touchline … 1.0 = bottom touchline —
   * always from the PLAYER team's perspective; enemy positions mirror x.
   */
  const WORLD = { w: 480, h: 312 }

  // Stadium bands (see tilesetDefs layout): stands 0..64, wall 64..80,
  // pavement 80..96, grass 96..312.
  const GRASS = { x: 0, y: 96, w: WORLD.w, h: WORLD.h - 96 }

  // Playable field (the white touchlines). Ball and players are clamped to
  // this except where the ball crosses a goal mouth.
  const RECT = { x: 24, y: 112, w: 432, h: 184 }

  const centerY = RECT.y + RECT.h / 2          // 204
  const MOUTH_H = 56

  const FIELD = {
    world: WORLD,
    grass: GRASS,
    rect:  RECT,
    center: { x: RECT.x + RECT.w / 2, y: centerY },
    centerCircleRadius: 28,

    // Goal mouths sit ON the goal lines (left/right edges of rect).
    goalMouth: { top: centerY - MOUTH_H / 2, bottom: centerY + MOUTH_H / 2, h: MOUTH_H },
    goalDepth: 8,                               // net protrudes outside the field

    // Boxes, per side. Goalies live in (and are clamped to) the penalty box.
    penaltyBox: { depth: 60, top: centerY - 60, bottom: centerY + 60 },
    goalBox:    { depth: 24, top: centerY - 36, bottom: centerY + 36 },

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

  // Kickoff positions (normalized, player-team perspective; enemy mirrors).
  // Transposed from the spec's vertical layout to the horizontal field.
  FIELD.kickoff = {
    FW: { x: 0.42, y: 0.50 },
    ML: { x: 0.28, y: 0.32 },
    MR: { x: 0.28, y: 0.68 },
    DF: { x: 0.16, y: 0.50 },
    GK: { x: 0.05, y: 0.50 },
  }

  window.Footie.defs.FIELD = FIELD
})()
