// Run from the repository root: node web/scripts/verify-scene-shadow.mjs
// Compares native CSS box shadows with the canvas raster at two pixel ratios.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../../package.json', import.meta.url))
const { buildSync } = require('esbuild')
const root = fileURLToPath(new URL('../../', import.meta.url))
const bundle = buildSync({
  stdin: {
    contents: `export { paintBoxShadows } from './src/scene/paint-shadow'`,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'BoxShadowTest',
  target: 'es2020',
}).outputFiles[0].text
const session = `liquid-box-shadow-${process.pid}`
const screenshot = join(tmpdir(), `${session}.png`)

function browser(args, input) {
  const result = spawnSync('agent-browser', ['--session', session, '--json', ...args], {
    encoding: 'utf8',
    input,
    timeout: 45_000,
    maxBuffer: 3 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  const response = JSON.parse(result.stdout)
  if (!response.success) throw new Error(JSON.stringify(response.error))
  return response.data
}

function fixtures(api) {
  document.body.style.cssText = 'margin:0;background:white'
  const cases = [
    { shadow: 'rgba(0,0,0,.6) 0px 4px 8px 0px', radius: '22px', border: '0' },
    {
      shadow: 'rgba(0,0,0,.45) 0px 2px 5px, rgba(0,80,180,.3) 5px 3px 8px',
      radius: '22px',
      border: '0',
    },
    { shadow: 'rgba(0,0,0,.7) 4px 4px 8px 8px inset', radius: '22px', border: '5px solid #586c80' },
    { shadow: 'rgba(255,0,0,.6) 0px 0px 0px 12px', radius: '4px', border: '0' },
    {
      shadow: 'rgba(0,0,0,.6) 0px 4px 5px, rgba(0,0,255,.5) 4px 4px 6px inset',
      radius: '10px 30px / 20px 12px',
      border: '5px solid #586c80',
    },
  ]
  const reports = []
  for (const ratio of [1, 2]) {
    for (const [index, test] of cases.entries()) {
      const row = (ratio - 1) * cases.length + index
      for (let column = 0; column < 3; column++) {
        const cell = document.createElement('div')
        cell.style.cssText = `position:absolute;left:${column * 360}px;top:${row * 160}px;width:360px;height:160px;overflow:hidden;background:white`
        const box = document.createElement('div')
        box.style.cssText = `position:absolute;left:100px;top:45px;width:140px;height:65px;box-sizing:border-box;border:${test.border};border-radius:${test.radius};background:#c5d6e8;box-shadow:${test.shadow}`
        cell.append(box)
        document.body.append(cell)
        if (column === 0) continue
        if (column === 2) {
          box.style.boxShadow = 'none'
          continue
        }
        const result = api.paintBoxShadows(getComputedStyle(box), 140, 65, ratio)
        reports.push({ row, status: result.status, reason: result.reason })
        if (result.status !== 'ready') continue
        box.style.boxShadow = 'none'
        box.style.zIndex = '1'
        for (const [sprite, zIndex] of [
          [result.outer, 0],
          [result.inset, 2],
        ]) {
          if (!sprite) continue
          const canvas = sprite.bitmap
          canvas.style.cssText = `position:absolute;left:${100 + sprite.offsetX}px;top:${45 + sprite.offsetY}px;width:${sprite.width}px;height:${sprite.height}px;z-index:${zIndex}`
          cell.append(canvas)
        }
      }
    }
  }
  return reports
}

function compareScreenshot(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onerror = () => reject(new Error('Could not decode screenshot'))
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d', { willReadFrequently: true })
      context.drawImage(image, 0, 0)
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
      const results = []
      for (let row = 0; row < 10; row++) {
        let error = 0
        let signal = 0
        let count = 0
        for (let y = row * 160; y < (row + 1) * 160; y++) {
          for (let x = 0; x < 360; x++) {
            const native = (y * canvas.width + x) * 4
            const rendered = native + 360 * 4
            const unshadowed = native + 720 * 4
            for (let channel = 0; channel < 3; channel++) {
              error += Math.abs(data[native + channel] - data[rendered + channel])
              signal += Math.abs(data[native + channel] - data[unshadowed + channel])
              count++
            }
          }
        }
        results.push({ row, error: error / count, signal: signal / count })
      }
      resolve(results)
    }
    image.src = url
  })
}

let opened = false
try {
  browser(['open', 'about:blank'])
  opened = true
  browser(['set', 'viewport', '1080', '1600'])
  const reports = browser(
    ['eval', '--stdin'],
    `${bundle}\n(${fixtures.toString()})(BoxShadowTest)`
  ).result
  assert.equal(reports.length, 10)
  for (const report of reports) assert.equal(report.status, 'ready', JSON.stringify(report))
  browser(['screenshot', screenshot])
  const url = `data:image/png;base64,${readFileSync(screenshot).toString('base64')}`
  const result = browser(
    ['eval', '--stdin'],
    `(${compareScreenshot.toString()})(${JSON.stringify(url)})`
  ).result
  for (const row of result) {
    assert.ok(
      row.signal > 0.3,
      `Fixture does not visibly exercise a shadow: ${JSON.stringify(row)}`
    )
    assert.ok(
      row.error < Math.max(0.2, row.signal * 0.15),
      `Canvas differs from CSS: ${JSON.stringify(row)}`
    )
  }
  console.log(`PASS ${result.length} CSS/canvas shadow comparisons at 1x and 2x`)
} finally {
  if (opened) {
    try {
      browser(['close'])
    } catch {}
  }
  try {
    unlinkSync(screenshot)
  } catch {}
}
