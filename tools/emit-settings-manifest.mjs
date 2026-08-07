/**
 * Writes games/footie/settings-manifest.json from the game's OWN defs, so the
 * published manifest can never drift from the code defaults (same invariant
 * as treasure-chest's emit tool). Footie is classic scripts, not TS — so
 * instead of esbuild this evaluates the def files in a Node `vm` sandbox with
 * a minimal `window`/`document` shim and calls CONFIG.buildSettingsManifest().
 *
 * Run via `npm run manifest:footie` (root package.json). Lives under
 * games/footie/tools/, NOT src/ — tools/build-classic-game.mjs sweeps every
 * .js under src/ into the shipped bundle.
 *
 * Drift gate (used by the release checklist): running this must leave
 * settings-manifest.json byte-identical to what is committed.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'

const gameDir = join(dirname(fileURLToPath(import.meta.url)), '..')

// Load order mirrors index.html; only the defs CONFIG actually reads.
const SOURCES = [
  'src/namespace.js',
  'src/defs/tuningDefs.js',
  'src/defs/starDefs.js',
  'src/defs/formationDefs.js',
  'src/defs/uiDefs.js',
  'src/defs/configDefs.js',
]

const sandbox = { URL }   // namespace.js builds assetBase with new URL(...)
sandbox.window = sandbox
// namespace.js derives assetBase from document.currentScript.src.
sandbox.document = { currentScript: { src: pathToFileURL(join(gameDir, 'src/namespace.js')).href } }
const context = vm.createContext(sandbox)

for (const rel of SOURCES) {
  const file = join(gameDir, rel)
  vm.runInContext(readFileSync(file, 'utf8'), context, { filename: file })
}

const manifest = sandbox.window.Footie.defs.CONFIG.buildSettingsManifest()

// Same invariant treasure-chest enforces: a settings entry without a usable
// default renders as an empty admin field and validates as garbage.
for (const section of manifest.sections) {
  if (section.kind !== 'settings') continue
  for (const entry of section.entries) {
    const d = entry.default
    const ok =
      (entry.type === 'integer' || entry.type === 'number') ? Number.isFinite(d)
      : entry.type === 'boolean' ? typeof d === 'boolean'
      : typeof d === 'string' && d.length > 0
    if (!ok) throw new Error(`settings entry ${entry.key} has no usable default (got ${JSON.stringify(d)})`)
  }
}

// Stable output: keys sorted alphabetically at every level (matches the
// committed treasure-chest manifest style), 2-space indent, trailing newline.
const sortKeys = (value) => {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, sortKeys(value[k])]))
  return value
}

const outPath = join(gameDir, 'settings-manifest.json')
writeFileSync(outPath, JSON.stringify(sortKeys(manifest), null, 2) + '\n')
console.log(`wrote ${outPath}`)
