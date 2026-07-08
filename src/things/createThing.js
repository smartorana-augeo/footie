;(function () {
  'use strict'

  /**
   * The thingdef creator. Every entity — players, ball, fans — is built here
   * from its def: `def.init` supplies per-kind fields, `props` per-instance
   * overrides (position, variant, …), and behaviors are instantiated fresh
   * through the behavior creator so per-match behavior state never leaks
   * between matches.
   */
  window.Footie.things.createThing = function createThing(def, props = {}) {
    return {
      def,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      alive: true,
      anim: { name: 'idle', t: 0 },
      ...(def.init ? JSON.parse(JSON.stringify(def.init)) : {}),
      ...props,
      behaviors: (def.behaviors ?? []).map(window.Footie.behaviors.createBehavior),
    }
  }
})()
