/** One subagent of the session, as the party pane shows it. */
export type Member = {
  /** The agent's id: its loop's `agentId` on tool.call and turn.complete. */
  id: string
  /** The Agent tool call that started it. */
  toolUseId: string
  /** Its name, or its agent type when it has none. */
  name: string
  /** What it was sent to do (the call's description). */
  job: string
  status: 'active' | 'clear' | 'fail'
  /** Its tool calls, and how many of them failed. */
  calls: number
  fails: number
  /** When it started, and how long it ran once it ended (ms). */
  startedAt: number
  durationMs: number | null
  isBackground: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'game-party': { members: Member[] }
  }
}
