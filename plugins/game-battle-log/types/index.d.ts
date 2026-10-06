/** /battle-log on|off, kept in $.store across sessions. */
export type BattleLogSwitch = boolean

declare module 'claude-code' {
  interface PluginState {
    'game-battle-log': { isOn: BattleLogSwitch }
  }
}
