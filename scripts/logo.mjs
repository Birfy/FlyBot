#!/usr/bin/env node
// The FlyBot logo: a stylized fly seen from above, two swept wings over a rounded body
// with a pair of eye dots. Writes a light and a dark SVG, and, when a Chrome or Chromium
// is found (CHROME_BIN, else google-chrome, chromium or chromium-browser on PATH), PNG
// copies at the sizes the docs and app icons use.
//
//   node scripts/logo.mjs [out dir]        default: docs/images
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const BOX = 512
const PALETTE = {
  light: { wingA: '#4D6BFE', wingB: '#7FD3FF', body: '#1B2340', eye: '#FFFFFF', vein: '#FFFFFF' },
  dark: { wingA: '#6A84FF', wingB: '#9BE0FF', body: '#E9EDFF', eye: '#141A30', vein: '#141A30' },
}
const PNG_SIZES = [16, 32, 180, 192, 512]

export function logo(mode = 'light') {
  const c = PALETTE[mode]
  // One wing, drawn on the right; the left one is its mirror.
  const wing = 'M268 214 C 330 120, 452 92, 470 150 C 486 204, 404 268, 288 262 Z'
  const vein = 'M282 236 C 340 200, 400 170, 448 152'
  const lower = 'M276 262 C 340 270, 420 300, 410 346 C 400 388, 330 360, 280 300 Z'
  const half = `<path d="${wing}" fill="url(#wing-${mode})"/><path d="${lower}" fill="url(#wing-${mode})" opacity=".55"/><path d="${vein}" fill="none" stroke="${c.vein}" stroke-opacity=".55" stroke-width="7" stroke-linecap="round"/>`
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOX} ${BOX}" width="${BOX}" height="${BOX}" role="img" aria-label="FlyBot">`,
    `<defs><linearGradient id="wing-${mode}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.wingA}"/><stop offset="1" stop-color="${c.wingB}"/></linearGradient></defs>`,
    `<g>${half}</g><g transform="translate(${BOX} 0) scale(-1 1)">${half}</g>`,
    `<rect x="214" y="168" width="84" height="236" rx="42" fill="${c.body}"/>`,
    `<circle cx="256" cy="150" r="56" fill="${c.body}"/>`,
    `<circle cx="234" cy="144" r="12" fill="${c.eye}"/><circle cx="278" cy="144" r="12" fill="${c.eye}"/>`,
    `<path d="M232 300 H280 M236 340 H276" stroke="${c.eye}" stroke-opacity=".35" stroke-width="8" stroke-linecap="round"/>`,
    '</svg>\n',
  ].join('')
}

const findChrome = () => {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN
  for (const name of ['google-chrome', 'chromium', 'chromium-browser']) {
    try { return execFileSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).trim() } catch {}
  }
  return null
}

function rasterize(chrome, svgFile, pngFile, size) {
  const dir = mkdtempSync(join(tmpdir(), 'flybot-logo-'))
  try {
    const html = join(dir, 'logo.html')
    writeFileSync(html, `<html><body style="margin:0;background:transparent"><img src="file://${svgFile}" width="${size}" height="${size}" style="display:block"></body></html>`)
    execFileSync(chrome, ['--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000',
      `--user-data-dir=${join(dir, 'profile')}`, `--window-size=${size},${size}`, `--screenshot=${pngFile}`, `file://${html}`], { stdio: 'ignore' })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = resolve(process.argv[2] ?? join(import.meta.dirname, '../docs/images'))
  mkdirSync(out, { recursive: true })
  for (const mode of ['light', 'dark']) {
    const file = join(out, mode === 'light' ? 'logo.svg' : 'logo-dark.svg')
    writeFileSync(file, logo(mode))
    console.log(`wrote ${file}`)
  }
  const chrome = findChrome()
  if (chrome === null) console.log('no Chrome found: skipped the PNG copies')
  else {
    for (const size of PNG_SIZES) {
      const file = join(out, size === 512 ? 'logo.png' : `logo-${size}.png`)
      rasterize(chrome, join(out, 'logo.svg'), file, size)
      console.log(`wrote ${file}`)
    }
    rasterize(chrome, join(out, 'logo-dark.svg'), join(out, 'logo-dark.png'), 512)
    console.log(`wrote ${join(out, 'logo-dark.png')}`)
  }
}
