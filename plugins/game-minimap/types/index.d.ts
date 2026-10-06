/** What this session did to one file of the project. */
export type Visit = {
  /** Read calls on it. */
  reads: number
  /** Changed by an Edit, Write or NotebookEdit that went through. */
  isEdited: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'game-minimap': {
      /** By the path relative to the project root, with forward slashes. */
      visits: Record<string, Visit>
      /** The project's files (git's list), read when the map opens and after each turn while it is open. */
      files: string[]
    }
  }
}
