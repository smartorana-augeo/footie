/**
 * Global namespace. Classic scripts (no ES modules) so the game runs when
 * index.html is opened directly from disk (file://) — module scripts and
 * fetch() are blocked there. Load order is defined by the script tags in
 * index.html; every file assigns into this tree.
 *
 * assetBase: the absolute URL of this game's own folder, derived from THIS
 * script's own src (document.currentScript.src is always absolute, even when
 * the tag's src attribute was relative). Image/tileset paths are built from
 * this instead of bare relative strings, so they resolve correctly whether
 * this file was loaded from its own index.html (assetBase == that page's own
 * folder, a no-op) or injected by an embedding host's mount() from a
 * completely different page/origin.
 */
window.Footie = {
  assetBase: new URL('../', document.currentScript.src).href,
  engine: {},
  defs: {},
  things: {},
  behaviors: { implementations: {}, helpers: {} },
  game: {},
}
