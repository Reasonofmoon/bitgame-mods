export type DecisionOption = {
  label: string
  /** Sentence appended to the resume prompt when this option is picked. */
  append: string
  /** Jev probability, 0..1; null when unranked. */
  p: number | null
}

export type Decision = {
  question: string
  options: DecisionOption[]
  /** Index into `options` of the person's pick. */
  picked: number | null
  /** Jev's confidence for this decision, 0..1; null when unranked. */
  confidence: number | null
}

/**
 * What an auto-approver would have done with a card, computed once Jev has ranked it.
 * Recorded only (shadow mode): nothing is picked or sent on its strength.
 */
export type ShadowVerdict = {
  /** Every decision cleared the probability and confidence bars and no option named a risky act. */
  eligible: boolean
  /** Per decision, the option an auto-approver would pick (Jev's first choice); null when ineligible. */
  picks: Array<number | null>
  /** Why the card was not eligible, one line each (empty when eligible). */
  reasons: string[]
}

/** The parts of a `[상태 요약]` this mod uses: items 1–4. */
export type Summary = {
  resume: string
  decisions: Decision[]
  /** Item 1, one entry per bullet: what was done. Context for Jev. */
  done: string[]
  /** Item 2, one entry per bullet: what is left. Context for Jev. */
  todo: string[]
}

/** How the decision options were ordered: by Jev, or as Claude wrote them (and why). */
export type RankState = 'pending' | 'jev' | 'no-key' | 'error'

export type Card = Summary & {
  /** When the card was made (clock ms); groups a card's decisions in picks.json. */
  cardAt: number
  /** The shadow auto-approver's verdict; null until Jev has answered or failed. */
  shadow: ShadowVerdict | null
  rank: RankState
  /** A one-line reason when rank is 'error' or 'no-key'. */
  rankNote: string | null
  /** The fork-polished prompt once every decision is picked; null before. */
  refined: string | null
  isRefining: boolean
}

export type SkillCandidate = { name: string; description: string }

/** A skill Jev matched to the draft being typed. */
export type SkillHint = SkillCandidate & { p: number; draft: string }

declare module 'claude-code' {
  interface PluginState {
    'game-choice': {
      card: Card | null
      skill: SkillHint | null
      isTailoring: boolean
    }
  }
}
