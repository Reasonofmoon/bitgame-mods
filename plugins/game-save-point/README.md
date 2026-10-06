# GAME MODE · Save Point

`/save` turns the session into an RPG save screen — the same five things a good hand-off note holds — and the next session in that project opens on a title screen to continue from it.

The save screen, drawn in the transcript (two columns from 90 columns wide):

```
╔══════════════════════════════════════════════════════════════════════════════╗
║ ◆ ★ SAVE POINT ★                                       SLOT 1/3 · DAY 1 · 00:02 ║
║ QUEST · src 파일 확인 및 npm test 실행                         LV 01 ███░░░░░░░ EXP ║
║                                                                CTX ░░░░░░░░░░ 4% ║
╚══════════════════════════════════════════════════════════════════════════════╝
╔═══════════════════════════════════╗╔═══════════════════════════════════════╗
║ ▣ CLEARED                +180 EXP ║║ ? 어떻게 하시겠습니까?                     ║
║   ✓ npm test 실행: 1 통과, 2 실패  ║║ ▶ 타임스탬프 단위 불일치                    ║
║ ▢ QUEST LOG         남은 퀘스트 3 ║║     src/auth.js를 초로 바꿀지, 테스트를…     ║
║ MAIN test/auth.test.js:16 수정    ║╚═══════════════════════════════════════╝
║ SIDE README 갱신                  ║║ ◆ INVENTORY  [◆ auth.js] [◆ auth.test.js] [? ???] ║
╚═══════════════════════════════════╝
╔══════════════════════════════════════════════════════════════════════════════╗
║ PASSWORD  SP01-MCS4-MOON   COPIED!   ▸ /load SP01-MCS4-MOON · 빈 입력창 Tab 이어하기 ║
╚══════════════════════════════════════════════════════════════════════════════╝
╭──────────────────────────────────────────────────────────────────────────────╮
│ ▶ 「/tmp/gm-demo에서 npm test를 실행하면 3개 중 2개가 실패합니다. …」             │
╰──────────────────────────────────────────────────────────────────────────────╯
```

| Screen | Status summary |
|---|---|
| ▣ CLEARED (`+EXP`) | 지금까지 한 일 |
| ▢ QUEST LOG (`MAIN` · `SIDE`) | 아직 남은 일 (`SIDE:` marks an optional one) |
| ? 어떻게 하시겠습니까? | 내가 결정해야 할 것 (`choice — what it leads to`) |
| ◆ INVENTORY | 산출물/파일/링크 |
| PASSWORD · ▶ 「…」 | 다음에 이어서 할 때 붙여넣을 프롬프트: copied to the clipboard (`COPIED!`), and a code (`SP07-KTX9-MOON`) that `/load` takes in any project |

How it is written: `$.model.fork` asks the session's own model over the live transcript (the prompt cache serves it), in the language you wrote in. A session resumed with `--continue` that has not sent anything yet has nothing to fork, so the stored transcript is summarized instead.

**Title screen.** A new session in a folder with saves (within 14 days) opens on one, above the [HUD](../game-hud):

```
╔══════════════════════════════════════════════════════════════════════════════╗
║ ◆ S A V E   P O I N T ◆          A CLAUDE CODE MOD · REASONOFMOON    PRESS START ║
║ [ ▸ CONTINUE ]  [ NEW GAME ]  [ LOAD ]  빈 입력창 Tab: 이어하기 · ctrl+x tab: 메뉴   ║
║  ▸ SLOT 1          LV 01 · DAY 1   SLOT 2          LV 01 · DAY 1   SLOT 3  ---      ║
║  로그인 버그 수정 · 퀘스트 2        테스트 정리 · CLEAR              - NO DATA -       ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

`CONTINUE` puts the latest resume prompt in the prompt box, `LOAD` shows a button per slot, `NEW GAME` closes it; so does the first prompt you send. Focus it with a click or `ctrl+x tab`, then `c`, `n`, `l`, `1`–`3`. Meanwhile the status line says `◆ SAVE 2시간 전 · 로그인 버그 수정 · Tab 이어하기 · /load`, the empty prompt box offers the resume prompt (**Tab** takes it), and the hint line adds `▸ Tab 이어하기 · /load`.

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
| `/save list` | the last five saves of this project, with their passwords |
| `/load [n]` | put save n's resume prompt in the prompt box (1 = latest) |
| `/load SP07-KTX9-MOON` | the save with that password, from any project |

## Settings

| | |
|---|---|
| `intensity` (`casual`) | `off` shows saves as plain text and no title screen; `casual`/`hardcore` draw them |
| `palette` (`nes`) | `nes` · `gameboy` · `amber` · `theme` |
| `maxAgeDays` (`14`) | how old a save may be and still be offered at start |

Saves are kept in the plugin's store per project root (last five), so they survive new sessions.

## 한국어

`/save`로 현재 세션을 RPG 세이브 화면(한 일·남은 일·결정할 것·산출물·이어하기 프롬프트)으로 저장하고, 이어하기 프롬프트를 클립보드에 복사하며 비밀번호(`SP07-KTX9-MOON`)를 줍니다. 같은 프로젝트에서 새 세션을 열면 타이틀 화면(CONTINUE·NEW GAME·LOAD)이 뜨고, 빈 입력창에서 Tab으로 이어갈 수 있습니다. `/load 비밀번호`로 다른 프로젝트에서도 불러옵니다.
