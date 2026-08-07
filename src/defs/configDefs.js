;(function () {
  'use strict'
  const F = window.Footie

  /**
   * Host-configurable runtime config — the treasure-chest settings contract,
   * sized for a plain-JS score game.
   *
   * SETTINGS below is the single source of truth for every admin knob: it
   * drives BOTH the validation gate (`resolve`) and the published
   * settings-manifest.json (`buildSettingsManifest`, emitted by
   * tools/emit-settings-manifest.mjs), so the manifest can never drift from
   * the code. Defaults are READ FROM the other defs (TUNING / FORMATIONS /
   * UI), never duplicated as literals here.
   *
   * Flow: an embedding host (the Encore campaign admin) renders its Game
   * Settings panel from the published manifest, stores the chosen values,
   * and passes them back at `GameWorkshopGame.mount(container, { config })`
   * as a nested object (dot-path keys expanded host-side). `resolve` merges
   * them over `defaults()` and validates; ANY issue on a known key rejects
   * the whole config and the game mounts on pure defaults (mount.js logs the
   * issues). Unknown keys are ignored silently — hosts may send engine-shared
   * keys this game doesn't use. The game itself never fetches the manifest
   * (no fetch() — hard rule; games run from file://).
   */

  // Descriptor `default`/`options` are thunks so they read the live def
  // values at call time (configDefs loads after the defs it mirrors).
  const SETTINGS = [
    {
      key: 'match.timeSeconds',
      type: 'integer',
      label: 'Match length (seconds)',
      help: 'Regulation time before full-time. Sudden death may extend it.',
      min: 30, max: 600, step: 10,
      required: true,
      default: () => F.defs.TUNING.match.timeSeconds,
    },
    {
      key: 'match.suddenDeathEnabled',
      type: 'boolean',
      label: 'Golden goal overtime',
      help: 'When the score is level at full time, up to 30 seconds of overtime are played — next goal wins. If still level (or with this off), the match is a draw.',
      default: () => F.defs.TUNING.match.suddenDeathEnabled,
    },
    {
      key: 'difficulty',
      type: 'select',
      label: 'Default difficulty',
      help: 'The difficulty preselected for every player. Players can still change it on the menu.',
      options: () => F.defs.UI.menu.difficulties.map(d => ({ label: d.label, value: d.id })),
      default: () => F.defs.TUNING.defaultDifficulty,
    },
    {
      key: 'formation',
      type: 'select',
      label: 'Default formation',
      help: 'The team shape preselected on the Team Management screen. Players can still change it before kickoff.',
      options: () => F.defs.FORMATIONS.shapeOrder.map(id => ({ label: F.defs.FORMATIONS.shapes[id].label, value: id })),
      default: () => F.defs.FORMATIONS.defaultShape,
    },
    {
      key: 'starPowerEnabled',
      type: 'boolean',
      label: 'Star Power',
      help: 'Each side picks one special move charged by good play — the crowd heats up as it fills. Off hides the pick and the meter entirely.',
      default: () => F.defs.STAR.enabledDefault,
    },
    {
      key: 'starPower',
      type: 'select',
      label: 'Default star power',
      help: 'The star power preselected on the Team Management screen. Players can still change it before kickoff.',
      options: () => F.defs.UI.setup.powers.map(p => ({ label: p.label, value: p.id })),
      default: () => F.defs.STAR.defaultPower,
    },
  ]

  const getPath = (obj, key) =>
    key.split('.').reduce((o, part) => (o == null ? undefined : o[part]), obj)

  const setPath = (obj, key, value) => {
    const parts = key.split('.')
    let o = obj
    for (const part of parts.slice(0, -1)) o = o[part] ?? (o[part] = {})
    o[parts.at(-1)] = value
  }

  /** Pure defaults, `hostProvided: false` — what the standalone page boots on. */
  const defaults = () => {
    const config = { hostProvided: false }
    for (const s of SETTINGS) setPath(config, s.key, s.default())
    return config
  }

  const validate = (s, value) => {
    switch (s.type) {
      case 'integer':
        if (typeof value !== 'number' || !Number.isInteger(value)) return `${s.key}: expected an integer, got ${JSON.stringify(value)}`
        if (value < s.min || value > s.max) return `${s.key}: ${value} outside [${s.min}, ${s.max}]`
        return null
      case 'boolean':
        return typeof value === 'boolean' ? null : `${s.key}: expected a boolean, got ${JSON.stringify(value)}`
      case 'select': {
        const allowed = s.options().map(o => o.value)
        return allowed.includes(value) ? null : `${s.key}: ${JSON.stringify(value)} not one of ${allowed.join(', ')}`
      }
      default:
        return `${s.key}: unknown setting type ${s.type}`
    }
  }

  /**
   * Merge a host's (nested) config over defaults and validate every known
   * key. Absent keys keep their defaults (a partial config is fine — the
   * host stores only what the admin overrode); a PRESENT-but-invalid value
   * is an issue, and any issue means the caller must discard the whole
   * config (treasure-chest gate: broken configs never half-apply).
   * @returns {{ config: object, issues: string[] }}
   */
  const resolve = (hostConfig) => {
    const config = defaults()
    config.hostProvided = true
    const issues = []
    for (const s of SETTINGS) {
      const value = getPath(hostConfig, s.key)
      if (value === undefined || value === null) continue
      const issue = validate(s, value)
      if (issue) issues.push(issue)
      else setPath(config, s.key, value)
    }
    return { config, issues }
  }

  /** The settings-manifest.json content — written by tools/emit-settings-manifest.mjs. */
  const buildSettingsManifest = () => ({
    displayName: 'Footie',
    gameId: 'footie',
    schemaVersion: 1,
    sections: [
      {
        autoPopulate: false,
        entries: SETTINGS.map(s => {
          const entry = {
            default: s.default(),
            help: s.help,
            key: s.key,
            label: s.label,
            type: s.type,
          }
          if (s.min !== undefined) entry.min = s.min
          if (s.max !== undefined) entry.max = s.max
          if (s.step !== undefined) entry.step = s.step
          if (s.options) entry.options = s.options()
          if (s.required) entry.required = true
          return entry
        }),
        kind: 'settings',
        title: 'Match rules',
      },
    ],
  })

  window.Footie.defs.CONFIG = { SETTINGS, defaults, resolve, buildSettingsManifest }
})()
