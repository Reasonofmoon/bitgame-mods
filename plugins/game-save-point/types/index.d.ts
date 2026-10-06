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
  /** 아직 남은 일 → QUEST LOG */
  todo: string[]
  /** 내가 결정해야 할 것 → 선택지 */
  decide: string[]
  /** 다음에 이어서 할 때 붙여넣을 프롬프트 → PASSWORD */
  resume: string
  /** 산출물/파일/링크 → INVENTORY */
  artifacts: string[]
  turns: number
  usd: number | null
  contextUsed: number | null
}
