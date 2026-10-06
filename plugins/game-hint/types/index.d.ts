/** What the hint line reads to decide what to suggest. */
export type HintCues = {
  /** Context left, in percent; null before the first reading. */
  hpLeft: number | null
  /** Failed calls of the main loop in a row. */
  failStreak: number
  /** Turns since the last /save (or since the session started). */
  turnsSinceSave: number
  /** game-save-point is installed: /save exists. */
  canSave: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'game-hint': { cues: HintCues }
  }
}
