// Run from web/: node scripts/verify-showcase-renderer.mjs
// Optional media check: append http://127.0.0.1:3100/videos/bangkok.mp4
// Requires the installed agent-browser CLI and its Chromium browser.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../../package.json', import.meta.url))
const { buildSync } = require('esbuild')
const compiled = buildSync({
  entryPoints: [fileURLToPath(new URL('../../src/scene/renderer.ts', import.meta.url))],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'SceneRendererFixture',
  target: 'es2020',
}).outputFiles[0].text

// A separate session per invocation permits parallel checks without sharing tabs.
const session = `liquid-scene-gpu-check-${process.pid}`

function browser(args, input) {
  const result = spawnSync('agent-browser', ['--session', session, '--json', ...args], {
    encoding: 'utf8',
    input,
    timeout: 45_000,
    maxBuffer: 4 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`agent-browser ${args[0]} failed: ${result.stderr || result.stdout}`)
  }
  const response = JSON.parse(result.stdout)
  if (!response.success)
    throw new Error(`agent-browser ${args[0]}: ${JSON.stringify(response.error)}`)
  return response.data
}

function verifyPixels(createRenderer) {
  const checks = []
  const check = (condition, message) => {
    if (!condition) throw new Error(message)
    checks.push(message)
  }
  const samePixel = (actual, expected, tolerance = 2) =>
    expected.every((value, index) => Math.abs(actual[index] - value) <= tolerance)
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)
  const renderer = createRenderer(canvas)
  check(renderer !== null, 'WebGL renderer initializes')
  const gl = canvas.getContext('webgl')
  const background = document.createElement('canvas')
  background.width = 200
  background.height = 200
  const bg = background.getContext('2d')
  bg.fillStyle = '#ff0000'
  bg.fillRect(0, 0, 200, 100)
  bg.fillStyle = '#0000ff'
  bg.fillRect(0, 100, 200, 100)

  const text = document.createElement('canvas')
  text.width = 20
  text.height = 20
  const textContext = text.getContext('2d')
  textContext.fillStyle = '#fff'
  textContext.font = 'bold 18px sans-serif'
  textContext.textBaseline = 'top'
  textContext.fillText('H', 1, 0)
  const textPixels = textContext.getImageData(0, 0, 20, 20).data
  let glyphPixel = null
  for (let y = 2; y < 17 && !glyphPixel; y += 1) {
    for (let x = 2; x < 15; x += 1) {
      if (textPixels[(y * 20 + x) * 4 + 3] === 255) {
        glyphPixel = { x, y }
        break
      }
    }
  }
  check(glyphPixel !== null, 'Text fixture contains an opaque glyph pixel')

  const sprite = {
    kind: 'sprite',
    bitmap: text,
    opacity: 1,
    space: 'document',
    rect: { x: 30, y: 120, width: 20, height: 20 },
  }
  const glass = {
    kind: 'glass',
    opacity: 1,
    saturation: 1,
    space: 'viewport',
    rect: { x: 20, y: 90, width: 100, height: 60 },
    radius: 10,
    displacement: [0, 0, 0],
    blur: 0,
    tint: [0, 0, 0, 0],
  }
  const setScene = ({ background, items }) =>
    renderer.setScene({
      background: [0, 0, 0, 1],
      items: [
        {
          kind: 'sprite',
          bitmap: background,
          opacity: 1,
          space: 'viewport',
          rect: { x: 0, y: 0, width: 200, height: 200 },
        },
        ...items,
      ],
    })
  const frame = { scrollX: 0, scrollY: 0, width: 200, height: 200, pixelRatio: 1 }
  let uploads = 0
  let copies = 0
  let subUploads = 0
  const originalSubUpload = gl.texSubImage2D.bind(gl)
  gl.texSubImage2D = (...args) => {
    subUploads += 1
    return originalSubUpload(...args)
  }
  const originalUpload = gl.texImage2D.bind(gl)
  const originalCopy = gl.copyTexSubImage2D.bind(gl)
  gl.texImage2D = (...args) => {
    uploads += 1
    return originalUpload(...args)
  }
  gl.copyTexSubImage2D = (...args) => {
    copies += 1
    return originalCopy(...args)
  }

  const pixel = (x, y, ratio = 1) => {
    const data = new Uint8Array(4)
    gl.readPixels(
      Math.floor(x * ratio),
      canvas.height - Math.floor(y * ratio) - 1,
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data
    )
    return Array.from(data)
  }
  const pixels = () => {
    const data = new Uint8Array(canvas.width * canvas.height * 4)
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data)
    return data
  }
  const render = (nextFrame = frame) => {
    check(renderer.render(nextFrame), 'Frame renders successfully')
    check(gl.getError() === gl.NO_ERROR, 'Frame has no WebGL error')
  }

  try {
    setScene({ background, items: [sprite, glass] })
    render()
    check(samePixel(pixel(5, 5), [255, 0, 0, 255]), 'Background top is correctly oriented')
    check(samePixel(pixel(5, 190), [0, 0, 255, 255]), 'Background bottom is correctly oriented')
    check(
      samePixel(pixel(30 + glyphPixel.x, 120 + glyphPixel.y), [255, 255, 255, 255]),
      'Glass samples previously drawn text'
    )
    const beforeScrollUploads = uploads
    render({ ...frame, scrollY: 20 })
    check(
      samePixel(pixel(30 + glyphPixel.x, 100 + glyphPixel.y), [255, 255, 255, 255]),
      'Text and glass sampling use the same scroll position'
    )
    check(samePixel(pixel(5, 5), [255, 0, 0, 255]), 'Background stays fixed while content scrolls')
    check(uploads === beforeScrollUploads, 'Unchanged scrolling uploads no textures')

    setScene({ background, items: [sprite, glass] })
    check(uploads === beforeScrollUploads, 'Repeated scene update reuses immutable bitmap textures')
    render()
    const undistorted = pixels()
    const refractingGlass = { ...glass, displacement: [-160, -160, -160] }
    setScene({ background, items: [sprite, refractingGlass] })
    render()
    const refracted = pixels()
    let bentTextPixels = 0
    for (let index = 0; index < refracted.length; index += 4) {
      if (
        undistorted[index] === 0 &&
        undistorted[index + 1] === 0 &&
        undistorted[index + 2] === 255 &&
        refracted[index] > 200 &&
        refracted[index + 1] > 200
      ) {
        bentTextPixels += 1
      }
    }
    check(bentTextPixels > 0, 'Refraction moves actual text into previously background-only pixels')

    // The second glass must include text and the first glass's tint in its source.
    const firstPane = { ...glass, tint: [0, 1, 0, 0.25] }
    setScene({ background, items: [sprite, firstPane] })
    render()
    const priorText = pixel(30 + glyphPixel.x, 120 + glyphPixel.y)
    const priorTint = pixel(70, 125)
    const secondPane = { ...glass, rect: { x: 10, y: 85, width: 150, height: 80 } }
    setScene({ background, items: [sprite, firstPane, secondPane] })
    render()
    check(
      samePixel(pixel(30 + glyphPixel.x, 120 + glyphPixel.y), priorText),
      'Second overlapping pane samples prior text'
    )
    check(samePixel(pixel(70, 125), priorTint), 'Second overlapping pane samples the earlier glass')

    const edges = [
      {
        name: 'left',
        rect: { x: -30, y: 50, width: 80, height: 100 },
        sample: [25, 90],
        color: [204, 51, 0, 255],
      },
      {
        name: 'right',
        rect: { x: 150, y: 50, width: 80, height: 100 },
        sample: [175, 90],
        color: [204, 51, 0, 255],
      },
      {
        name: 'top',
        rect: { x: 50, y: -30, width: 100, height: 80 },
        sample: [100, 25],
        color: [204, 51, 0, 255],
      },
      {
        name: 'bottom',
        rect: { x: 50, y: 150, width: 100, height: 80 },
        sample: [100, 175],
        color: [0, 51, 204, 255],
      },
    ]
    for (const ratio of [1, 1.5]) {
      for (const edge of edges) {
        setScene({
          background,
          items: [
            {
              ...glass,
              rect: edge.rect,
              displacement: [-200, -160, -120],
              blur: 2,
              tint: [0, 1, 0, 0.2],
            },
          ],
        })
        render({ ...frame, pixelRatio: ratio })
        check(
          canvas.width === 200 * ratio && canvas.height === 200 * ratio,
          `Backing buffer uses DPR ${ratio}`
        )
        check(
          samePixel(pixel(...edge.sample, ratio), edge.color),
          `Partially offscreen ${edge.name} glass renders correctly at DPR ${ratio}`
        )
      }
    }
    setScene({ background, items: [sprite, glass] })
    render({ ...frame, pixelRatio: 2 })
    check(canvas.width === 400 && canvas.height === 400, 'Backing buffer resizes to DPR 2')

    const square = document.createElement('canvas')
    square.width = square.height = 20
    const squareContext = square.getContext('2d')
    squareContext.fillStyle = '#fff'
    squareContext.fillRect(0, 0, 20, 20)
    const clippedSprite = {
      ...sprite,
      bitmap: square,
      rect: { x: 10, y: 10, width: 20, height: 20 },
      opacity: 0.5,
      clip: { rect: { x: 15, y: 15, width: 10, height: 10 }, space: 'document', radius: 4 },
    }
    renderer.setScene({ background: [0, 0, 1, 1], items: [clippedSprite] })
    render()
    check(
      samePixel(pixel(20, 20), [128, 128, 255, 255]),
      'Sprite opacity blends premultiplied pixels'
    )
    check(samePixel(pixel(12, 12), [0, 0, 255, 255]), 'Ancestor clip excludes outside pixels')
    check(samePixel(pixel(15, 15), [0, 0, 255, 255]), 'Ancestor rounded corner excludes pixels')
    render({ ...frame, scrollY: 5 })
    check(samePixel(pixel(20, 15), [128, 128, 255, 255]), 'Document clip moves with its sprite')

    const liveCanvas = document.createElement('canvas')
    liveCanvas.width = 20
    liveCanvas.height = 10
    const liveContext = liveCanvas.getContext('2d')
    liveContext.fillStyle = 'red'
    liveContext.fillRect(0, 0, 10, 10)
    liveContext.fillStyle = 'lime'
    liveContext.fillRect(10, 0, 10, 10)
    const mediaItem = {
      kind: 'media',
      source: liveCanvas,
      rect: { x: 10, y: 10, width: 20, height: 20 },
      space: 'document',
      opacity: 1,
      radius: 0,
      fit: 'contain',
      position: [0.5, 0.5],
    }
    renderer.setScene({ background: [0, 0, 1, 1], items: [mediaItem] })
    render()
    check(
      samePixel(pixel(12, 12), [0, 0, 255, 255]),
      'Contained media leaves transparent letterbox'
    )
    check(samePixel(pixel(14, 20), [255, 0, 0, 255]), 'Media left pixels retain orientation')
    check(samePixel(pixel(26, 20), [0, 255, 0, 255]), 'Media right pixels retain orientation')
    renderer.setScene({
      background: [0, 0, 1, 1],
      items: [{ ...mediaItem, fit: 'cover', position: [0, 0.5] }],
    })
    render()
    check(samePixel(pixel(24, 20), [255, 0, 0, 255]), 'Cover respects object-position')
    renderer.setScene({
      background: [0, 0, 1, 1],
      items: [mediaItem, { ...mediaItem, rect: { x: 40, y: 10, width: 20, height: 20 } }],
    })
    const beforeSub = subUploads
    render()
    check(subUploads === beforeSub + 1, 'A shared live canvas uploads once per rendered frame')
    liveContext.fillStyle = 'white'
    liveContext.fillRect(0, 0, 20, 10)
    render()
    check(
      samePixel(pixel(14, 20), [255, 255, 255, 255]),
      'Live canvas changes reach the next frame'
    )

    // A solid first item after presentation must not sample its own framebuffer.
    const solid = {
      kind: 'solid',
      rect: { x: 0, y: 0, width: 200, height: 200 },
      space: 'viewport',
      opacity: 1,
      radius: 0,
      color: [1, 0, 0, 1],
    }
    const clippedGlass = {
      ...glass,
      rect: { x: -25, y: -20, width: 100, height: 100 },
      clip: { rect: { x: 5, y: 5, width: 70, height: 70 }, space: 'viewport', radius: 12 },
      tint: [0, 1, 0, 0.2],
    }
    for (const ratio of [1, 1.5, 2]) {
      renderer.setScene({ background: [0, 0, 1, 1], items: [solid, clippedGlass] })
      render({ ...frame, pixelRatio: ratio })
      check(
        samePixel(pixel(30, 30, ratio), [204, 51, 0, 255]),
        'Clipped glass uses backing-pixel coordinates'
      )
      check(
        samePixel(pixel(6, 6, ratio), [255, 0, 0, 255]),
        'Clipped glass preserves rounded corners'
      )
    }
    renderer.setScene({
      background: [1, 0, 0, 1],
      items: [
        { ...glass, rect: { x: 0, y: 0, width: 200, height: 200 }, radius: 0, saturation: 0 },
      ],
    })
    render()
    check(
      samePixel(pixel(100, 100), [54, 54, 54, 255]),
      'Glass saturation adjusts the sampled background'
    )
    renderer.dispose()
    check(renderer.render(frame) === false, 'Disposed renderer cannot draw')
    return {
      checks: checks.length,
      bentTextPixels,
      uploadsBeforeScroll: beforeScrollUploads,
      copies,
    }
  } finally {
    renderer.dispose()
    canvas.remove()
  }
}

