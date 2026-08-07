;(function () {
  'use strict'

  /**
   * Formation data for the 11-a-side game — the design record for shapes.
   *
   * Coordinates are normalized player-team coords (x 0 = own goal … 1 =
   * enemy goal, y 0 = top touchline … 1 = bottom; fieldDefs.normFor mirrors
   * them for the enemy).
   *
   * Two independent choices layer together:
   *   • SHAPE  — picked pre-match in Team Management ('442', '433', '4231');
   *     decides who is on the pitch (roster) and where each line sits.
   *   • MODE   — cycled in-match with Alt ('balanced' → 'attack' → 'defend'
   *     → 'spread'); pushes the whole shape up/back and widens/narrows it.
   *     The enemy always plays the default shape in 'balanced'.
   *
   * Per role per mode the table holds a `poss` anchor (team HAS possession),
   * a `def` anchor (it doesn't), and per-axis ball-influence weights `pull`:
   * the working anchor slides by pull × (ball − field center) — the spec's
   * `formationTarget + ballInfluence` model, unchanged from the 5v5 build.
   *
   * Everything under `tables` / `kickoff` / `roster` / `shiftCycle` is
   * GENERATED at load from the hand-tuned band seeds below — a shape is just
   * `lines` (band + player count); adding one means adding a `shapes` entry.
   */

  // ── Hand-tuned seeds ──────────────────────────────────────────────────

  // Band x-params per mode — the proven 5v5 numbers (DF, ML/MR → MF, FW
  // from the old per-role tables). DM and AM are derived below as the
  // midpoint between their neighbouring bands (DF↔MF and MF↔FW).
  const BAND_SEED = {
    balanced: {
      DF: { poss: 0.30, def: 0.20, pullX: 0.12, pullY: 0.35 },
      MF: { poss: 0.50, def: 0.40, pullX: 0.25, pullY: 0.30 },
      FW: { poss: 0.72, def: 0.55, pullX: 0.30, pullY: 0.35 },
    },
    attack: {
      DF: { poss: 0.50, def: 0.34, pullX: 0.12, pullY: 0.30 },
      MF: { poss: 0.68, def: 0.52, pullX: 0.25, pullY: 0.25 },
      FW: { poss: 0.86, def: 0.65, pullX: 0.25, pullY: 0.40 },
    },
    defend: {
      DF: { poss: 0.26, def: 0.15, pullX: 0.08, pullY: 0.35 },
      MF: { poss: 0.42, def: 0.29, pullX: 0.20, pullY: 0.40 },
      FW: { poss: 0.60, def: 0.46, pullX: 0.25, pullY: 0.35 },
    },
    spread: {
      DF: { poss: 0.30, def: 0.24, pullX: 0.10, pullY: 0.25 },
      MF: { poss: 0.55, def: 0.40, pullX: 0.20, pullY: 0.10 },
      FW: { poss: 0.76, def: 0.56, pullX: 0.25, pullY: 0.20 },
    },
  }

  // How far a line fans out vertically, per mode (multiplies lane spacing).
  const Y_SPREAD = { balanced: 1.0, attack: 0.95, defend: 0.9, spread: 1.35 }

  // Kickoff x per band — mode-independent, everyone on their own half and
  // OUTSIDE the centre circle (its edge sits at x ≈ 0.413 on the new
  // true-to-scale pitch), lines staggered so the shape reads at a glance.
  const KICKOFF_X = { GK: 0.05, DF: 0.16, DM: 0.22, MF: 0.28, AM: 0.34, FW: 0.40 }

  const BAND_LABEL = {
    DF: 'Defender',
    DM: 'Holding Mid',
    MF: 'Midfielder',
    AM: 'Attacking Mid',
    FW: 'Forward',
  }

  // Wide players (the outermost of any 3+ line) hug their touchline: they
  // follow the ball vertically a bit less — mirrors the old ML/MR pulls.
  const WIDE_PULL_Y_FACTOR = 0.85

  const MODES  = ['balanced', 'attack', 'defend', 'spread']
  const SHAPES = {
    '442':  { label: '4-4-2',   lines: [{ band: 'DF', count: 4 }, { band: 'MF', count: 4 }, { band: 'FW', count: 2 }] },
    '433':  { label: '4-3-3',   lines: [{ band: 'DF', count: 4 }, { band: 'MF', count: 3 }, { band: 'FW', count: 3 }] },
    '4231': { label: '4-2-3-1', lines: [{ band: 'DF', count: 4 }, { band: 'DM', count: 2 }, { band: 'AM', count: 3 }, { band: 'FW', count: 1 }] },
  }

  // ── Pure generator — runs once at load over shapes × modes ───────────

  const round = v => Math.round(v * 1e4) / 1e4
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)
  const mid   = (a, b) => ({
    poss:  round((a.poss  + b.poss)  / 2),
    def:   round((a.def   + b.def)   / 2),
    pullX: round((a.pullX + b.pullX) / 2),
    pullY: round((a.pullY + b.pullY) / 2),
  })

  /** Full five-band x-param table for one mode (DM/AM interpolated). */
  function bandParams(mode) {
    const s = BAND_SEED[mode]
    return { DF: s.DF, DM: mid(s.DF, s.MF), MF: s.MF, AM: mid(s.MF, s.FW), FW: s.FW }
  }

  /** Lane ys for a line of `count` players, centred on midfield. */
  function laneYs(count, ySpread) {
    const s = Math.min(0.24, 0.8 / count) * ySpread
    const ys = []
    for (let i = 0; i < count; i++)
      ys.push(round(clamp(0.5 + (i - (count - 1) / 2) * s, 0.08, 0.92)))
    return ys
  }

  function generate() {
    const tables = {}, kickoff = {}, roster = {}, shiftCycle = {}

    for (const [shapeId, shape] of Object.entries(SHAPES)) {
      tables[shapeId]  = {}
      kickoff[shapeId] = { GK: { x: KICKOFF_X.GK, y: 0.5 } }
      roster[shapeId]  = []

      // Roster + kickoff (kickoff lanes use the balanced spread).
      let variant = 0
      for (const line of shape.lines) {
        const ys = laneYs(line.count, Y_SPREAD.balanced)
        for (let i = 0; i < line.count; i++) {
          const role = `${line.band}${i + 1}`
          const wide = line.count >= 3 && (i === 0 || i === line.count - 1)
          roster[shapeId].push({
            role,
            band: line.band,
            label: `${BAND_LABEL[line.band]} ${i + 1}`,
            wide,
            variant: ++variant,          // outfield kits 1..10 in roster order
          })
          kickoff[shapeId][role] = { x: KICKOFF_X[line.band], y: ys[i] }
        }
      }

      // Shift cycle: attack-first — FWs, then AM/MF, then DM, then DF
      // (lines reversed; role-index order within a line).
      shiftCycle[shapeId] = [...shape.lines].reverse().flatMap(line =>
        Array.from({ length: line.count }, (_, i) => `${line.band}${i + 1}`))

      // Positioning tables per mode.
      for (const mode of MODES) {
        const bands = bandParams(mode)
        const table = (tables[shapeId][mode] = {})
        for (const line of shape.lines) {
          const b  = bands[line.band]
          const ys = laneYs(line.count, Y_SPREAD[mode])
          for (let i = 0; i < line.count; i++) {
            const wide = line.count >= 3 && (i === 0 || i === line.count - 1)
            table[`${line.band}${i + 1}`] = {
              poss: { x: b.poss, y: ys[i] },
              def:  { x: b.def,  y: ys[i] },
              pull: { x: b.pullX, y: round(b.pullY * (wide ? WIDE_PULL_Y_FACTOR : 1)) },
            }
          }
        }
      }
    }

    return { tables, kickoff, roster, shiftCycle }
  }

  const generated = generate()

  window.Footie.defs.FORMATIONS = {
    // In-match Alt tactical cycle.
    modes: MODES,
    modeLabels: { balanced: 'Balanced', attack: 'Attack', defend: 'Defend', spread: 'Spread' },

    // Pre-match shape pick (Team Management); persisted under storageKey.
    defaultShape: '442',
    shapeOrder: ['442', '433', '4231'],
    shapes: SHAPES,
    storageKey: 'footie-formation',

    // Generated: see the seeds + generator above.
    tables:     generated.tables,       // [shape][mode][role] → { poss, def, pull }
    kickoff:    generated.kickoff,      // [shape][role] → {x, y} (includes GK)
    roster:     generated.roster,       // [shape] → 10 outfield slots
    shiftCycle: generated.shiftCycle,   // [shape] → role ids, attack-first
  }
})()
