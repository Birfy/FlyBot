#!/usr/bin/env node
// The FlyBot logo, "Wingbot": a chat-bubble Bot face with two swept wings on each side
// (a Bot that talks and flies). Flat colors on a 512 grid, so it reads at 16 px. Writes a
// light and a dark mark, a wordmark lockup of each, and, when a Chrome or Chromium is found
// (CHROME_BIN, else google-chrome, chromium or chromium-browser on PATH), PNG copies at the
// sizes the docs and app icons use.
//
//   node scripts/logo.mjs [out dir]        default: docs/images
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const BOX = 512
const PALETTE = {
  light: { brand: '#3B5BFD', wing: '#8FB2FF', face: '#FFFFFF', text: '#0F1530' },
  dark: { brand: '#6E87FF', wing: '#A9C2FF', face: '#0F1530', text: '#EEF1FF' },
}
const PNG_SIZES = [16, 32, 180, 192, 512]

function mark(c) {
  // The two wings on the left; the right pair is their mirror.
  const wings = '<path d="M150 238 C 96 200, 40 196, 22 214 C 8 230, 40 262, 150 300 Z"/>'
    + '<path d="M150 318 C 104 300, 62 306, 54 322 C 48 338, 84 352, 150 352 Z"/>'
  return [
    `<g fill="${c.wing}">${wings}</g><g fill="${c.wing}" transform="translate(${BOX} 0) scale(-1 1)">${wings}</g>`,
    `<path d="M196 132 H316 A80 80 0 0 1 396 212 V300 A80 80 0 0 1 316 380 H250 L188 432 V374 A80 80 0 0 1 116 300 V212 A80 80 0 0 1 196 132 Z" fill="${c.brand}"/>`,
    `<rect x="196" y="222" width="34" height="58" rx="17" fill="${c.face}"/><rect x="282" y="222" width="34" height="58" rx="17" fill="${c.face}"/>`,
    `<circle cx="256" cy="100" r="22" fill="${c.brand}"/><rect x="248" y="104" width="16" height="34" fill="${c.brand}"/>`,
  ].join('')
}

export function logo(mode = 'light') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOX} ${BOX}" width="${BOX}" height="${BOX}" role="img" aria-label="FlyBot">${mark(PALETTE[mode])}</svg>\n`
}

export function wordmark(mode = 'light') {
  const c = PALETTE[mode]
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1240 360" width="1240" height="360" role="img" aria-label="FlyBot">`
    + `<g transform="translate(24 24) scale(0.609)">${mark(c)}</g>`
    + `<text x="384" y="236" font-family="Inter, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-weight="800" font-size="190" letter-spacing="-6" fill="${c.text}">Fly<tspan fill="${c.brand}">Bot</tspan></text></svg>\n`
}

const findChrome = () => {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN
  for (const name of ['google-chrome', 'chromium', 'chromium-browser']) {
    try { return execFileSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).trim() } catch {}
  }
  return null
}

function rasterize(chrome, svgFile, pngFile, size, height = size) {
  const dir = mkdtempSync(join(tmpdir(), 'flybot-logo-'))
  try {
    const html = join(dir, 'logo.html')
    writeFileSync(html, `<html><body style="margin:0;background:transparent"><img src="file://${svgFile}" width="${size}" height="${height}" style="display:block"></body></html>`)
    execFileSync(chrome, ['--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000',
      `--user-data-dir=${join(dir, 'profile')}`, `--window-size=${size},${height}`, `--screenshot=${pngFile}`, `file://${html}`], { stdio: 'ignore' })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = resolve(process.argv[2] ?? join(import.meta.dirname, '../docs/images'))
  mkdirSync(out, { recursive: true })
  for (const mode of ['light', 'dark']) {
    const file = join(out, mode === 'light' ? 'logo.svg' : 'logo-dark.svg')
    writeFileSync(file, logo(mode))
    console.log(`wrote ${file}`)
    const words = join(out, mode === 'light' ? 'logo-wordmark.svg' : 'logo-wordmark-dark.svg')
    writeFileSync(words, wordmark(mode))
    console.log(`wrote ${words}`)
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
    for (const name of ['logo-wordmark', 'logo-wordmark-dark']) {
      rasterize(chrome, join(out, `${name}.svg`), join(out, `${name}.png`), 1240, 360)
      console.log(`wrote ${join(out, `${name}.png`)}`)
    }
  }
}
