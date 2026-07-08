;(function () {
  'use strict'

  /**
   * Soft circle-vs-circle push so players don't stack. Each player nudges
   * only itself out of overlaps (both parties run this, so pairs resolve
   * symmetrically); the controlled player yields less, per the spec's
   * "controlled player gets priority".
   */
  window.Footie.behaviors.implementations.separatePlayers = function separatePlayers() {
    return {
      update(thing, ctx, dt) {
        if (ctx.world.freeze) return
        const r = ctx.tuning.player.radius
        for (const other of ctx.world.players) {
          if (other === thing || other.alive === false) continue
          const dx = thing.x - other.x
          const dy = thing.y - other.y
          const dist = Math.hypot(dx, dy)
          const minDist = r * 2
          if (dist >= minDist || dist === 0) continue
          const overlap = minDist - dist
          const share = thing.isControlled ? 0.25 : other.isControlled ? 0.75 : 0.5
          // Soft push: resolve a fraction per frame so it never feels bouncy.
          const push = overlap * share * Math.min(1, 12 * dt)
          thing.x += (dx / dist) * push
          thing.y += (dy / dist) * push
        }
      },
    }
  }
})()
