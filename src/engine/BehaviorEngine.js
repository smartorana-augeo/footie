;(function () {
  'use strict'

  /**
   * Runs every thing's attached behavior implementations each tick.
   * A behavior is anything with `update(thing, ctx, dt)`; outcomes are
   * signalled on ctx.events — behaviors never reach into UI or each other.
   */
  class BehaviorEngine {
    /**
     * @param {Iterable<object>} things
     * @param {{world: object, input: object, view: object, events: object, tuning: object}} ctx
     * @param {number} dt
     */
    update(things, ctx, dt) {
      for (const thing of things) {
        if (thing.alive === false) continue
        for (const behavior of thing.behaviors) behavior.update(thing, ctx, dt)
      }
    }
  }

  window.Footie.engine.BehaviorEngine = BehaviorEngine
})()
