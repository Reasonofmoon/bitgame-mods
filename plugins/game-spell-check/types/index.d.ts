/** What the draft in the prompt box holds now. */
export type Draft = {
  /** The first vague word in it, as typed; '' when none. */
  vague: string
  /** A value that looks like a secret is in it. */
  hasSecret: boolean
}

/** A prompt the person sent, as its message window shows it. */
export type Sent = {
  text: string
  /** The done condition the person wrote; '' when none. */
  done: string
  /** The note asking Claude to state a done condition first went with it. */
  isAsked: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'game-spell-check': {
      draft: Draft
      /** The last 50 prompts sent from the prompt box. */
      sent: Sent[]
    }
  }
}
