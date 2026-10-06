# GAME MODE · Save Point

`/save` turns the session into an RPG save screen — the same five things a good hand-off note holds — and the next session in that project offers to continue from it.

Drawn inside a double border in the transcript:

```
★ SAVE POINT ★  로그인 버그 수정        SLOT 1/3 · 2026-10-06 20:15 · TURN 12 · $1.24 · CTX 38%

▣ CLEARED  +120 EXP
  ✓ 토큰 만료 원인 찾기
  ✓ auth.ts 수정

▢ QUEST LOG  남은 2
  · npm test 전부 통과
  · 커밋

? 어떻게 하시겠습니까?
  ▶ 만료 단위를 초로 통일할지

PASSWORD (이어하기 프롬프트)
src/auth.ts의 refresh()부터 이어서, npm test 실패 2건을 고쳐줘

◆ INVENTORY
  ◆ src/auth.ts
  ◆ branch fix/token-expiry
```

| Screen | Status summary |
|---|---|
| ▣ CLEARED | 지금까지 한 일 |
| ▢ QUEST LOG | 아직 남은 일 |
| ? 어떻게 하시겠습니까? | 내가 결정해야 할 것 |
| PASSWORD | 다음에 이어서 할 때 붙여넣을 프롬프트 |
| ◆ INVENTORY | 산출물/파일/링크 |

How it is written: `$.model.fork` asks the session's own model over the live transcript (the prompt cache serves it), in the language you wrote in. A session resumed with `--continue` that has not sent anything yet has nothing to fork, so the stored transcript is summarized instead.

Next session in the same project (within 14 days): the status line says `◆ SAVE 2시간 전 · 로그인 버그 수정 · Tab 이어하기 · /load`, and the empty prompt box offers the PASSWORD line — **Tab** takes it.

Real run: [examples/RUN-2026-10-06.md](../../examples/RUN-2026-10-06.md).

Part of the [GAME MODE pack](../../README.md); the [HUD](../game-hud)'s `세이브` button runs `/save`. Requires Claude Code 2.1.287+; built and tested on 2.1.291.

## Install

```bash
claude plugin marketplace add Reasonofmoon/bitgame-mods
claude plugin install game-save-point@bitgame-mods
```

## Commands

| Command | |
|---|---|
| `/save` | save now (one model call) |
| `/save <note>` | save with a note the summary should keep in mind |
| `/save show` | the latest save again, no model call |
| `/save list` | the last five saves of this project |
| `/load [n]` | put save n's resume prompt in the prompt box (1 = latest) |

## Settings

| | |
|---|---|
| `intensity` (`casual`) | `off` shows saves as plain text; `casual`/`hardcore` draw the screen |
| `palette` (`nes`) | `nes` · `gameboy` · `amber` · `theme` |
| `maxAgeDays` (`14`) | how old a save may be and still be offered at start |

Saves are kept in the plugin's store per project root (last five), so they survive new sessions.

## 한국어

`/save`로 현재 세션을 RPG 세이브 화면(한 일·남은 일·결정할 것·이어하기 프롬프트·산출물)으로 저장합니다. 같은 프로젝트에서 새 세션을 열면 빈 입력창에 이어하기 프롬프트가 떠서 Tab 한 번으로 이어갈 수 있습니다. `/load`로 원하는 세이브를 불러옵니다.
