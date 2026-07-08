/**
 * Global namespace. Classic scripts (no ES modules) so the game runs when
 * index.html is opened directly from disk (file://) — module scripts and
 * fetch() are blocked there. Load order is defined by the script tags in
 * index.html; every file assigns into this tree.
 */
window.Footie = {
  engine: {},
  defs: {},
  things: {},
  behaviors: { implementations: {}, helpers: {} },
  game: {},
}
