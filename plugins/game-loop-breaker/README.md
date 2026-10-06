# GAME MODE · Loop Breaker

A loop is **the same call failing the same way, again and again, with nothing changed in between**. The loop breaker counts those and steps in:

| Identical failure | What happens |
|---|---|
| 2nd | `LOOP 2/3`: Claude is told running it again unchanged will not help |
| 3rd | `LOOP 3`: Claude is told the next identical run will be blocked |
| 4th run | refused (`block`) or let through with a note (`warn`) |

"Identical" ignores timings, timestamps, temp paths and addresses, but keeps counts: `2 failed` → `1 failed` is progress, not a loop.

The seal lifts when something changes:

- a successful Edit/Write takes every sealed command one strike back (it may run once more),
- a successful Read of a file does the same for an Edit that kept missing its text in that file,
- a new message from you clears everything, as does `/loop-breaker reset`.

Tracked calls: Bash commands, Edit/Write/NotebookEdit per file, WebFetch per URL.

Claude receives:

```text
game-loop-breaker blocked this call: `npm test` already failed the same way 3 times in a row ("FAIL src/auth.test.ts").
Running it again unchanged will not help. Change the code or the command first, try a smaller check, or ask the user.
The block lifts after a change, when the user sends a new message, or when the user types /loop-breaker pass.
```

Real run: [examples/RUN-2026-10-06.md](../../examples/RUN-2026-10-06.md).

Part of the [GAME MODE pack](../../README.md). Requires Claude Code 2.1.287+; built and tested on 2.1.291.

## Install

```bash
claude plugin marketplace add Reasonofmoon/bitgame-mods
claude plugin install game-loop-breaker@bitgame-mods
```

## Settings and commands

| | |
|---|---|
| `mode` (`block`) | `block` · `warn` · `off` |
| `limit` (`3`) | identical failures before the seal (2–10) |
| `/loop-breaker` | status and open loops |
| `/loop-breaker reset` | clear every streak |
| `/loop-breaker block` · `warn` · `off` | change the mode; remembered |
| `/loop-breaker pass` | let the next refused call run once (within 10 minutes) |

`warn`, `off` and `pass` are accepted only when you type them.

## Known limits

- Polling until a server is up (`curl localhost:3000` failing the same way while it boots) looks like a loop. Wrap the wait in one command (`until curl -sf …; do sleep 1; done`), raise `limit`, or use `warn`.
- Streaks live in memory: a hot reload or a new session starts them over.

## 한국어

같은 명령이 아무것도 바뀌지 않은 채 같은 방식으로 계속 실패하면 2번째에 경고, 3번째에 봉인 예고, 4번째 실행을 막습니다. 파일을 수정하거나 사용자가 새 메시지를 보내면 풀립니다.
