/** Something that just happened, shown in the HUD's second row until the next prompt. */
export type HudEvent = {
  kind: 'rest' | 'saved' | 'levelup'
  /** The level reached, for `levelup`. */
  level?: number
}

/** What the HUD draws from; held in $.state for the session. */
export type Vitals = {
  /** Context window used, 0–100; null before the first response of the window. */
  contextUsed: number | null
  /** The plan-usage window shown as MP (`five_hour` first); null without a reading. */
  limitKind: string | null
  /** How much of that window is used, 0–100. */
  limitUsed: number | null
  /** What the session cost, US dollars; null where no ledger is kept. */
  usd: number | null
  /** Main-loop turns completed. */
  turns: number
  /** Tool calls that ran without an error or a deny (LV/EXP). */
  hits: number
  /** Whether a /save command (game-save-point) is available. */
  hasSave: boolean
  /** /hud hide */
  isHidden: boolean
  /** The low-HP toast was shown for the current dip. */
  warned: boolean
  /** A rest, a save or a level-up since the last prompt; null when none. */
  event: HudEvent | null
}

declare module 'claude-code' {
  interface PluginState {
    'game-hud': { vitals: Vitals }
  }
}
