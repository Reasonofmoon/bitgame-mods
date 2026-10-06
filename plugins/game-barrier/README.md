# GAME MODE · Barrier (결계)

Stops tool calls that cannot be undone from inside the session, **before they run**:

| Group | Refused |
|---|---|
| git | force-push or delete a protected branch (`main`, `master`, `prod`, `production`, `release`, `trunk`; a bare `git push -f` reads the current branch from `.git/HEAD`) · `reset --hard` · `clean -f` · `checkout .` · `restore .` · `stash drop`/`clear` · `branch -D` |
| rm | `-r` on `/`, `~`, `$HOME`, `.`, `./*`, `..`, the project root, or anything outside the project and temp folders |
| ship | `npm`/`pnpm`/`yarn publish` (not `--dry-run`), `cargo publish`, `twine upload`, `gh release create`, `docker push`, `gem push` |
| infra | `terraform destroy`, `kubectl delete`, `helm uninstall` |
| data | `DROP TABLE/DATABASE/SCHEMA`, `TRUNCATE TABLE` through a database client (`psql`, `mysql`, `sqlite3`, …); `grep "DROP TABLE"` is fine |
| disk | `mkfs`, `dd of=/dev/…`, a fork bomb |
| files | Write / Edit / NotebookEdit outside the project, `~/.claude` and temp folders, with symbolic links resolved |

Allowed as usual: `rm -rf node_modules dist`, `git push --force-with-lease origin feature/x`, `git reset --soft`, `git restore --staged .`, writes to `/tmp` and plan files under `~/.claude`.

Claude receives:

```text
game-barrier blocked this call: it discards uncommitted changes (git reset --hard). This cannot be undone from here.
Find a reversible way (commit or stash first, work on a branch, stay inside the project), or explain why it is needed
and ask the user to run it themselves or to type /barrier pass.
```

Real run: [examples/RUN-2026-10-06.md](../../examples/RUN-2026-10-06.md) (the uncommitted change survived).

Part of the [GAME MODE pack](../../README.md). Requires Claude Code 2.1.287+; built and tested on 2.1.291.

## Install

```bash
claude plugin marketplace add Reasonofmoon/bitgame-mods
claude plugin install game-barrier@bitgame-mods
```

## Settings and commands

| | |
|---|---|
| `mode` (`block`) | `block` refuses · `warn` runs it and tells Claude and you · `off` |
| `allow` (empty) | more folders where edits and `rm -r` are fine, comma-separated (`~/notes, /srv/shared`) |
| `/barrier` | status, with the folders counted as inside |
| `/barrier block` · `warn` · `off` | change the mode; remembered |
| `/barrier pass` | let the next refused call run once (within 10 minutes) |

`warn`, `off` and `pass` are accepted only when you type them.

## Known limits

- It reads the command text. A script that does the same thing (`./deploy.sh` running `npm publish`) is not opened.
- `rm -r` on a path built from a variable (`rm -rf "$BUILD_DIR"`) is let through: the value is not known before the command runs.
- On Windows, paths are compared without regard to case or slash direction (`C:\`, `c:/`, Git Bash `/c/`). If the project folder cannot be read, edits outside the project are not checked for that session.

## 한국어

되돌릴 수 없는 명령(main 강제 push, `reset --hard`, 프로젝트 밖 `rm -rf`, 배포·publish, `DROP TABLE`, 프로젝트 밖 파일 수정)을 실행 전에 막습니다. 꼭 필요하면 직접 `/barrier pass`를 입력하세요.
