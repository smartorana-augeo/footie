;(function () {
  'use strict'

  /**
   * Thingdefs for the two 11-player teams, the ball and the fans — pure
   * data plus the pure `rosterFor` factory the composition root calls when
   * building a world. Behaviors are referenced by name + params and
   * instantiated fresh per match by createThing (no state leaks between
   * matches).
   *
   * Rosters come from FORMATIONS.roster[shapeId] (10 outfield slots — role,
   * band, label, wide, kit variant) plus one goalie slot added here. Shift
   * cycling uses FORMATIONS.shiftCycle[shapeId] (GK joins only when the
   * ball is in the player's own penalty box — see FootieGame).
   */
  const FIELD_BEHAVIORS = [
    ['controlInput', {}],
    ['aiFieldPlayer', {}],
    ['slideTackle', {}],
    ['moveToTarget', {}],
    ['separatePlayers', {}],
    ['animate', {}],
  ]
  // Keepers never START a slide, but slideTackle is still on them: it is
  // the single owner of the downT/downImmuneT knockdown timers, and keepers
  // do get flattened (Screamer, stray slides).
  const GOALIE_BEHAVIORS = [
    ['aiGoalie', {}],
    ['slideTackle', {}],
    ['moveToTarget', {}],
    ['separatePlayers', {}],
    ['animate', {}],
  ]

  // The asset pack has exactly 10 outfield kit variants per team and no
  // dedicated keeper sheet, so the GK reuses an outfield kit — picked as
  // the sheet that reads most distinct at a glance (red: the multicolour
  // hair of pack (6); teal: the broad brown hairdo of pack (8)). The
  // keeper therefore twins with one outfield teammate's look; live with it
  // until the pack grows a keeper kit.
  const GK_VARIANT = { player: 6, enemy: 8 }

  const playerDef = (team, { role, band, label, wide, variant }) => ({
    name: `${team}-${role}`,
    visual: { kind: 'fieldPlayer' },
    behaviors: role === 'GK' ? GOALIE_BEHAVIORS : FIELD_BEHAVIORS,
    init: {
      team,
      role,
      band: band ?? (role === 'GK' ? 'GK' : undefined),
      label,
      variant,
      wide: wide ?? false,
      isGoalie: role === 'GK',
      isControlled: false,
      hasBall: false,
      moveTarget: null,
      moveDir: null,                  // unit direction — keyboard steering (controlInput)
      sprinting: false,
      faceX: team === 'player' ? 1 : -1,   // facing = aim; owned by moveToTarget
      faceY: 0,
      downT: 0,                       // flattened (slide/Screamer) — slideTackle ticks
      downImmuneT: 0,                 // just-up grace — can't be re-flattened yet
      frozenT: 0,                     // Flat-Footed statue — starPower ticks
      slide: null,                    // { phase, t, dirX, dirY, hit } — slideTackle owns
      flipX: team === 'enemy',        // enemies face their attacking direction (left)
      kickCooldown: 0,
      kickAnimT: 0,
      mood: null,                     // 'victory' | 'losing' | null — set by the match FSM
      aiRole: 'Support',
      ai: { decisionT: 0, passCooldown: 0, slideCooldownT: 0, weavePhase: Math.random() * Math.PI * 2 },
    },
  })

  window.Footie.defs.TEAM_DEFS = {
    /** 11 thingdefs for `team` in shape `shapeId`: 10 outfield + the GK. */
    rosterFor(team, shapeId) {
      const slots = window.Footie.defs.FORMATIONS.roster[shapeId]
      return [
        ...slots.map(slot => playerDef(team, slot)),
        playerDef(team, {
          role: 'GK', band: 'GK', label: 'Goalie',
          wide: false, variant: GK_VARIANT[team],
        }),
      ]
    },
  }

  window.Footie.defs.BALL_DEF = {
    name: 'ball',
    visual: { kind: 'ball' },
    behaviors: [
      ['starPower', {}],    // first: star effects land before possession/physics run
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
      z: 0,               // height above the turf (2.5D flight)
      vz: 0,
      curve: 0,           // lateral curve accel (precise shots); decays in flight
      pierceT: 0,         // Screamer: uncapped, flattening flight — starPower ticks
      frozenT: 0,         // Flat-Footed: ball statue — starPower ticks/thaws
      frozenStash: null,  // starPower's stashed velocity while frozen
      lastKicker: null,   // pass-completion credit; cleared on any transfer
      kickFromX: 0,       // where the last kick left the boot — pass-lane origin
      kickFromY: 0,
    },
  }

  window.Footie.defs.FAN_DEF = {
    name: 'fan',
    visual: { kind: 'fan' },
    behaviors: [['animateFan', {}]],
    init: { side: 'red', variant: 1, mood: 'idle', moodT: 0, phase: 0 },
  }
})()