async function verifyVideo(createRenderer, url) {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.loop = true
  video.style.cssText = 'position:fixed;bottom:0;left:0;width:200px;height:120px'
  document.body.appendChild(video)
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)
  const renderer = createRenderer(canvas)
  if (!renderer) throw new Error('Video fixture renderer did not initialize')
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Video fixture timed out')), 10_000)
      video.addEventListener(
        'loadeddata',
        () => {
          clearTimeout(timeout)
          resolve()
        },
        { once: true }
      )
      video.addEventListener(
        'error',
        () => {
          clearTimeout(timeout)
          reject(new Error('Video failed to load'))
        },
        { once: true }
      )
      video.src = url
    })
    await video.play()
    const gl = canvas.getContext('webgl')
    let uploads = 0
    const originalUpload = gl.texImage2D.bind(gl)
    const originalSubUpload = gl.texSubImage2D.bind(gl)
    gl.texImage2D = (...args) => {
      uploads += 1
      return originalUpload(...args)
    }
    gl.texSubImage2D = (...args) => {
      uploads += 1
      return originalSubUpload(...args)
    }
    const frame = { scrollX: 0, scrollY: 0, width: 200, height: 200, pixelRatio: 1 }
    renderer.setScene({
      background: [0, 0, 0, 1],
      items: [
        {
          kind: 'media',
          source: video,
          rect: { x: 0, y: 0, width: 200, height: 200 },
          space: 'viewport',
          opacity: 1,
          radius: 20,
          fit: 'cover',
          position: [0.5, 0.5],
        },
      ],
    })
    const next = () => new Promise((resolve) => requestAnimationFrame(resolve))
    const render = () => {
      if (!renderer.render(frame) || gl.getError() !== gl.NO_ERROR)
        throw new Error('Video rendering failed')
    }
    for (let index = 0; index < 40; index += 1) {
      await next()
      render()
    }
    const playingUploads = uploads
    video.pause()
    await next()
    await next()
    render()
    const beforePause = uploads
    for (let index = 0; index < 10; index += 1) {
      await next()
      render()
    }
    const pausedUploads = uploads - beforePause
    if (pausedUploads !== 0) throw new Error('Paused video uploaded unchanged frames')
    const reference = document.createElement('canvas')
    reference.width = reference.height = 200
    const referenceContext = reference.getContext('2d')
    const scale = Math.max(200 / video.videoWidth, 200 / video.videoHeight)
    referenceContext.drawImage(
      video,
      (200 - video.videoWidth * scale) / 2,
      (200 - video.videoHeight * scale) / 2,
      video.videoWidth * scale,
      video.videoHeight * scale
    )
    const expected = referenceContext.getImageData(100, 100, 1, 1).data
    const actual = new Uint8Array(4)
    gl.readPixels(100, 99, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, actual)
    if (actual.some((value, index) => Math.abs(value - expected[index]) > 8)) {
      throw new Error(`Video pixels differ: ${Array.from(actual)} vs ${Array.from(expected)}`)
    }
    const seeked = new Promise((resolve) =>
      video.addEventListener('seeked', resolve, { once: true })
    )
    video.currentTime = Math.min(2, video.duration / 2)
    await seeked
    await next()
    render()
    const seekUploads = uploads - beforePause
    if (seekUploads < 1) throw new Error('Seeking did not update the video texture')
    return { renders: 40, playingUploads, pausedUploads, seekUploads, pixelsMatch: true }
  } finally {
    renderer.dispose()
    video.pause()
    video.remove()
    canvas.remove()
  }
}

