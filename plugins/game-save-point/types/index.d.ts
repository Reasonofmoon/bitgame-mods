/** One save, as kept in $.store under `slots[<project root>]`, newest first. */
export type Save = {
  v: 1
  /** $.clock.now() when saved. */
  savedAt: number
  /** The project the save belongs to ($.session.root()). */
  root: string
  title: string
  /** 지금까지 한 일 → CLEARED */
  done: string[]
  /** 아직 남은 일 → QUEST LOG (`SIDE: ` marks an optional one) */
  todo: string[]
  /** 내가 결정해야 할 것 → 선택지 (`choice — what it means`) */
  decide: string[]
  /** 다음에 이어서 할 때 붙여넣을 프롬프트 → PASSWORD */
  resume: string
  /** 산출물/파일/링크 → INVENTORY */
  artifacts: string[]
  turns: number
  usd: number | null
  contextUsed: number | null
  /** The password: `SP07-KTX9-MOON`; `/load <code>` restores this save. Absent on saves made before 0.2.0. */
  code?: string
  /** Successful tool calls in the session when saved (LV and EXP). */
  hits?: number
  /** Days since the project's first save, from 1. */
  day?: number
}

/** The title screen at the start of a session in a folder with saves. */
export type TitleState = {
  isShown: boolean
  /** LOAD pressed: the slot buttons show. */
  isLoading: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'game-save-point': { title: TitleState; hits: number }
  }
}
