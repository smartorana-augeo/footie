;(function () {
  'use strict'

  /**
   * Thingdefs for the two 5-player teams and the ball — pure data.
   * Behaviors are referenced by name + params and instantiated fresh per
   * match by createThing (no state leaks between matches).
   *
   * Roles: FW forward, ML/MR midfielders, DF defender, GK goalie.
   * Shift cycles FW → ML → MR → DF (GK joins only when the ball is in the
   * player's own penalty box).
   */
  const FIELD_BEHAVIORS = [
    ['controlInput', {}],
    ['aiFieldPlayer', {}],
    ['moveToTarget', {}],
    ['separatePlayers', {}],
    ['animate', {}],
  ]
  const GOALIE_BEHAVIORS = [
    ['aiGoalie', {}],
    ['moveToTarget', {}],
    ['separatePlayers', {}],
    ['animate', {}],
  ]

  const ROLES = [
    { role: 'FW', label: 'Forward',          variant: 1 },
    { role: 'ML', label: 'Midfielder Left',  variant: 2 },
    { role: 'MR', label: 'Midfielder Right', variant: 3 },
    { role: 'DF', label: 'Defender',         variant: 4 },
    { role: 'GK', label: 'Goalie',           variant: 5 },
  ]

  const playerDef = (team, { role, label, variant }) => ({
    name: `${team}-${role}`,
    visual: { kind: 'fieldPlayer' },
    behaviors: role === 'GK' ? GOALIE_BEHAVIORS : FIELD_BEHAVIORS,
    init: {
      team,
      role,
      label,
      variant,
      isGoalie: role === 'GK',
      isControlled: false,
      hasBall: false,
      moveTarget: null,
      flipX: team === 'enemy',        // enemies face their attacking direction (left)
      kickCooldown: 0,
      kickAnimT: 0,
      mood: null,                     // 'victory' | 'losing' | null — set by the match FSM
      aiRole: 'Support',
      ai: { decisionT: 0, passCooldown: 0, weavePhase: Math.random() * Math.PI * 2 },
    },
  })

  window.Footie.defs.TEAM_DEFS = {
    player: ROLES.map(r => playerDef('player', r)),
    enemy:  ROLES.map(r => playerDef('enemy', r)),
    shiftCycle: ['FW', 'ML', 'MR', 'DF'],
  }

  window.Footie.defs.BALL_DEF = {
    name: 'ball',
    visual: { kind: 'ball' },
    behaviors: [
      ['possession', {}],
      ['ballPhysics', {}],
      ['dribble', {}],
    ],
    init: {
      owner: null,
      lastTouchedTeam: null,
      noPickupBy: null,   // {thing, t} — regrab delay after kicks
      stealImmunityT: 0,
      pressure: null,     // {by, t} — accumulating steal pressure on the owner
    },
  }

  window.Footie.defs.FAN_DEF = {
    name: 'fan',
    visual: { kind: 'fan' },
    behaviors: [['animateFan', {}]],
    init: { side: 'red', variant: 1, mood: 'idle', moodT: 0, phase: 0 },
  }
})()
