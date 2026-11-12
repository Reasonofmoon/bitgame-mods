// analyze-picks.mjs
// Reads ~/.claude/game-choice/picks.json (written by the game-choice mod) and reports:
// how often the person picked Jev's first choice, how Jev's odds match the picks per bin,
// the same two figures for Gemini Decision 1 when a shadow call was recorded, how often
// the two engines chose the same option, how often the shadow auto-approver would have
// picked what the person picked, and whether the bar for turning real auto-approval on is met.
// The auto-approval bars stay Jev's: Gemini is a comparison, not a vote.
// Usage: node analyze-picks.mjs [path/to/picks.json]
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { summarizePicks } from './report.mjs'

const file = process.argv[2] ?? join(homedir(), '.claude', 'game-choice', 'picks.json')
const rows = JSON.parse(readFileSync(file, 'utf8'))
console.log(summarizePicks(rows))
