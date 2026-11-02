// Run from web/: node scripts/verify-glass-interior.mjs
// --report records the pre-fix baseline without enforcing whole-pane magnification.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../../package.json', import.meta.url))
const { buildSync } = require('esbuild')
const bundle = buildSync({
  stdin: {
    contents: `export { createSceneRenderer } from './src/scene/renderer'; export { createDisplacementMapSvg } from './src/displacement-map';`,
    resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'InteriorFixture',
  target: 'es2020',
}).outputFiles[0].text
const session = `liquid-interior-check-${process.pid}`

function browser(args, input) {
  const process = spawnSync('agent-browser', ['--session', session, '--json', ...args], {
    encoding: 'utf8',
    input,
    timeout: 45_000,
    maxBuffer: 4 * 1024 * 1024,
  })
  if (process.error) throw process.error
  if (process.status !== 0) throw new Error(process.stderr || process.stdout)
  const response = JSON.parse(process.stdout)
  if (!response.success) throw new Error(JSON.stringify(response.error))
  return response.data
}

async function measureInterior(api) {
  const width = 320,
    height = 320
  const rect = { x: 60, y: 60, width: 200, height: 200 }
  const background = document.createElement('canvas')
  background.width = width
  background.height = height
  const context = background.getContext('2d')
  context.fillStyle = '#101010'
  context.fillRect(0, 0, width, height)
  context.fillStyle = '#fff'
  // Two sharp rulers through the inner 60%, away from the curved edge profile.
  for (const x of [110, 210]) context.fillRect(x - 1, 0, 2, height)
  for (const y of [110, 210]) context.fillRect(0, y - 1, width, 2)
  context.font = 'bold 18px sans-serif'
  context.fillText('LIQUID', 124, 180)
  const map = document.createElement('canvas')
  map.width = rect.width
  map.height = rect.height
  const image = new Image()
  image.src = `data:image/svg+xml,${encodeURIComponent(
    api.createDisplacementMapSvg(rect.width, rect.height, {
      borderRadius: 24,
      borderWidth: 0.07,
      brightness: 50,
      opacity: 0.93,
      blur: 11,
      mixBlendMode: 'difference',
    })
  )}`
  await image.decode()
  map.getContext('2d').drawImage(image, 0, 0)
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)
  const renderer = api.createSceneRenderer(canvas)
  if (!renderer) throw new Error('WebGL unavailable')
  const gl = canvas.getContext('webgl')
  const backdrop = {
    kind: 'sprite',
    rect: { x: 0, y: 0, width, height },
    space: 'viewport',
    opacity: 1,
    bitmap: background,
  }
  const glass = {
    kind: 'glass',
    rect,
    space: 'document',
    opacity: 1,
    radius: 24,
    displacement: [-180, -180, -180],
    blur: 0,
    saturation: 1,
    tint: [0, 0, 0, 0],
    map: { bitmap: map, xChannel: 0, yChannel: 1 },
  }
  const frame = { scrollX: 0, scrollY: 0, width, height, pixelRatio: 1 }
  let uploads = 0
  let draws = 0
  let copies = 0
  const upload = gl.texImage2D.bind(gl)
  gl.texImage2D = (...args) => {
    uploads++
    return upload(...args)
  }
  const draw = gl.drawArrays.bind(gl)
  gl.drawArrays = (...args) => {
    draws++
    return draw(...args)
  }
  const copy = gl.copyTexSubImage2D.bind(gl)
  gl.copyTexSubImage2D = (...args) => {
    copies++
    return copy(...args)
  }
  const read = () => {
    const pixels = new Uint8Array(canvas.width * canvas.height * 4)
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    if (gl.getError() !== gl.NO_ERROR) throw new Error('Interior fixture GL error')
    return pixels
  }
  const pixel = (pixels, x, y) => {
    const index =
      ((canvas.height - Math.floor(y * frame.pixelRatio) - 1) * canvas.width +
        Math.floor(x * frame.pixelRatio)) *
      4
    return [pixels[index], pixels[index + 1], pixels[index + 2]]
  }
  const render = (magnification, scale, source = backdrop) => {
    renderer.setScene({
      background: [0, 0, 0, 1],
      items: [source, { ...glass, magnification, displacement: [scale, scale, scale] }],
    })
    if (!renderer.render(frame)) throw new Error('Interior fixture frame failed')
    return read()
  }
  const line = (pixels, low, high, vertical) => {
    let sum = 0,
      weighted = 0,
      peak = 0,
      brightWidth = 0
    for (let position = low; position < high; position += 1 / frame.pixelRatio) {
      const rgb = vertical ? pixel(pixels, position, 160) : pixel(pixels, 160, position)
      const value = Math.min(...rgb)
      const weight = Math.max(0, value - 30)
      sum += weight
      weighted += weight * position
      peak = Math.max(peak, value)
      if (value > 128) brightWidth += 1 / frame.pixelRatio
    }
    if (!sum) throw new Error('Missing ruler line')
    return { center: weighted / sum, peak, brightWidth }
  }
  const rulers = (pixels) => {
    const left = line(pixels, 92, 140, true),
      right = line(pixels, 188, 236, true)
    const top = line(pixels, 92, 140, false),
      bottom = line(pixels, 188, 236, false)
    return {
      left,
      right,
      top,
      bottom,
      width: right.center - left.center,
      height: bottom.center - top.center,
    }
  }
  const results = []
  try {
    for (const ratio of [1, 2]) {
      frame.pixelRatio = ratio
      const original = render(1, 0)
      const beforeLegacy = { draws, copies }
      const legacy = render(1, -180)
      const legacyWork = { draws: draws - beforeLegacy.draws, copies: copies - beforeLegacy.copies }
      const beforeLens = { draws, copies }
      const magnified = render(1.15, -180)
      const lensWork = { draws: draws - beforeLens.draws, copies: copies - beforeLens.copies }
      const reversed = render(1.15, 180)
      const neutral = render(1.15, 0)
      const legacyRulers = rulers(legacy),
        magnifiedRulers = rulers(magnified)
      let changedBodyPixels = 0,
        identityError = 0
      for (let y = 100; y < 220; y += 1 / ratio)
        for (let x = 100; x < 220; x += 1 / ratio) {
          const a = pixel(legacy, x, y),
            b = pixel(magnified, x, y)
          if (a.some((value, index) => Math.abs(value - b[index]) > 30)) changedBodyPixels++
          const identity = pixel(original, x, y),
            zero = pixel(neutral, x, y)
          identityError = Math.max(
            identityError,
            ...identity.map((value, index) => Math.abs(value - zero[index]))
          )
        }
      const beforeScrollUploads = uploads
      renderer.render({ ...frame, scrollY: 30 })
      const scrollUploads = uploads - beforeScrollUploads
      results.push({
        ratio,
        legacy: legacyRulers,
        magnified: magnifiedRulers,
        reversed: rulers(reversed),
        changedBodyPixels,
        identityError,
        scrollUploads,
        legacyWork,
        lensWork,
      })
    }
    // An independent coordinate ramp exposes any restored seam at the outline.
    const ramp = document.createElement('canvas')
    ramp.width = width
    ramp.height = height
    const rampContext = ramp.getContext('2d'),
      data = rampContext.createImageData(width, height)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4
        data.data[index] = Math.round((x * 255) / 319)
        data.data[index + 1] = Math.round((y * 255) / 319)
        data.data[index + 2] = 64
        data.data[index + 3] = 255
      }
    rampContext.putImageData(data, 0, 0)
    const rampBackdrop = { ...backdrop, bitmap: ramp }
    const edgeErrors = []
    for (const ratio of [1, 2]) {
      frame.pixelRatio = ratio
      const plain = render(1, 0, rampBackdrop),
        lens = render(1.15, -180, rampBackdrop)
      let maximum = 0
      for (let step = 100; step <= 220; step += 10)
        for (const [x, y] of [
          [60, step],
          [259, step],
          [step, 60],
          [step, 259],
        ]) {
          const a = pixel(plain, x, y),
            b = pixel(lens, x, y)
          maximum = Math.max(maximum, ...a.map((value, index) => Math.abs(value - b[index])))
        }
      edgeErrors.push({ ratio, maximum })
    }
    return { results, edgeErrors }
  } finally {
    renderer.dispose()
    canvas.remove()
  }
}

