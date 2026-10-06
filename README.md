<p align="center">
  <img src="docs/assets/hero.png" alt="GAME MODE — 8-bit looks, real jobs" width="100%" />
</p>

<p align="center">
  <a href="#start-in-30-seconds"><strong>▶ Start in 30 seconds</strong></a>
  &nbsp;·&nbsp;
  <a href="#see-it-fire"><strong>See it fire</strong></a>
  &nbsp;·&nbsp;
  <a href="#the-seven-mods"><strong>The seven mods</strong></a>
  &nbsp;·&nbsp;
  <a href="#settings"><strong>Settings</strong></a>
  &nbsp;·&nbsp;
  <a href="docs/ROADMAP.md"><strong>Roadmap</strong></a>
  &nbsp;·&nbsp;
  <a href="#한국어-요약"><strong>한국어</strong></a>
</p>

<p align="center">
  <img alt="Claude Code" src="https://img.shields.io/badge/claude%20code-2.1.287%2B-3cbcfc?style=for-the-badge&labelColor=000000" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-58d854?style=for-the-badge&labelColor=000000" />
  <img alt="Rule" src="https://img.shields.io/badge/rule-every%20pixel%20does%20a%20job-f8d830?style=for-the-badge&labelColor=000000" />
  <a href="https://github.com/Reasonofmoon/bitgame-mods/actions/workflows/check.yml"><img alt="check" src="https://img.shields.io/github/actions/workflow/status/Reasonofmoon/bitgame-mods/check.yml?branch=main&label=check&style=for-the-badge&labelColor=000000&color=fca044" /></a>
</p>

---

## 8-bit looks, real jobs

**bitgame-mods** is a Claude Code plugin marketplace of **mods**: small hooks modules that run inside the Claude Code engine. Together they are **GAME MODE**: Claude Code dressed as an 8-bit game, where each game element sits where it does work.

> A HUD that is only decoration is noise.  
> **Here HP is your context, MP your plan usage, G your bill — and the traps actually stop things.**

---

## Kernel (one rule · seven mods)

| You see | What it is | What it does |
|---------|------------|--------------|
| `LV 3  HP █████░░░ 62%  MP ████░░░░ 48% 5h  G $1.24` | **HUD** above the prompt | context left, plan usage left, session cost; at low HP, rest (`/compact`) and save (`/save`) buttons |
| `▸ BASH  npm test  MISS` + `✗ 2 failed` | **Battle log** | failures stand out in a long transcript; a folded group with a failure unfolds by itself |
| `TRAP!` | **Trap guard** | refuses calls that would leak a secret |
| `BARRIER!` | **Barrier** | refuses calls that cannot be undone |
| `LOOP 2/3` | **Loop breaker** | stops the same failure being retried unchanged |
| `★ SAVE POINT ★` | **Save point** | `/save` = what was done, what is left, decisions, a resume prompt, the files made; next session resumes on Tab |
| ♪ | **Earcons** | a sound when a prompt or question waits on you, a long turn ends, a guard refuses (macOS) |

---

<a id="see-it-fire"></a>

## See it fire

A real Claude Code 2.1.291 session in a throwaway repository with an uncommitted change and an `.env`. Claude was asked to run six commands as written. What it received:

```text
1. game-trap-guard blocked this call: it prints a .env file into the conversation (.env). Keep secrets out of commands, files and the conversation: …
2. game-barrier blocked this call: it discards uncommitted changes (git reset --hard). This cannot be undone from here. Find a reversible way …
3. Exit code 2 / ls: cannot access '/nonexistent-dir-xyz': No such file or directory
4. Exit code 2 / ls: cannot access '/nonexistent-dir-xyz': No such file or directory      ← LOOP 2/3
5. Exit code 2 / ls: cannot access '/nonexistent-dir-xyz': No such file or directory      ← LOOP 3
6. game-loop-breaker blocked this call: `ls /nonexistent-dir-xyz` already failed the same way 3 times in a row (…). Running it again unchanged will not help. …
```

The uncommitted change survived. Then `/save` in a resumed session:

```text
◆ SAVE POINT · 로그인 버그 메모 파일 생성
SLOT 1/1 · 2026-10-06 21:03 · TURN 2 · $0.08 · CTX 4%
[CLEARED]
- /tmp/gm-smoke/notes.txt 파일 생성
…
[PASSWORD]
/tmp/gm-smoke/notes.txt 파일에는 첫 줄에 '로그인 버그 메모'만 적혀 있습니다. …
```

