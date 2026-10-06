/** The turn running now. */
export type TurnNow = {
  /** Calls the main loop made this turn. */
  actions: number
  /** The session's cost when the turn started, in US dollars. */
  startUsd: number | null
  /** A turn is running (its clear line is not written yet). */
  isOpen: boolean
}

/** One finished turn, as its clear line shows it. */
export type ClearRecord = {
  durationMs: number
  actions: number
  /** What the turn cost, in US dollars; null without a cost reading. */
  usd: number | null
  /** The session's cost when the turn started, so a late reading can still settle `usd`. */
  startUsd: number | null
  /** Against the project's median turn; null until three turns are on record. */
  deltaMs: number | null
  /** The median it was compared with. */
  medianMs: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'game-clear-time': {
      turn: TurnNow
      /** This session's finished turns, newest last (at most 100). */
      records: ClearRecord[]
    }
  }
}
