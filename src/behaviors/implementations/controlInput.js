;(function () {
  'use strict'

  /**
   * Mouse control for the directly controlled player. The move target tracks
   * the hovering pointer at all times (converted to world space and clamped
   * to the field) — no button needed; on touch, dragging does the same.
   *
   * Kicking is on Space: with possession, Space kicks toward the pointer
   * when it's beyond KICK_MIN_DISTANCE, power scaling with distance
   * (short = soft pass, long = strong shot). Touch has no keyboard, so
   * there a press (tap) kicks instead.
   */
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)

  window.Footie.behaviors.implementations.controlInput = function controlInput() {
    return {
      update(thing, ctx) {
        if (!thing.isControlled || ctx.world.freeze) return
        const input = ctx.input
        if (input.pointerX === null) return

        const rect  = ctx.field.rect
        const world = ctx.view.toWorld(input.pointerX, input.pointerY)
        const target = {
          x: clamp(world.x, rect.x, rect.x + rect.w),
          y: clamp(world.y, rect.y, rect.y + rect.h),
        }
        thing.moveTarget = target

        const K = ctx.tuning.kick
        const wantsKick = input.pressed.includes(' ') ||
          (input.pointerDown && input.pointerType === 'touch')
        if (wantsKick && ctx.world.ball.owner === thing && thing.kickCooldown <= 0) {
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