Full log: [`examples/RUN-2026-10-06.md`](examples/RUN-2026-10-06.md).

---

<a id="start-in-30-seconds"></a>

## Start in 30 seconds

```bash
claude plugin marketplace add Reasonofmoon/bitgame-mods
claude plugin install game-hud@bitgame-mods
claude plugin install game-battle-log@bitgame-mods
claude plugin install game-trap-guard@bitgame-mods
claude plugin install game-barrier@bitgame-mods
claude plugin install game-loop-breaker@bitgame-mods
claude plugin install game-save-point@bitgame-mods
claude plugin install game-earcons@bitgame-mods
```

Or one at a time from inside a session: `/plugin install game-hud --marketplace Reasonofmoon/bitgame-mods`. Each mod works alone; install only the ones you want.

Try one without installing: `claude --plugin-dir ./plugins/game-trap-guard`.

Requires **Claude Code 2.1.287 or later** (mods). Built and tested on 2.1.291. Coding agents: read [AGENTS.md](AGENTS.md) first.

---

<a id="the-seven-mods"></a>

## The seven mods

| Mod | Hooks | Commands |
|-----|-------|----------|
| [**game-hud**](plugins/game-hud) | `AbovePrompt` · `session.measure` · `turn.complete` | `/hud` · `hide` · `show` |
| [**game-battle-log**](plugins/game-battle-log) | `ToolUse` · `ToolResult` · `ToolGroup` | `/battle-log on` · `off` |
| [**game-trap-guard**](plugins/game-trap-guard) | `tool.call` (refuses) | `/trap-guard` · `block` · `warn` · `off` · `pass` |
| [**game-barrier**](plugins/game-barrier) | `tool.call` (refuses) | `/barrier` · `block` · `warn` · `off` · `pass` |
| [**game-loop-breaker**](plugins/game-loop-breaker) | `tool.call` · `prompt.submit` | `/loop-breaker` · `reset` · `block` · `warn` · `off` · `pass` |
| [**game-save-point**](plugins/game-save-point) | `command.run` · `$.model.fork` · `prompt.suggest` · `CommandOutput` | `/save [note\|show\|list]` · `/load [n]` |
| [**game-earcons**](plugins/game-earcons) | `$.audio.play` · `tool.check` · `turn.complete` | `/earcons` · `test` · `on` · `off` |

What each guard refuses, in one line each (details in each README):

- **Trap guard**: literal keys in commands, URLs or source files (an `.env` file may hold them); `cat .env`, `grep KEY .env`, `echo $API_KEY`, a bare `printenv`; reading `.env`, `id_rsa`, `*.pem`, `~/.aws/credentials`.
- **Barrier**: force-push or delete `main`/`master`/`prod`/`release`; `reset --hard`, `clean -f`, `checkout .`, `restore .`, `stash clear`, `branch -D`; `rm -r` on `/`, `~`, the project root or outside the project; `npm publish`, `cargo publish`, `gh release create`, `docker push`; `terraform destroy`, `kubectl delete`; `DROP TABLE` through a database client; `mkfs`, `dd of=/dev/…`; edits outside the project (links resolved).
- **Loop breaker**: the 4th run of a call that failed the same way 3 times in a row with nothing changed in between (timings ignored, counts kept).

---

<a id="settings"></a>

## Settings

Change any of these with `/plugin configure <mod>@bitgame-mods`.

| Setting | Mods | Default | Values |
|---------|------|---------|--------|
| `intensity` | HUD, battle log, save point, earcons | `casual` | `off` · `casual` · `hardcore` |
| `palette` | HUD, battle log, save point | `nes` | `nes` · `gameboy` · `amber` (dark terminals) · `theme` (follows your Claude Code theme; use it on a light background) |
| `mode` | trap guard, barrier, loop breaker | `block` | `block` · `warn` · `off` |

- **`pass`** lets the next refused call run once (within 10 minutes). `pass`, `warn` and `off` are accepted only when **you** type them, so Claude cannot lift a guard by running the command itself.
- **Pixel font:** in a terminal the look comes from your terminal's font. Set it to **Galmuri Mono 11** ([quiple/galmuri](https://github.com/quiple/galmuri), OFL) and the whole screen matches.

---

## Together

