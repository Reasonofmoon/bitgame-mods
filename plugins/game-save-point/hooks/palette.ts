// GAME MODE shared look (copied into each GAME MODE plugin: a hooks module
// may only import files of its own plugin).
//
// nes / gameboy / amber are raw colors made for dark terminals. `theme`
// uses Claude Code's theme keys, so it follows the person's theme: pick it
// on a light background.

export type PaletteName = 'nes' | 'gameboy' | 'amber' | 'theme'

export type Palette = {
  title: string
  ok: string
  warn: string
  bad: string
  info: string
  dim: string
  text: string
  frame: string
}

const PALETTES: Record<PaletteName, Palette> = {
  nes: {
    title: '#f8d830',
    ok: '#58d854',
    warn: '#fca044',
    bad: '#f83800',
    info: '#3cbcfc',
    dim: '#a4a4a4',
    text: '#fcfcfc',
    frame: '#6878f8',
  },
  gameboy: {
    title: '#e0f8d0',
    ok: '#9bbc0f',
    warn: '#c4e890',
    bad: '#f8f8a0',
    info: '#8bac0f',
    dim: '#6a8a2a',
    text: '#e0f8d0',
    frame: '#306230',
  },
  amber: {
    title: '#ffd060',
    ok: '#ffb000',
    warn: '#ff9a40',
    bad: '#ff5a2a',
    info: '#ffe0a0',
    dim: '#a87830',
    text: '#ffd9a0',
    frame: '#a86a00',
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
