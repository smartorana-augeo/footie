# Footie

Fast 11v11 arcade football — PES/Kopanito-inspired. True-to-scale pitch
(8 px/yd), ball-following camera, keyboard controls (WASD + J/K/L), pseudo-3D
ball with lobs/headers/bicycle kicks, unpunished slide tackles, and the
**Star Power** system: one special move per side (Screamer / First Touch /
Ghost Run / Flat-Footed), charged by good play — the crowd heats up as the
meter fills.

- **Design record**: [docs/initial.md](docs/initial.md) — the original spec
  plus dated upgrade addendums (true-scale 11v11 + camera + Team Management;
  arcade controls + mechanics + Star Power). Where an addendum contradicts
  the original spec, the addendum wins.
- **Host settings**: [settings-manifest.json](settings-manifest.json) is the
  Encore admin contract, generated from `src/defs/configDefs.js` by
  `tools/emit-settings-manifest.mjs` (`npm run manifest:footie`); values come
  back at `GameWorkshopGame.mount(container, { config })`.
- **Runs from disk**: open `index.html` directly (file://) — classic scripts,
  Canvas 2D only.
- **Embed**: `dist/footie.bundle.js` exposes
  `window.GameWorkshopGame = { capabilities: { hostBridge: true }, mount }`
  (rebuild with `node tools/build-classic-game.mjs footie` from the repo root).
