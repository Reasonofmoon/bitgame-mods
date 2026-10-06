// GAME MODE shared look (copied into each GAME MODE plugin: a hooks module
// may only import files of its own plugin). Change every copy together;
// scripts/check.sh fails when the copies differ.
//
// nes / gameboy / amber are raw colors made for dark terminals, taken from
// the design boards. `theme` uses Claude Code's theme keys, so it follows the
// person's theme: pick it on a light background. Its `win` is empty: windows
// draw with no fill there.

export type PaletteName = 'nes' | 'gameboy' | 'amber' | 'theme'

export type Palette = {
  /** Headings, gold, the level. */
  title: string
  ok: string
  warn: string
  bad: string
  info: string
  dim: string
  text: string
  /** A window's border. */
  frame: string
  /** A window's fill; '' for none. */
  win: string
  /** The bright inner edge of a window, and a highlighted badge's text. */
  edge: string
  /** A bar's empty cells. */
  off: string
}

const PALETTES: Record<PaletteName, Palette> = {
  nes: {
    title: '#f8d830',
    ok: '#58d854',
    warn: '#ff8a6a',
    bad: '#f83800',
    info: '#3cbcfc',
    dim: '#b8b8f0',
    text: '#fcfcfc',
    frame: '#5060d8',
    win: '#1c2a8a',
    edge: '#fcfcfc',
    off: '#2c3a98',
  },
  gameboy: {
    title: '#e0f8d0',
    ok: '#9bbc0f',
    warn: '#e0f8d0',
    bad: '#f8f8a0',
    info: '#c4e890',
    dim: '#8bac0f',
    text: '#e0f8d0',
    frame: '#9bbc0f',
    win: '#1e4a1e',
    edge: '#e0f8d0',
    off: '#306230',
  },
  amber: {
    title: '#ffd060',
    ok: '#ffb000',
    warn: '#ff7040',
    bad: '#ff5a2a',
    info: '#ffe0a0',
    dim: '#c89040',
    text: '#ffd9a0',
    frame: '#ffb000',
    win: '#2a1700',
    edge: '#ffe0a0',
    off: '#4a2a00',
  },
  theme: {
    title: 'claude',
    ok: 'success',
    warn: 'warning',
    bad: 'error',
    info: 'suggestion',
    dim: 'subtle',
    text: 'text',
    frame: 'promptBorder',
    win: '',
    edge: 'text',
    off: 'subtle',
  },
}

export function paletteOf(name: unknown): Palette {
  return name === 'gameboy' || name === 'amber' || name === 'theme' ? PALETTES[name] : PALETTES.nes
}

export type Intensity = 'off' | 'casual' | 'hardcore'

export function intensityOf(value: unknown): Intensity {
  return value === 'off' || value === 'hardcore' ? value : 'casual'
}

/** A bar of `cells` blocks, `percent` of them full. */
export function bar(percent: number, cells: number): string {
  const full = Math.max(0, Math.min(cells, Math.round((percent / 100) * cells)))
  return '█'.repeat(full) + '░'.repeat(cells - full)
}

/** Box props for a window in this palette: a double border and, where the palette has one, a fill. */
export function windowProps(pal: Palette): { borderStyle: 'double'; borderColor: string; backgroundColor?: string; paddingX: number } {
  return pal.win === ''
    ? { borderStyle: 'double', borderColor: pal.frame, paddingX: 1 }
    : { borderStyle: 'double', borderColor: pal.frame, backgroundColor: pal.win, paddingX: 1 }
}

/** `m:ss`, or `h:mm:ss` past an hour. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const two = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`
}

/** A cost in the chosen currency: `$1.23`, or `₩1,722` at `krwPerUsd`. */
export function money(usd: number, currency: 'usd' | 'krw', krwPerUsd: number): string {
  if (currency === 'krw') return '₩' + String(Math.round(usd * krwPerUsd)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return '$' + usd.toFixed(2)
}