let opened = false
try {
  browser(['open', 'about:blank'])
  opened = true
  const evidence = browser(
    ['eval', '--stdin'],
    `${bundle}\n(${measureInterior.toString()})(InteriorFixture)`
  ).result
  console.log(JSON.stringify(evidence))
  if (!process.argv.includes('--report')) {
    for (const result of evidence.results) {
      assert.ok(
        result.magnified.width > result.legacy.width + 6,
        'Interior horizontal spacing must magnify'
      )
      assert.ok(
        result.magnified.height > result.legacy.height + 6,
        'Interior vertical spacing must magnify'
      )
      assert.ok(result.reversed.width < 98, 'Positive distortion must reverse the lens')
      assert.ok(
        result.changedBodyPixels > 500 * result.ratio,
        'Interior glyph/grid pixels must move'
      )
      assert.equal(result.identityError, 0, 'Zero distortion must preserve identity')
      assert.equal(result.scrollUploads, 0, 'Scroll must reuse cached textures')
      assert.deepEqual(
        result.lensWork,
        result.legacyWork,
        'Magnification must add no draw or copy passes'
      )
      assert.ok(
        result.magnified.left.peak >= 240 && result.magnified.right.peak >= 240,
        'Blur-free rulers retain bright cores'
      )
      assert.ok(
        result.magnified.left.brightWidth <= 3 && result.magnified.right.brightWidth <= 3,
        'Refraction must not replace sharp lines with blur'
      )
    }
    for (const edge of evidence.edgeErrors)
      assert.ok(edge.maximum <= 1, 'Magnification must keep boundary continuity')
    console.log('PASS whole-pane refraction')
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  if (opened) {
    try {
      browser(['close'])
    } catch (error) {
      console.error(error)
      process.exitCode = 1
    }
  }
}
