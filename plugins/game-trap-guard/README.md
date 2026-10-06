# GAME MODE · Trap Guard

Stops a tool call that would put a secret where it does not belong, **before it runs**:

| Call | Refused when |
|---|---|
| Bash | a literal key or token is in the command (`curl -H "x-api-key: sk-ant-…"`) |
| Bash | it prints a secret file or variable: `cat .env`, `grep KEY .env`, `echo $API_KEY`, `printenv GITHUB_TOKEN`, a bare `printenv` / `env` |
| Read · Grep | the target is a secret file: `.env*` (not `.env.example`/`.sample`/`.template`), `id_rsa`/`id_ed25519`, `*.pem`/`*.p12`, `~/.aws/credentials`, `.netrc`, `.pypirc`, `~/.docker/config.json` |
| Write · Edit · NotebookEdit | a literal key is written into a file that is **not** an `.env` file (an `.env` file is the right place for one) |
| WebFetch | a key is in the URL |

Keys recognised: Anthropic, OpenAI, AWS access keys, GitHub tokens, Slack tokens, Google API keys, Stripe live keys, private key blocks, JSON web tokens. Messages never repeat the secret: `(sk-ant…, 53자)`.

Claude receives:

```text
game-trap-guard blocked this call: it prints a .env file into the conversation (.env). Keep secrets out of commands,
files and the conversation: read them from an environment variable (for example $ANTHROPIC_API_KEY) or a secret store,
refer to them by name, and keep literal values only in an .env file. If this is a false positive, ask the user to type
/trap-guard pass and then retry.
```

You get a toast (`TRAP! BASH 차단 — …`) and a dim transcript line. Real run: [examples/RUN-2026-10-06.md](../../examples/RUN-2026-10-06.md).

Part of the [GAME MODE pack](../../README.md). Requires Claude Code 2.1.287+; built and tested on 2.1.291.

## Install

```bash
claude plugin marketplace add Reasonofmoon/bitgame-mods
claude plugin install game-trap-guard@bitgame-mods
```

## Modes and commands

| Command | |
|---|---|
| `/trap-guard` | status |
| `/trap-guard block` | refuse (default; setting `mode`) |
| `/trap-guard warn` | let it run; Claude gets a note, you get a toast |
| `/trap-guard off` | stop checking |
| `/trap-guard pass` | let the next refused call run once (within 10 minutes) |

`warn`, `off` and `pass` are accepted only when **you** type them, so Claude cannot lift the guard by running the command itself. The mode is remembered across sessions.

## Known limits

- Pattern-based: an unusual key format passes, and a test fixture that looks like a real key is refused (use `pass`, or build the fake value at run time).
- `grep -r KEY .` over a folder that holds an `.env` is not caught; only explicit secret-file targets are.

## 한국어

비밀키가 명령어·소스 파일·대화에 들어가려는 순간 실행 전에 막습니다(`cat .env`, `echo $API_KEY`, 키를 코드에 직접 쓰기 등). `.env` 파일에 키를 쓰는 것은 허용합니다. 오탐이면 직접 `/trap-guard pass`를 입력하세요.
