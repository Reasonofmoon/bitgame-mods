/** A file Claude made or changed this session. */
export type Item = {
  /** Relative to the project root, forward slashes. */
  path: string
  /** Made by this session (a Write that created it). */
  isNew: boolean
  /** Lines added and removed over the session. */
  added: number
  removed: number
  /** Edits and writes that went through. */
  hits: number
}

declare module 'claude-code' {
  interface PluginState {
    'game-item-get': { items: Item[] }
  }
}
