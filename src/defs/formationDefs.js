;(function () {
  'use strict'

  /**
   * Formation tables — pure data, from the spec's four modes, transposed to
   * the horizontal field. Anchors are normalized player-team coords
   * (x 0 = own goal … 1 = enemy goal; fieldDefs mirrors them for the enemy).
   *
   * Each role has an anchor for when its team HAS possession and one for
   * when it doesn't, plus per-axis ball-influence weights: the working
   * anchor slides by weight × (ball − field center), per the spec's
   * `formationTarget + ballInfluence` model. Alt cycles the `cycle` order;
   * the enemy team always plays `balanced`.
   */
  window.Footie.defs.FORMATIONS = {
    cycle: ['balanced', 'attack', 'defend', 'spread'],

    balanced: {
      label: 'Balanced',
      FW: { poss: { x: 0.72, y: 0.50 }, def: { x: 0.55, y: 0.50 }, pull: { x: 0.30, y: 0.35 } },
      ML: { poss: { x: 0.50, y: 0.30 }, def: { x: 0.40, y: 0.33 }, pull: { x: 0.25, y: 0.30 } },
      MR: { poss: { x: 0.50, y: 0.70 }, def: { x: 0.40, y: 0.67 }, pull: { x: 0.25, y: 0.30 } },
      DF: { poss: { x: 0.30, y: 0.50 }, def: { x: 0.20, y: 0.50 }, pull: { x: 0.12, y: 0.35 } },
    },

    attack: {
      label: 'Attack',
      FW: { poss: { x: 0.86, y: 0.50 }, def: { x: 0.65, y: 0.50 }, pull: { x: 0.25, y: 0.40 } },
      ML: { poss: { x: 0.68, y: 0.28 }, def: { x: 0.52, y: 0.31 }, pull: { x: 0.25, y: 0.25 } },
      MR: { poss: { x: 0.68, y: 0.72 }, def: { x: 0.52, y: 0.69 }, pull: { x: 0.25, y: 0.25 } },
      DF: { poss: { x: 0.50, y: 0.50 }, def: { x: 0.34, y: 0.50 }, pull: { x: 0.12, y: 0.30 } },
    },

    defend: {
      label: 'Defend',
      FW: { poss: { x: 0.60, y: 0.50 }, def: { x: 0.46, y: 0.50 }, pull: { x: 0.25, y: 0.35 } },
      ML: { poss: { x: 0.42, y: 0.30 }, def: { x: 0.29, y: 0.36 }, pull: { x: 0.20, y: 0.40 } },
      MR: { poss: { x: 0.42, y: 0.70 }, def: { x: 0.29, y: 0.64 }, pull: { x: 0.20, y: 0.40 } },
      DF: { poss: { x: 0.26, y: 0.50 }, def: { x: 0.15, y: 0.50 }, pull: { x: 0.08, y: 0.35 } },
    },

    spread: {
      label: 'Spread',
      FW: { poss: { x: 0.76, y: 0.50 }, def: { x: 0.56, y: 0.50 }, pull: { x: 0.25, y: 0.20 } },
      ML: { poss: { x: 0.55, y: 0.14 }, def: { x: 0.40, y: 0.20 }, pull: { x: 0.20, y: 0.10 } },
      MR: { poss: { x: 0.55, y: 0.86 }, def: { x: 0.40, y: 0.80 }, pull: { x: 0.20, y: 0.10 } },
      DF: { poss: { x: 0.30, y: 0.50 }, def: { x: 0.24, y: 0.50 }, pull: { x: 0.10, y: 0.25 } },
    },
  }
})()
