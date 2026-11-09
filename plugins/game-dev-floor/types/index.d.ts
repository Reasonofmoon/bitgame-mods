/** What a desk's screen shows: the kind of tool its developer ran last. */
export type ToolKind = 'read' | 'edit' | 'bash' | 'web' | 'agent' | 'other'

/** One subagent of the session, seated at a desk of the floor. */
export type Worker = {
  /** The agent's id: its loop's `agentId` on tool.call and turn.complete. */
  id: string
  /** The Agent tool call that started it. */
  toolUseId: string
  /** Its name, or its agent type when it has none. */
  name: string
  status: 'active' | 'clear' | 'fail'
  /** The desk it was given when it started (1 to 5), or null when every desk was held. */
  desk: number | null
  /** The tool it ran last, and when that call started (ms). */
  kind: ToolKind | null
  tool: string | null
  /** When its last call failed (ms), or null. */
  errorAt: number | null
  startedAt: number
  /** When it was given its desk (ms): it walks in to the desk from then. Null while it waits for one. */
  seatedAt: number | null
  /** When its loop ended (ms), or null while it runs. */
  endedAt: number | null
  /** When it was last heard from (ms): a worker silent for long is taken off the floor. */
  lastAt: number
}

/** The main loop, at the LEAD desk. */
export type Lead = {
  /** True between the person's prompt and the turn's answer. */
  isWorking: boolean
  kind: ToolKind | null
  tool: string | null
  errorAt: number | null
}

/** Everything the floor draws: each value is a real figure of the session. */
export type Floor = {
  lead: Lead
  workers: Worker[]
  /**
   * The last guard refusal: its verdict (TRAP!, BARRIER!, LOOP!), when (ms), how many so far,
   * and the tool_use_ids counted (each refusal is seen as it runs and as it is stored).
   */
  alarm: { verdict: string; at: number; count: number; ids: string[] } | null
  /** Whose call waits for the person's approval: 'lead', a worker's id, or null. */
  asking: string | null
  /** Context left, 0 to 100, or null before the first measure. */
  contextLeft: number | null
  /** The session's cost so far in USD, or null. */
  usd: number | null
  /** Plan usage left in the nearest window, 0 to 100, or null. */
  rackLeft: number | null
  /** When the last main turn ended (ms), or null while one runs. */
  idleSince: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'game-dev-floor': { floor: Floor }
  }
}
