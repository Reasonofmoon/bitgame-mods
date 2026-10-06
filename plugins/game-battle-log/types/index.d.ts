/** /battle-log on|off, kept in $.store across sessions. */
export type BattleLogSwitch = boolean

/** What the log knows of one tool call of the main loop, kept per tool_use_id. */
export type CallMark = {
  /** The turn the call was made in (`TURN n`); 0 for a call the log did not see made. */
  turn: number
  /** The turn's first call: its row carries the turn header. */
  isFirst: boolean
  /** Clean calls in a row up to this one, this one included; 0 when it failed; null while it runs. */
  combo: number | null
  /** On a failure: the run of clean calls it ended. */
  broke: number
}

/** The running count the marks are made from. */
export type BattleRun = {
  /** The turn now running (`TURN n`). */
  turn: number
  /** No call made yet in this turn: the next one is its first. */
  isTurnOpen: boolean
  /** Clean calls in a row so far. */
  combo: number
}

declare module 'claude-code' {
  interface PluginState {
    'game-battle-log': {
      isOn: BattleLogSwitch
      call: StateFamily<CallMark>
      run: BattleRun
    }
  }
}
