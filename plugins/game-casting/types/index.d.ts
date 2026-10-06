/** A call of the main loop that is running now. */
export type Running = {
  id: string
  /** What the spinner names it by: `BASH npm test`, `EDIT auth.ts`. */
  text: string
}

/** The turn as the spinner tells it. */
export type Cast = {
  /** Calls the main loop made this turn. */
  actions: number
  /** The session's cost when the turn started, in US dollars; null before the first reading. */
  startUsd: number | null
  /** The session's cost now, in US dollars. */
  usd: number | null
  /** Calls running now, oldest first. */
  running: Running[]
  /** The calls counted this turn, by tool_use_id: each is counted once, however it was seen. */
  seen: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'game-casting': { cast: Cast }
  }
}