let opened = false
try {
  browser(['open', 'about:blank'])
  opened = true
  const data = browser(
    ['eval', '--stdin'],
    `(() => {
    ${compiled}
    return (${verifyPixels.toString()})(SceneRendererFixture.createSceneRenderer);
  })()`
  )
  assert.equal(typeof data.result, 'object', 'Browser must return fixture evidence')
  assert.ok(data.result.checks >= 40, 'All renderer scenarios must run')
  assert.ok(data.result.bentTextPixels > 0, 'Actual text must be refracted')
  console.log(
    `PASS managed scene renderer: ${data.result.checks} assertions; ${data.result.bentTextPixels} refracted text pixels; ${data.result.copies} GPU copies.`
  )
  if (process.argv[2]) {
    const url = new URL(process.argv[2])
    assert.ok(url.protocol === 'http:' || url.protocol === 'https:', 'Media URL must use HTTP(S)')
    browser(['open', url.href])
    const video = browser(
      ['eval', '--stdin'],
      `(() => {
      ${compiled}
      return (${verifyVideo.toString()})(SceneRendererFixture.createSceneRenderer, ${JSON.stringify(url.href)});
    })()`
    )
    assert.equal(video.result.pausedUploads, 0)
    assert.ok(video.result.seekUploads >= 1)
    console.log(`PASS video frames: ${JSON.stringify(video.result)}`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  if (opened) {
    try {
      browser(['close'])
    } catch (error) {
      console.error(`Could not close owned browser session ${session}: ${error}`)
      process.exitCode = 1
    }
  }
}
