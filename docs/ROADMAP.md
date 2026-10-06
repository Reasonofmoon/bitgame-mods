# Roadmap

One rule: **every game element does a job.** Each mod below is placed by where it draws or hooks in Claude Code, and by what it saves you.

| Phase | Mod | Where | Job | Status |
|-------|-----|-------|-----|--------|
| P1 safety & cost | HUD | `AbovePrompt` · `session.measure` | context, plan usage and cost in view; rest/save at low HP | **0.1.0** |
| | Battle Log | `ToolGroup` · `ToolUse` · `ToolResult` | failures stand out | **0.1.1** |
| | Trap Guard | `tool.call` | no leaked secrets | **0.1.1** |
| | Barrier | `tool.call` | no irreversible commands | **0.1.1** |
| | Loop Breaker | `tool.call` · `prompt.submit` | no blind retries | **0.1.1** |
| | Save Point | `command.run` · `$.model.fork` · `prompt.suggest` · `CommandOutput` | resume tomorrow | **0.1.1** |
| | Earcons | `$.audio.play` · `tool.check` · `session.append` · `turn.complete` | know when it needs you | **0.1.1** |
| P2 keeping track | Stance | `SessionMode` | permission mode as color (plan blue, auto-accept yellow, bypass red) | planned |
| | Casting | `Spinner` | the action now, elapsed time, this turn's cost | planned |
| | Clear Time | `TurnDuration` | turn time, actions and cost against your best | planned |
| | Party | `Pane` · `agent.spawn` | subagents' progress and failures | planned |
| | Quest | `Pane` · `session.compact` | the task list as quests, kept through `/compact` | planned |
| | Minimap | `Pane` · `tool.call` | files read, edited, never opened; repeated reads | planned |
| | Hint | `PromptHint` | what to press now (Esc, `/compact`, Tab to resume) | planned |
| | Map | status line | branch, `main` in warning color, play time | planned |
| P3 habits | Spell Check | `prompt.edit` · `prompt.submit` | vague words and secrets highlighted while you type; a done-condition on submit | planned |
| | Answer Memory | `AskUserQuestion` | ★ on your last choice to the same question | planned |
| | Hedge Mark | `AssistantMessage` | `?` on sentences that are guesses | planned |
| | Item Get · Equip · Achievements | `CommandOutput` · `InfoNotice` · toast | outputs with paths; model in view; rewards for good habits | planned |

## P1 · next

- [ ] Trap guard: `.envrc` and project `.npmrc` with `_authToken`
- [ ] Barrier: open scripts named in a command (`./deploy.sh`) one level deep
- [ ] Loop breaker: recognise polling (`until …; do sleep`) and server boot waits
- [ ] HUD: optional turn-cost line under the band (`G +$0.12 this turn`)
- [ ] Save point: a `save_point` tool so Claude can save at the end of a long turn on its own
