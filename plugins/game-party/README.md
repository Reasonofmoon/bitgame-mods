# GAME MODE · Party

`/party` shows the session's subagents as a party:

```
PARTY  3명 · 진행 1
◆ Explore       ACTIVE  ████░░░░░░  8  로그인 흐름 조사
◆ reviewer      CLEAR   ██████████ 21  보안 검토
◆ test-runner   FAIL    ██░░░░░░░░  4  테스트 고치기
```

- `ACTIVE` while the subagent runs, `CLEAR` when it handed its report back, `FAIL` when its run or its Agent call failed
- the bar is its tool calls against the busiest member's; `◆` in blue for a background agent
- the job is the description the Agent call gave

The pane opens by itself when the session's first subagent starts, on a terminal 144 columns wide or more (narrower, it waits; `/party` opens it at any width). In fullscreen it docks beside the transcript.

Part of the [GAME MODE pack](../../README.md). Requires Claude Code 2.1.287+; built and tested on 2.1.291.

## Install

```bash
claude plugin marketplace add Reasonofmoon/bitgame-mods
claude plugin install game-party@bitgame-mods
```

## Settings

| | |
|---|---|
| `intensity` (`casual`) | `off` · `casual` · `hardcore` (adds failed calls `✗n` and run time) |
| `palette` (`nes`) | `nes` · `gameboy` · `amber` · `theme` |
| `autoOpen` (`true`) | open the pane when the first subagent starts |

## 한국어

이번 세션의 서브에이전트를 파티로 보여줍니다(진행 중·완료·실패, 도구 호출 막대, 맡은 일). 첫 서브에이전트가 시작되면 넓은 터미널(144칸 이상)에서 자동으로 열립니다.
