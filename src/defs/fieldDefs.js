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
