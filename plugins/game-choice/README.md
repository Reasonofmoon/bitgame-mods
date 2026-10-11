# GAME MODE · Choice

When Claude ends an answer with a `[상태 요약]` (status summary), its item 4 — the prompt to paste next time — becomes the prompt box's dim suggestion: press **Tab** to take it. Item 3's decisions become buttons above the prompt:

```
다음 할 일 결정  섀도 모드 · Claude 순서 (Jev 순위 숨김)  [닫기]
Q1. 테스트 범위를 어떻게 할까요?  [관련 파일만]  [전체]
Q2. 커밋을 나눌까요?  [✓ 논리 단위로]  [한 번에]
다듬은 프롬프트가 입력창 제안에 있습니다 (Tab)
```

Each pick appends that option's sentence to the suggestion at once. When every decision is picked, a fork of the session rewrites the prompt into one self-contained paragraph with the choices settled, and that becomes the suggestion. Submitting anything clears the card.

The summary format it reads (item 3 is machine-read):

```
[상태 요약]
1. 지금까지 한 일:
2. 아직 남은 일:
3. 내가 결정해야 할 것:
   - Q: 테스트 범위를 어떻게 할까요?
     - 관련 파일만 => 관련 파일 단위로만 테스트를 돌려라.
     - 전체 => 전체 테스트를 돌려라.
4. 다음에 이어서 할 때 붙여넣을 프롬프트:
   - (one self-contained paragraph)
5. 산출물/파일/링크:
```

The last `[상태 요약]` in the answer counts. A decision needs at least two `label => sentence` options; an item 4 that is empty or `(해당 없음)` makes no card.

Part of the [GAME MODE pack](../../README.md). Requires Claude Code 2.1.287+; built and tested on 2.1.296.

## Jev ranking and shadow mode

The decisions are sent to **Jev** (TypeSafe System One, `api.typesafe.ai`) with items 1, 2 and 4 as context (at most 3000 characters). Jev returns each option's probability and its confidence. Without `TYPESAFE_API_KEY`, on an HTTP error, or after 8 seconds, the buttons keep Claude's order and the header says why.

**Shadow mode** (on by default) keeps Jev's odds and order off the buttons, so the pick is yours, and records what an auto-approver *would* have picked: every decision at ≥ 90% with confidence ≥ 80%, and no option naming a risky act (commit, push, merge, deploy, delete, publish, send, cost, settings — in Korean or English). Nothing is ever picked or sent on its strength.

Each pick is kept (last 500) in the plugin's store and mirrored to `~/.claude/game-choice/picks.json`: the options and their odds, Jev's first choice, your pick, whether odds were hidden, and the shadow verdict. `scripts/analyze-picks.mjs` reads it and reports Jev's first-choice hit rate, calibration per probability band, the shadow hit rate, and whether all four bars for turning auto-approval on are met (30 cards, 90% each). Fewer than 10 shadow-eligible cards means another week of shadow mode, not lower bars.

```bash
node plugins/game-choice/scripts/analyze-picks.mjs [path/to/picks.json]
```

## Skill suggestions

While you type (after an 800 ms pause, drafts of 12 characters or more that do not start with `/`), the draft and your non-built-in commands (up to 254, the ones sharing most words with the draft first) go to Jev. A match at or above the threshold shows `스킬 제안: /<name> 72%` with **적용** (fill `/<name> <draft>`), **맞춤 다듬기** (a fork rewrites the draft for that skill, with what the session knows) and **×**.

## Install

```bash
claude plugin marketplace add Reasonofmoon/bitgame-mods
claude plugin install game-choice@bitgame-mods
```

Set `TYPESAFE_API_KEY` in the environment Claude Code starts from for Jev ranking and skill suggestions; the resume suggestion and the buttons work without it.

## Settings and commands

| | |
|---|---|
| `shadowMode` (`true`) | hide Jev's odds and order on the buttons; record what auto would have picked |
| `skillThreshold` (`50`) | show a skill only at this probability (%) or above, 10–95 |
| `skillSuggest` (`true`) | send drafts to Jev to match them against your skills; `false` sends no drafts |
| `/choice` | the last Jev call (purpose, time, key present, HTTP status, failure, top odds) and the current card's state and shadow verdict |

The last Jev call is also written to `~/.claude/game-choice/last-jev.json` (never the key).

## Known limits

- **Drafts leave the machine.** With `skillSuggest` on and a key set, what you type is sent to typesafe.ai; turn it off for private work.
- It reads only the `[상태 요약]` format above; another heading or numbering makes no card.
- The suggestion cannot show while a turn runs; it appears once the prompt box is free.
- The engine's own next-prompt suggestion is replaced while a card is up.

## 한국어

답변 끝의 `[상태 요약]`에서 4번 재개 프롬프트를 입력창의 흐린 제안(Tab)으로 띄우고, 3번 결정을 버튼으로 보여 줍니다. 고를 때마다 그 문장이 제안에 붙고, 다 고르면 포크가 하나의 단락으로 다듬어 줍니다. Jev(typesafe.ai)가 뒤에서 옵션 확률을 매기며, 섀도 모드(기본)에서는 확률을 숨기고 "자동이었다면 무엇을 골랐을지"만 `~/.claude/game-choice/picks.json`에 기록합니다. 입력 중에는 맞는 스킬을 제안합니다(초안이 typesafe.ai로 전송되므로 원치 않으면 `skillSuggest`를 끄세요).
