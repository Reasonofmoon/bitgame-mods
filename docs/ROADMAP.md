# Roadmap

One rule: **every game element does a job.** Each mod below is placed by where it draws or hooks in Claude Code, and by what it saves you. Acceptance criteria for 0.2.0: [GOALS.md](GOALS.md).

| Phase | Mod | Where | Job | Status |
|-------|-----|-------|-----|--------|
| P1 safety & cost | HUD | `AbovePrompt` · `session.measure` | context, plan usage and cost in view; rest/save at low HP | **0.2.0** |
| | Battle Log | `ToolGroup` · `ToolUse` · `ToolResult` · `ToolProgress` | failures stand out; turns, combos, line counts, guard verdicts | **0.2.0** |
| | Trap Guard | `tool.call` | no leaked secrets | **0.2.0** |
| | Barrier | `tool.call` | no irreversible commands | **0.2.0** |
| | Loop Breaker | `tool.call` · `prompt.submit` | no blind retries | **0.2.0** |
| | Save Point | `command.run` · `$.model.fork` · `CommandOutput` · `AbovePrompt` | resume tomorrow: save screen, password, title screen | **0.2.0** |
| | Earcons | `$.audio.play` · `$.process.run` · `session.append` | know when it needs you, on every OS | **0.2.0** |
| P2 keeping track | Stance | `SessionMode` | permission mode as a colored badge | **0.2.0** |
| | Casting | `Spinner` | the action now and this turn's cost | **0.2.0** |
| | Clear Time | `TurnDuration` | turn time, actions and cost against the project's usual turn | **0.2.0** |
| | Party | `Pane` · `agent.spawn` | subagents' progress and failures | **0.2.0** |
| | Quest | `Pane` · task tools | the task list as quests, kept through `/compact` and sessions | **0.2.0** |
| | Minimap | `Pane` · `tool.call` | files read, edited, never opened; repeated reads | **0.2.0** |
| | Hint | `PromptHint` | what to press now | **0.2.0** |
| | Map | status line | branch (protected marked) and play time | **0.2.0** |
| P3 habits | Spell Check | `prompt.edit` · `prompt.submit` · `UserMessage` | vague words and secrets while you type; a done condition first | **0.2.0** |
| | Answer Memory | `AskUserQuestion` | ★ on your last choice to the same question | **0.2.0** |
| | Hedge Mark | `AssistantMessage` | `[?]` on sentences that are guesses | **0.2.0** |
| | Item Get | `ToolResult` · `CommandOutput` | new files stand out; `/inventory` | **0.2.0** |
| | Equip | `InfoNotice` · `$.ui.log` | the model in view when the session starts and when it changes | **0.2.0** |
| | Achievement | toast · `CommandOutput` | rewards for good habits | **0.2.0** |

## Next

- [ ] Trap guard: `.envrc` and project `.npmrc` with `_authToken`
- [ ] Barrier: open scripts named in a command (`./deploy.sh`) one level deep
- [ ] Loop breaker: recognise polling (`until …; do sleep`) and server boot waits
- [ ] Save point: a `save_point` tool so Claude can save at the end of a long turn on its own
- [ ] Stance: an exact source for the mode between prompts, if the engine adds an event for it
- [ ] Earcons: an `achievement` cue (game-achievement raises a toast only)
- [ ] A recorded run on Windows Terminal with Galmuri Mono
