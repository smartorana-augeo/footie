;(function () {
  'use strict'

  /** All player-facing copy — pure data; UISystem renders it. */
  window.Footie.defs.UI = {
    screens: { menu: 'screen-menu', over: 'screen-over', hud: 'hud' },

    menu: {
      title: 'FOOTIE',
      subtitle: 'a cute lil arcade kickabout',
      startLabel: 'Click to Start',
      difficultyHeading: 'difficulty',
      difficulties: [
        { id: 'easy',   label: 'Easy' },
        { id: 'normal', label: 'Normal' },
        { id: 'hard',   label: 'Hard' },
      ],
      keys: [
        ['move',      'click / drag'],
        ['switch',    'shift'],
        ['formation', 'alt'],
        ['pause',     'esc'],
      ],
    },

    hud: {
      teams: { player: 'Player', enemy: 'Enemy' },
      formationPrefix: 'Formation: ',
    },

    toasts: {
      playerGoal: 'GOAL!',
      enemyGoal: 'Enemy Goal',
      suddenDeath: 'SUDDEN DEATH',
      countdown: ['3', '2', '1', 'GO!'],
      paused: 'PAUSED',
    },

    over: {
      win: 'You Win!',
      lose: 'You Lose',
      rematchLabel: 'Rematch',
      menuLabel: 'Menu',
    },
  }
})()
