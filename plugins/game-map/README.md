# GAME MODE · Map

A status line with where you are and how long you have played:

```
MAP feat/login · 플레이 0:42
MAP main ⚠ 보호 · 플레이 1:05
```

The branch comes from git (`@abc1234` when detached; `저장소 밖` outside a repository), read when the session starts, after each turn and once a minute. A protected branch is marked `⚠ 보호`: work there goes straight to it. `/map` prints the branch, the play time and the number of changed files.

Part of the [GAME MODE pack](../../README.md). Requires Claude Code 2.1.287+; built and tested on 2.1.291.

## Install

```bash
claude plugin marketplace add Reasonofmoon/bitgame-mods
claude plugin install game-map@bitgame-mods
```

## Settings

| | |
|---|---|
| `intensity` (`casual`) | `off` · `casual` · `hardcore` (adds the changed files) |
| `protectedBranches` (`main,master,production,release/*`) | names or patterns, `*` within one path part |

## 한국어

상태 줄에 지금 브랜치와 플레이 시간을 보여줍니다. main 같은 보호 브랜치에는 `⚠ 보호`를 붙입니다.
