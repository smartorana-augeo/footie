;(function () {
  'use strict'

  /**
   * Possessed-ball placement: the ball rides slightly ahead of its owner in
   * their movement direction, easing toward that spot so it lags a touch
   * and feels physical rather than glued. A carried ball is grounded — any
   * flight state is pinned off. A flattened carrier drops the ball (the
   * slide strike / poke usually freed it already; this is belt-and-braces).
   */
  window.Footie.behaviors.implementations.dribble = function dribble() {
    return {
      update(ball, ctx, dt) {
        const owner = ball.owner
        if (!owner) return

        if (owner.downT > 0) {
          // A carrier on the turf can't keep the ball: gentle release.
          owner.hasBall = false
          ball.owner = null
          ball.vx = owner.vx
          ball.vy = owner.vy
          return
        }

        // Carried balls stay on the deck with no residual flight state.
        ball.z = 0
        ball.vz = 0
        ball.curve = 0

        const speed = Math.hypot(owner.vx, owner.vy)
        let dirX, dirY
        if (speed > 4) {
          dirX = owner.vx / speed
          dirY = owner.vy / speed
        } else {
          dirX = owner.flipX ? -1 : 1
          dirY = 0
        }
        const off = ctx.tuning.ball.dribbleOffset
        const tx  = owner.x + dirX * off
        const ty  = owner.y + dirY * off - 2   // ball sits at the feet, a hair above the anchor line

        const ease = Math.min(1, 14 * dt)
        ball.x += (tx - ball.x) * ease
        ball.y += (ty - ball.y) * ease
        ball.vx = owner.vx
        ball.vy = owner.vy
      },
    }
  }
})()
