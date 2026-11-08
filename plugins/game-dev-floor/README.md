# GAME MODE · Dev Floor

`/devfloor` draws the session as an animated pixel-art dev office in a pane. Each piece shows a real figure of the session:

| On the floor | What it shows |
|---|---|
| the LEAD desk | the main loop: typing while a turn runs, its screen the kind of tool it ran last |
| the other desks | subagents: each walks in to a free desk, works, then shows a green tick and walks out (`CLEAR`) or slumps over a red screen (`FAIL`) |
| a screen's picture | the tool kind: blue scrolling lines for Read/Grep/Glob, green `+` lines for Edit/Write, a prompt and cursor for Bash, a globe for WebFetch/WebSearch, a spark for Agent, dots for anything else |
| a red flashing screen | a call that just failed |
| a raised hand and `!` | a call waits for your approval |
| the ceiling beacon | a GAME MODE guard (trap-guard, barrier, loop-breaker) refused a call |
| the window's sky | context left: day above 60%, dusk, late, night at 10% or less |
| coffee cups on the LEAD desk | the session's cost: one per started dollar, up to five |
| the server rack's lights | plan usage left in the nearest window, in fifths; red at 20% or less, blinking while the main loop works |
| lights out and `z` | no turn has run for a minute and nobody works |

The names sit under the desks; a line under the picture says the same figures in words (`DEV FLOOR · 동료 2명 · 컨텍스트 72% · $2.40 · 요금제 60% 남음`), and a second line appears when a call waits for you or a guard has refused one.

The picture is one `Raster` of half-block cells (two pixels per cell). While something moves, a timer repaints it in place with `$.ui.blit`; a still floor is not repainted. It is 44 to 100 columns wide (2 to 6 desks; past the sixth desk the rack shows `+n`). On a surface without `Raster` the pane lists the floor as text.

The pane opens by itself when the session's first turn starts, on a terminal 144 columns wide or more (narrower, it waits; `/devfloor` opens it at any width).

The characters are original: no company's logo, product art or real person is drawn.

Part of the [GAME MODE pack](../../README.md). Requires Claude Code 2.1.296+ (the `Raster` element).

## Install

```bash
claude plugin marketplace add Reasonofmoon/bitgame-mods
claude plugin install game-dev-floor@bitgame-mods
```

## Settings

| | |
|---|---|
| `intensity` (`casual`) | `off` · `casual` · `hardcore` (lists each worker with its run time under the picture) |
| `palette` (`nes`) | `nes` · `gameboy` · `amber` · `theme`: the colors of the names and the caption |
| `autoOpen` (`true`) | open the pane when the session's first turn starts |
| `fps` (`12`) | frames per second while something moves, 4 to 30 |

## 한국어

이번 세션을 픽셀 아트 개발실로 그립니다. 메인 Claude는 LEAD 책상에서 타이핑하고, 서브에이전트는 걸어 들어와 빈 책상에 앉습니다. 모니터 그림은 도구 종류, 빨간 깜빡임은 실패한 호출, 손 든 개발자는 승인 대기, 경광등은 가드 거부입니다. 창밖 하늘은 남은 컨텍스트(낮 → 밤), 커피잔은 세션 비용, 서버랙 불빛은 요금제 남은 양을 보여 줍니다. 장식만 하는 요소는 없습니다.
