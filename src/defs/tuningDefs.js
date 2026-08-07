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
      sprintMultiplier: 1.35,       // shift-held top speed boost
      sprintAccelMultiplier: 1.1,   // sprint ramps up slightly quicker too
      controlled: {              // the controlled player feels snappier, not overpowered
        speedMultiplier: 1.08,
        accelerationMultiplier: 1.15,
        stealResistanceMultiplier: 1.25,
      },
    },

    ball: {
      radius: 3,
      friction: 0.985,           // per 60Hz frame; applied as pow(friction, dt*60)
      maxSpeed: 360,             // precise-shot headroom; cap applies to ground speed only, never vz
      pickupRadius: 9,
      dribbleOffset: 7,
      pickupMaxSpeed: 190,       // faster balls can only be caught by goalies / interceptors
      bounce: 0.55,              // light touchline bounce
    },

    kick: {
      cooldown: 0.25,
      regrabDelay: 0.35,         // kicker can't instantly repossess their own kick
    },

    input: { holdThreshold: 0.18 },   // J/K/L released sooner than this = tap

    pass: {
      coneHalfAngleDeg: 25,      // teammates inside this cone of the facing dir are pass targets
      coneRange: 260,            // farthest teammate a tap-pass will consider
      powerMin: 170,             // tap pass — reaches the next formation line
      powerMax: 250,             // fully-held pass — switches play across lines
      holdChargeTime: 0.45,      // hold this long for powerMax
      leadTime: 0.3,             // aim this far ahead of a moving receiver
      intoSpacePower: 200,       // no target in the cone → through-ball into space at this pace
    },

    shot: {
      tapPower: 270,             // quick tap — threatens from around the 18-yard-box edge
      aimMarginY: 6,             // tap shots aim inside the posts by this much
      precise: {                 // hold K: slow-mo aimed shot with charge + curve
        maxCharge: 0.6,          // full power/loft after holding this long
        timeScale: 0.45,         // world slows to this while aiming
        powerMin: 250,
        powerMax: 340,
        vzMin: 15,               // minimum loft — skims the turf
        vzMax: 85,               // full-charge loft — still under the crossbar in range
        curveRate: 260,          // lateral curve accel per second of steering input
        curveMax: 220,           // curve accel cap so screamers stay aimable
      },
    },

    lob: {
      chargeTime: 0.5,           // hold L this long for max distance
      powerMin: 150,             // tap lob — chip over one defender
      powerMax: 230,             // full lob — reaches the far post from midfield
      vzMin: 110,                // even a tap clears standing players
      vzMax: 155,                // full lob hangs long enough to run onto
    },

    ballAir: {
      gravity: 300,              // vz decay per second while airborne
      bounceZ: 0.5,              // vz kept per ground bounce
      bounceKill: 40,            // bounces slower than this stick to the turf
      airFrictionPerFrame: 0.999,     // airborne balls barely slow horizontally
      bounceGroundFriction: 0.85,     // ground speed lost on each bounce
      curveDecayPerFrame: 0.98,       // curve accel bleeds off over the flight
      crossbarZ: 21,             // 8 ft at 8 px/yd — shots above this bounce, never score
      pickupMaxZ: 12,            // outfielders can only trap below this
      goalieClaimZ: 26,          // keepers claim crosses up to here
    },

    aerial: {
      reach: 12,                 // horizontal radius to meet an airborne ball
      headerZMin: 12,            // ball height band for headers…
      headerZMax: 26,
      volleyZMin: 5,             // …and the lower band for volleys
      volleyZMax: 12,
      headerPower: 240,          // headers redirect, they don't rocket
      volleyPower: 310,          // volleys are near-shot pace
      bicyclePower: 330,         // bicycle kicks hit hardest…
      bicycleSelfDownT: 0.6,     // …but leave the kicker on the ground this long
    },

    knockOn: {
      speed: 210,                // above ball.pickupMaxSpeed: the touch genuinely ESCAPES —
                                 // nobody (carrier or defender) can trap it until it slows
      regrabDelay: 0.12,         // carrier's own no-touch window after the push
      interval: 0.45,            // seconds between touches while knocking on
    },

    slide: {
      speed: 150,                // lunge speed during the slide
      duration: 0.3,             // slide travel time
      reach: 10,                 // ball/carrier contact radius while sliding
      ballStrikePower: 165,      // a clean slide punts the ball away this hard —
                                 // under the keeper's 220 claim gate, so a slide
                                 // TOWARD a goal is savable, not a guaranteed score
      recoverMiss: 0.65,         // whiffed slide — long get-up
      recoverHit: 0.35,          // won the ball — quick get-up
      knockdownT: 0.8,           // carrier hit by a slide stays down this long
      downImmunity: 0.35,        // just-up players can't be flattened again yet
      screamerKnockdownT: 1.1,   // Screamer star shots keep victims down longer
      aiCooldown: 4,             // seconds between AI slide attempts
      aiRange: 22,               // AI only slides at carriers inside this
      aiChance: 0.15,            // per-attempt probability (× difficulty slideAggression)
    },

    poke: {
      radius: 12,                // ball must be this close to poke
      reach: 8,                  // poke nudges the ball this far ahead
      alignDeg: 35,              // must be facing within this of the ball
      speed: 120,                // poked-ball speed
    },

    steal: {
      radius: 8,
      time: 0.30,                // AI carriers lose the ball after this much pressure
      controlledTime: 0.45,      // the controlled player gets longer
      stolenImmunity: 0.5,       // fresh owner can't be re-stolen from immediately
    },

    match: {
      timeSeconds: 270,          // 4:30 regulation
      suddenDeathEnabled: true,  // now means golden-goal overtime
      goldenGoalSeconds: 30,     // overtime length — first goal wins
      goalPauseSeconds: 0.75,
      resetCountdownSeconds: 1.25,
      kickoffStepSeconds: 0.7,   // per "3", "2", "1", "Go" step
    },

    camera: {
      lerpPerSecond: 5,          // ball-chase smoothing; higher = tighter follow
    },

    ai: {
      roleRecalculateInterval: 0.25,
      passCooldown: 1.0,
      shotRange: 120,            // ~15 yd — shoot from around the box edge
      pressureRadius: 16,        // "I'm pressured" distance for carriers
      laneWidth: 12,             // opponents within this of the shot line block it
      goalieDistributeDelay: 1.25,   // keeper holds a claimed ball this long, then distributes
      goalieSafeRadius: 40,      // no opponents inside this → keeper rolls it out short
      receiverBallSpeedMin: 40,  // slower balls aren't treated as passes in flight
    },

    anim: {
      runThreshold: 8,           // px/s
      kickDuration: 0.375,
      fps: { idle: 6, run: 10, kick: 24, victory: 8, losing: 6, cheer: 8, boo: 8 },
    },

    difficulties: {
      // speedMultiplier deprecated: difficulty must not change movement speed —
      // kept for saved-config compat, no longer read.
      easy:   { speedMultiplier: 1.0, reactionDelay: 0.45, aimNoise: 22, passBias: 0.5, slideAggression: 0 },
      normal: { speedMultiplier: 1.0, reactionDelay: 0.25, aimNoise: 12, passBias: 1.0, slideAggression: 1.0 },
      hard:   { speedMultiplier: 1.0, reactionDelay: 0.08, aimNoise: 5,  passBias: 1.5, slideAggression: 1.6 },
    },
    defaultDifficulty: 'normal',

    difficultyKey: 'footie-difficulty',
  }
})()
