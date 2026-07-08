;(function () {
  'use strict'

  /**
   * Mouse control for the directly controlled player. Click and click-drag
   * behave identically: while the button is down the move target tracks the
   * pointer (converted to world space and clamped to the field); on release
   * the last target sticks until reached or replaced.
   *
   * Kicking is automatic: with possession, a pointer target beyond
   * KICK_MIN_DISTANCE kicks toward it, power scaling with distance
   * (short = soft pass, long = strong shot). No separate kick button.
   */
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)

  window.Footie.behaviors.implementations.controlInput = function controlInput() {
    return {
      update(thing, ctx) {
        if (!thing.isControlled || ctx.world.freeze) return
        const input = ctx.input
        if (!input.pointerDown || input.pointerX === null) return

        const rect  = ctx.field.rect
        const world = ctx.view.toWorld(input.pointerX, input.pointerY)
        const target = {
          x: clamp(world.x, rect.x, rect.x + rect.w),
          y: clamp(world.y, rect.y, rect.y + rect.h),
        }
        thing.moveTarget = target

        const K = ctx.tuning.kick
        if (ctx.world.ball.owner === thing && thing.kickCooldown <= 0) {
          const dist = Math.hypot(target.x - thing.x, target.y - thing.y)
          if (dist > K.minDistance) {
            const power = clamp(dist * K.powerScale, K.passPower, K.shotPower)
            window.Footie.behaviors.helpers.kick(ctx, thing, target.x, target.y, power)
          }
        }
      },
    }
  }
})()
