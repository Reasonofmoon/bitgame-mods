/** The permission modes Claude Code runs in, by the names its settings and hooks use. */
export type StanceMode = 'default' | 'acceptEdits' | 'plan' | 'auto' | 'bypassPermissions' | 'dontAsk'

declare module 'claude-code' {
  interface PluginState {
    'game-stance': {
      /** The mode now: from the footer's own line (shift+tab) and from each prompt's hook input. */
      mode: StanceMode
    }
  }
}
