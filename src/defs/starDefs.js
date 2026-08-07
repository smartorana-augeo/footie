;(function () {
  'use strict'

  /**
   * Star Power system — the crowd IS the meter. All params are pure data,
   * consumed by behaviors/implementations/starPower.js + FootieGame +
   * animateFan + StarFx. Meter fills from good play; a full crowd erupts
   * and Space spends it on the equipped power.
   */
  window.Footie.defs.STAR = {
    enabledDefault: true,
    defaultPower: 'screamer',
    order: ['screamer', 'firstTouch', 'ghostRun', 'flatFooted'],
    storageKey: 'footie-star-power',

    powers: {
      // Screamer: next hard shot within the window pierces and flattens field players.
      screamer:   { windowSeconds: 5, minShotPower: 220, speedMultiplier: 1.25,
                    knockdownSeconds: 1.1, hitRadius: 10, pierceSeconds: 2 },
      // First Touch: drags the loose ball to the activator — even mid-shot.
      firstTouch: { durationSeconds: 1.25, pullAccel: 420, maxRange: 160 },
      // Ghost Run: hold space, aim with movement keys, release to blink 15yd
      // with the ball — never into a goal box.
      ghostRun:   { distance: 120, holdMaxSeconds: 2.0, fieldMargin: 10,
                    goalAreaMargin: 8, trailSeconds: 0.4 },
      // Flat-Footed: freezes nearby opponents and the ball for a beat.
      flatFooted: { radius: 90, durationSeconds: 0.9 },
    },

    meter: {
      max: 100,
      gains: { pass: 6, passBypass: 9, cleanTackle: 12, shotOnTarget: 15, goal: 22, concede: 10 },
      bypassLaneWidth: 24,       // pass counts as "bypassing" opponents within this of its line
    },

    audience: {
      tiers: [                   // meter value → how much of the crowd is up, and how fast
        { at: 0,   fraction: 0.00, fps: 0  },
        { at: 25,  fraction: 0.15, fps: 4  },
        { at: 50,  fraction: 0.35, fps: 6  },
        { at: 75,  fraction: 0.60, fps: 8  },
        { at: 100, fraction: 1.00, fps: 10 },
      ],
      waveStaggerPerPx: 0.004,   // fans further along the stand start their wave later
      eruption: { seconds: 2.5, fps: 12 },   // full-meter / goal blowout
      rivalBoo: { seconds: 1.2 },
    },

    slowMo: {
      activation: { seconds: 0.35, scale: 0.45 },
      pass:       { seconds: 0.12, scale: 0.65 },   // subtle beat on pass release
    },

    enemyAI: {
      checkInterval: 0.5,
      screamerShotRangeMult: 1.6,     // AI shoots from further out with Screamer armed
      firstTouchReactChance: 0.6,     // chance the AI pulls a contested loose ball
      flatFootedPanicDist: 135,       // AI panic-freezes your attack inside this of goal
    },
  }
})()
