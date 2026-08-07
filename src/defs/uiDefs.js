;(function () {
  'use strict'

  /** All player-facing copy — pure data; UISystem renders it. */
  window.Footie.defs.UI = {
    screens: { menu: 'screen-menu', setup: 'screen-setup', over: 'screen-over', hud: 'hud' },

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
        ['move',       'wasd / arrows'],
        ['pass',       'j — hold: harder'],
        ['switch',     'j (no ball)'],
        ['shoot',      'k — hold: precise'],
        ['tackle',     'k (no ball)'],
        ['lob',        'l — hold: longer'],
        ['sprint',     'shift — knock-on with ball'],
        ['star power', 'space (when full)'],
        ['formation',  'alt'],
        ['pause',      'esc'],
      ],
    },

    setup: {
      title: 'Team Management',
      subtitle: 'pick your shape — Alt still switches tactics mid-match',
      shapeHeading: 'formation',
      powerHeading: 'star power',
      powers: [
        { id: 'screamer',   label: 'Screamer',    blurb: 'Charge up — your next shot flattens everyone in its path.' },
        { id: 'firstTouch', label: 'First Touch', blurb: 'Drag the loose ball to your feet — even mid-shot.' },
        { id: 'ghostRun',   label: 'Ghost Run',   blurb: 'Hold space, aim, release — blink past the line, ball and all.' },
        { id: 'flatFooted', label: 'Flat-Footed', blurb: 'Catch every opponent near you flat-footed for a beat.' },
      ],
      kickoffLabel: 'Kick Off',
      backLabel: 'Back',
    },

    hud: {
      teams: { player: 'Player', enemy: 'Enemy' },
      formationPrefix: 'Formation: ',
      starLabel: 'STAR',
      starReadyHint: 'SPACE',
    },

    toasts: {
      playerGoal: 'GOAL!',
      enemyGoal: 'Enemy Goal',
      goldenGoal: 'GOLDEN GOAL — 30 SECONDS',
      starReady: 'STAR POWER READY',
      starActivated: { screamer: 'SCREAMER!', firstTouch: 'FIRST TOUCH!', ghostRun: 'GHOST RUN!', flatFooted: 'FLAT-FOOTED!' },
      enemyStarPrefix: 'Enemy star: ',
      countdown: ['3', '2', '1', 'GO!'],
      paused: 'PAUSED',
    },

    over: {
      win: 'You Win!',
      lose: 'You Lose',
      draw: 'Draw',
      rematchLabel: 'Rematch',
      menuLabel: 'Menu',
    },
  }
})()
