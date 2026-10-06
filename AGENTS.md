# bitgame-mods — notes for coding agents

- Rule: **every game element does a job.** It shows a real figure, stops a real harm, or saves real time. A purely decorative change needs a reason in the PR.
- Each mod is a plugin under `plugins/<name>/` and is listed in `.claude-plugin/marketplace.json`. Keep the entry name equal to the `plugin.json` name. Names start with `game-`.
- Types come from the installed Claude Code (`.claude-plugin/types/`, written when a mod loads; not committed). Trust them over any doc when they disagree.
- Write every `$` call in full (`$.store.get`, never `const s = $.store`) and every `on('event', …)` name as a string literal, or `claude plugin validate` fails.
- Pass `$` only to functions declared at the top of the module file (a function declaration, or a const bound to one). A closure inside `register` that takes `$` as a parameter makes the module fail to load.
- A hooks module may import only files of its own plugin: the shared look (`hooks/palette.ts`) is copied into each plugin that uses it. Change all copies together; `scripts/check.sh` fails when they differ.
- Guards (`tool.call` hooks that refuse) are registered with `.catch(($, e, next) => next.called ? next(e) : { deny })`. Observers use `.catch(($, e, next) => next(e))`.
- Every guard refusal starts with `game-<plugin> blocked this call:`. The battle log and earcons match that text: keep it.
- `pass`, `warn` and `off` of a guard are honoured only for `e.origin.kind` `composer` or `bridge` (typed by the person).
- A drawing (`ui.render`) cannot write `$.state`: write from an event, or on the next tick with `$.clock.after(0, …)`, and call `$.ui.invalidate('ui.render')` where the site is not redrawn by the write (the footer's `SessionMode`).
- Count a tool call from both `session.append` (door `response` for the call, `tool-result` for its result; it sees refusals whichever plugin made them) and `tool.call` (what tests can raise), once per `tool_use_id`. The kit cannot raise `session.append`.
- A `ui.render` hook may not shadow `next` (`const next = …`) and may not draw its own tree for `AskUserQuestion`: rewrite its props and return `next(e)`.
- The Bash result has **no `exitCode`**. A non-zero exit arrives as `isError: true` on the `tool.call` result, with the text in `text`.
- In `claude plugin test`: a `$` call the test answers (`session.usage`, `command.list`, `ui.toast`, `model.fork`, …) answers `{ value }`; a plugin's deny reaches the test's `$.tool.call` as `{ deny }`; `Text` keeps no `key`, so find it by `type` and `text`.
- Never put a real-looking secret in a file here: tests build fake keys at run time, and GitHub push protection may refuse the push.
- Before you push: `bash scripts/check.sh` (strict validate + tests for every plugin). CI runs the same script.
- Never rename a published plugin. Bump `version` in both `plugin.json` and `marketplace.json` on every release, and add a `CHANGELOG.md` entry.