The HUD's `세이브` button runs `/save`; the battle log marks a guard's refusal `BLOCK`; earcons plays `block` and `save`. The links are plain text (`game-<mod> blocked this call:`), so any subset works and nothing breaks when one is missing.

---

## Why this wins (falsifiable)

| | Plain Claude Code | Settings hooks (scripts) | **bitgame-mods** |
|--|--|--|--|
| Context, plan usage and cost in view | `/context`, `/cost` on demand | status line script | **always above the prompt, with a low-HP action** |
| A secret about to be printed or written | permission prompt, if asked | if you write it | **refused before it runs, with what to do instead** |
| `git reset --hard` / force-push to main | permission prompt, if asked | if you write it | **refused; one-time `pass` only you can type** |
| The same failing command, fourth time | runs | rarely | **refused until something changes** |
| Resume tomorrow | `--continue`, then explain again | — | **`/save` screen; Tab in the next session** |
| Tests you can run | — | rarely | **60 tests, `claude plugin test`** |

If a guard refuses an ordinary command, or misses a case its README lists, it is wrong: [open an issue](https://github.com/Reasonofmoon/bitgame-mods/issues) with the command.

---

## Known limits

- **The permission prompt cannot be changed by a mod.** Earcons plays `ask` when one opens instead.
- **Guards read text, not intent.** A script that runs `npm publish` inside (`./deploy.sh`) is not opened; an unusual key format passes.
- **Polling looks like a loop.** `curl localhost:3000` failing the same way while a server boots will be sealed at the 4th try; wrap the wait in one command or use `warn`.
- **Sound needs macOS** (`afplay`). Linux and Windows terminals stay silent.
- **HUD and battle log are tested on the `terminal` and `desktop` surfaces** through `claude plugin test`; headless runs (`claude -p`) draw nothing.

---

## Layout

```
.claude-plugin/marketplace.json   the catalog `claude plugin marketplace add` reads
plugins/game-*/                   one plugin each: plugin.json · hooks/ · tests/ · README
plugins/game-earcons/sounds/      the 8-bit WAV cues (scripts/make-earcons.py writes them)
examples/RUN-2026-10-06.md        real-run log of the guards and /save
docs/                             ROADMAP · hero image (docs/src/hero.html → docs/assets/hero.png)
scripts/check.sh                  strict validate + tests for every plugin (CI runs this)
```

Zero runtime dependencies. The hooks modules run inside Claude Code's own mod environment: no Node, no build step.

---

## 한국어 요약

**GAME MODE**는 Claude Code를 8비트 게임 화면처럼 꾸미되, **모든 요소가 실제 일을 하도록** 만든 Mod 7종입니다.

- `game-hud`: 프롬프트 위에 HP(남은 컨텍스트)·MP(요금제 한도)·G(비용) 표시. HP가 25% 아래면 휴식(`/compact`)·세이브(`/save`) 버튼
- `game-battle-log`: 도구 실행을 HIT/CRIT/MISS/BLOCK으로 표시. 실패하면 오류 첫 줄을 바로 펼침
- `game-trap-guard`: 비밀키 노출(`cat .env`, 코드에 키 직접 쓰기 등)을 실행 전에 차단
- `game-barrier`: main 강제 push, `reset --hard`, 프로젝트 밖 `rm -rf`, publish 같은 되돌릴 수 없는 명령 차단
- `game-loop-breaker`: 같은 실패를 그대로 반복하면 4번째 실행을 차단
- `game-save-point`: `/save`로 한 일·남은 일·결정할 것·이어하기 프롬프트·산출물을 세이브 화면으로 저장. 다음 세션에서 Tab으로 이어하기
- `game-earcons`: 확인 대기·완료·오류·차단·세이브를 8비트 효과음으로 알림(macOS)

설치: `claude plugin marketplace add Reasonofmoon/bitgame-mods` → `claude plugin install game-hud@bitgame-mods` (나머지도 같은 방식). 기본값은 가드 3종 차단(block), 연출 강도 CASUAL, 팔레트 NES입니다. 가드를 잠시 풀려면 직접 `/trap-guard pass`처럼 입력하세요. Claude가 대신 입력해도 받아들이지 않습니다.

---

## License

MIT · Reason of Moon. The hero image uses the Galmuri font (© Lee Minseo, [SIL OFL 1.1](docs/src/fonts/OFL.md)).
