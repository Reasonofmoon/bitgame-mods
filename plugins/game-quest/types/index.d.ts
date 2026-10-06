/** One quest: a todo item or a task, as Claude keeps them. */
export type Quest = {
  /** The task's id (TaskCreate), or `todo-<n>` for a TodoWrite item. */
  id: string
  text: string
  /** What it is doing, while in progress (the item's activeForm). */
  doing: string
  status: 'pending' | 'in_progress' | 'completed'
}

/** The log as drawn and as kept for the project. */
export type QuestLog = {
  quests: Quest[]
  /** The list came from an earlier session in this project and no new list replaced it. */
  isCarried: boolean
  /** When the list last changed, in $.clock.now() time; 0 for never. */
  updatedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'game-quest': { log: QuestLog }
  }
}
