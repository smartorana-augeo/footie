;(function () {
  'use strict'

  /**
   * Embedding entry point. footie ships as ~30 separate classic scripts (no
   * ES modules, no bundler — runs from file:// for local dev), unlike
   * three-pointer's single esbuild bundle. The dist build
   * (tools/build-classic-game.mjs) concatenates them all — in the exact
   * order index.html loads them — into ONE file with this module appended
   * last, so the shipped dist/footie.bundle.js still satisfies the same
   * "one <script src>, exposes window.GameWorkshopGame.mount" contract an
   * embedding host (the Encore Games widget) already relies on for
   * three-pointer.
   *
   * Uses a Shadow DOM for the mounted instance: footie's ids/classes (#app,
   * #hud, .screen, .btn, ...) are generic enough to plausibly collide with
   * an embedding host's own markup, unlike three-pointer's unusual ones —
   * Shadow DOM gives real encapsulation in both directions (the host's CSS
   * can't bleed in, footie's CSS/ids can't bleed out) instead of relying on
   * every selector staying accidentally unique. The GamePlayCompleted event
   * is dispatched with composed:true (see FootieGame.js), which is exactly
   * what lets a bubbling event cross a shadow boundary and still reach a
   * listener on the light-DOM host container.
   */
  /**
   * @param {HTMLElement} container
   * @param {{config?: object}} [mountOptions] — `config` is the host's stored
   *   admin settings (nested; dot-path keys expanded host-side), the values
   *   its settings panel collected from this game's settings-manifest.json.
   *   Merged over the game's defaults and validated by defs/configDefs.js;
   *   ANY validation issue logs once and mounts on pure defaults instead of
   *   half-applying a broken config (the treasure-chest gate). No URL
   *   parameters are ever read — the host owns its URL.
   */
  const mount = (container, mountOptions) => {
    const F = window.Footie

    let config
    if (mountOptions && mountOptions.config !== undefined) {
      const { config: resolved, issues } = F.defs.CONFIG.resolve(mountOptions.config)
      if (issues.length > 0) {
        console.error('footie: host config rejected, mounting with defaults', issues)
        config = F.defs.CONFIG.defaults()
      } else {
        config = resolved
      }
    }

    const shadow = container.attachShadow({ mode: 'open' })

    const style = document.createElement('style')
    style.textContent = F.embedShell.EMBED_CSS
    shadow.appendChild(style)

    const wrapper = document.createElement('div')
    wrapper.innerHTML = F.embedShell.SHELL_HTML
    shadow.appendChild(wrapper)

    F.boot(shadow, config)
  }

  // `capabilities.hostBridge` tells a host this bundle honors mount options —
  // an older bundle would silently ignore them, which a host that passes
  // config must treat as a hard error rather than a quiet fallback.
  window.GameWorkshopGame = { capabilities: { hostBridge: true }, mount }
})()
