;(function () {
  'use strict'

  /**
   * Global gameplay tuning — pure data, straight from docs/initial.md's
   * "Recommended Constants". All speeds/distances are world art pixels
   * (16px tiles) and seconds. Never tune inside engines or behaviors.
   */
  window.Footie.defs.TUNING = {
    player: {
      radius: 5,                 // collision circle at the feet, not the 20×35 art
      maxSpeed: 90,
      acceleration: 600,
      stopRadius: 4,
      controlled: {              // the controlled player feels snappier, not overpowered
        speedMultiplier: 1.08,
        accelerationMultiplier: 1.15,
        stealResistanceMultiplier: 1.25,
      },
    },

    ball: {
      radius: 3,
      friction: 0.985,           // per 60Hz frame; applied as pow(friction, dt*60)
      maxSpeed: 260,
      pickupRadius: 9,
      dribbleOffset: 7,
      pickupMaxSpeed: 190,       // faster balls can only be caught by goalies / interceptors
      bounce: 0.55,              // light touchline bounce
    },

    kick: {
      minDistance: 20,           // pointer targets closer than this never kick
      cooldown: 0.25,
      passPower: 130,
      shotPower: 220,
      powerScale: 3,             // kickPower = clamp(distToTarget * scale, pass, shot)
      regrabDelay: 0.35,         // kicker can't instantly repossess their own kick
    },

    steal: {
      radius: 8,
      time: 0.30,                // AI carriers lose the ball after this much pressure
      controlledTime: 0.45,      // the controlled player gets longer
      stolenImmunity: 0.5,       // fresh owner can't be re-stolen from immediately
    },

    match: {
      timeSeconds: 120,
      suddenDeathEnabled: true,
      teamSize: 5,
      goalPauseSeconds: 1.5,
      resetCountdownSeconds: 1.0,
      kickoffStepSeconds: 0.7,   // per "3", "2", "1", "Go" step
    },

    ai: {
      roleRecalculateInterval: 0.25,
      passCooldown: 1.0,
      shotRange: 90,
      pressureRadius: 16,        // "I'm pressured" distance for carriers
      laneWidth: 12,             // opponents within this of the shot line block it
      goalieClearDelay: 0.6,     // goalie holds the ball briefly, then clears
      receiverBallSpeedMin: 40,  // slower balls aren't treated as passes in flight
    },

    anim: {
      runThreshold: 8,           // px/s
      kickDuration: 0.375,
      fps: { idle: 6, run: 10, kick: 24, victory: 8, losing: 6, cheer: 8, boo: 8 },
    },

    difficulties: {
      easy:   { speedMultiplier: 0.85, reactionDelay: 0.45, aimNoise: 22, passBias: 0.5 },
      normal: { speedMultiplier: 1.0,  reactionDelay: 0.25, aimNoise: 12, passBias: 1.0 },
      hard:   { speedMultiplier: 1.1,  reactionDelay: 0.10, aimNoise: 5,  passBias: 1.5 },
    },
    defaultDifficulty: 'normal',

    difficultyKey: 'footie-difficulty',
  }
})()
