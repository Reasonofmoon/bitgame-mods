# Contributing

## Report a wrong refusal or a miss

This is the most useful contribution. Open an issue with:

1. the exact command or file edit Claude made,
2. which guard refused it (`game-… blocked this call: …`) or should have,
3. what it should have done.

A guard that refuses an ordinary command, or misses a case its README lists, is a bug.

## Develop a mod

```bash
git clone https://github.com/Reasonofmoon/bitgame-mods.git && cd bitgame-mods
claude --plugin-dir ./plugins/game-hud     # hot-reloads as you edit
bash scripts/check.sh                       # strict validate + tests, as CI does
```

- Claude Code **2.1.287+**. Loading a mod with `--plugin-dir` writes this build's types into `.claude-plugin/types/` and a `tsconfig.json` beside it; `tsc -p plugins/<name>` then type-checks it.
- One behavior, one test in `plugins/<name>/tests/*.test.ts` (`claude-code/testing`, with `mock.clock` / `mock.store` when the hook uses them). Draw UI on both `terminal` and `desktop` in tests.
- New mod: add `plugins/game-<name>/`, list it in `.claude-plugin/marketplace.json`, add a row to the README tables and `docs/ROADMAP.md`. Read [AGENTS.md](AGENTS.md) first.

## Release

1. Bump `version` in `plugins/<name>/.claude-plugin/plugin.json` **and** the marketplace entry.
2. Add a `CHANGELOG.md` entry with the evidence (validate, tests, a real run if behavior changed).
3. `bash scripts/check.sh`, then push. Users get it with `claude plugin update <name>@bitgame-mods`.

Images: edit `docs/src/hero.html`, then `node scripts/render-assets.mjs` (Playwright + Chromium). Sounds: edit and run `python3 scripts/make-earcons.py`.
