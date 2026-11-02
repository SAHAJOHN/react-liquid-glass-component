// Run from web/: node scripts/verify-viewport-assets.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../../package.json', import.meta.url))
const { buildSync } = require('esbuild')
const bundle = buildSync({
  stdin: {
    contents:
      "export { createSceneCompiler } from './src/scene/dom-scene'; export { createSceneRenderer } from './src/scene/renderer';",
    resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'ViewportScene',
  target: 'es2020',
}).outputFiles[0].text
const session = `glass-viewport-assets-${process.pid}`

function browser(args, input) {
  const result = spawnSync('agent-browser', ['--session', session, '--json', ...args], {
    input,
    encoding: 'utf8',
    timeout: 45_000,
    maxBuffer: 4 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  const response = JSON.parse(result.stdout)
  if (!response.success) throw new Error(JSON.stringify(response.error))
  return response.data
}

async function verify(api) {
  let checks = 0
  const check = (condition, message) => {
    if (!condition) throw new Error(message)
    checks += 1
  }
  document.body.style.cssText = 'margin:0;background:#001021'
  const root = document.createElement('main')
  root.style.cssText = 'position:relative;width:430px;height:1400px'
  root.innerHTML = `
    <svg id="backdrop" viewBox="0 0 100 100" preserveAspectRatio="none" style="position:fixed;left:0;top:0;width:430px;height:844px" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="50" fill="#ff0000"/><rect y="50" width="100" height="50" fill="#0000ff"/></svg>
    <div id="overflow" style="position:fixed;left:0;top:0;width:430px;height:62px;overflow:hidden"><div style="width:441px;height:62px"></div></div>
    <div id="scroller" style="position:absolute;left:20px;top:150px;width:80px;height:60px;overflow:auto"><div id="scroll-content" style="width:80px;height:140px;background:#00ff00"></div></div>
    <svg id="meet" viewBox="0 0 100 100" style="position:absolute;left:300px;top:1000px;width:80px;height:80px" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="#ff0000"/></svg>
  `
  document.body.appendChild(root)
  const output = document.createElement('canvas')
  document.body.appendChild(output)
  const renderer = api.createSceneRenderer(output)
  check(renderer !== null, 'Renderer initializes')
  const gl = output.getContext('webgl')
  let invalidations = 0
  const compiler = api.createSceneCompiler(() => {
    invalidations += 1
  })
  const frame = { width: 430, height: 844, pixelRatio: 1, scrollX: 0, scrollY: 0 }
  const compile = () => compiler.compile(root, new Map(), frame, '#001021')
  const next = () => new Promise((resolve) => requestAnimationFrame(resolve))
  const settled = async () => {
    let result = compile()
    for (
      let count = 0;
      result.issues.some((issue) => /loading/.test(issue)) && count < 90;
      count += 1
    ) {
      await next()
      result = compile()
    }
    check(result.issues.length === 0, result.issues.join('; '))
    return result
  }
  const backdrop = root.querySelector('#backdrop')
  const backgroundSprite = (result) =>
    result.scene.items.find(
      (item) => item.kind === 'sprite' && item.space === 'viewport' && item.rect.width === 430
    )
  const pixel = (x, y) => {
    const value = new Uint8Array(4)
    gl.readPixels(x, output.height - y - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, value)
    return Array.from(value)
  }
  const draw = (result) => {
    renderer.setScene(result.scene)
    check(renderer.render(frame), 'Scene renders')
    check(gl.getError() === gl.NO_ERROR, 'Scene has no WebGL errors')
  }

  try {
    const initial = await settled()
    const initialSprite = backgroundSprite(initial)
    check(Boolean(initialSprite), 'Stretchable SVG has a sprite')
    check(root.querySelector('#overflow').scrollWidth > 430, 'Navbar fixture really overflows')
    check(!initial.liveGeometry, 'Overflow hidden and auto do not force global live geometry')
    draw(initial)
    const initialInvalidations = invalidations
    let bitmapUploads = 0
    let storageAllocations = 0
    const upload = gl.texImage2D.bind(gl)
    gl.texImage2D = (...args) => {
      if (args[args.length - 1] instanceof HTMLCanvasElement) bitmapUploads += 1
      else if (args.length === 9) storageAllocations += 1
      return upload(...args)
    }
    let loadingTransitions = 0
    for (const height of [836, 828, 820, 812, 804, 796, 788, 780, 772, 764]) {
      backdrop.style.height = `${height}px`
      frame.height = height
      const result = compile()
      loadingTransitions += Number(result.issues.some((issue) => /loading/.test(issue)))
      check(result.issues.length === 0, `Height ${height} stays ready: ${result.issues.join('; ')}`)
      const sprite = backgroundSprite(result)
      check(sprite.bitmap === initialSprite.bitmap, `Height ${height} reuses SVG bitmap`)
      check(sprite.rect.height === height, `Height ${height} updates visible geometry`)
      draw(result)
      check(pixel(410, Math.floor(height * 0.25))[0] > 250, 'SVG top stays red after stretching')
      check(
        pixel(410, Math.floor(height * 0.75))[2] > 250,
        'SVG bottom stays blue after stretching'
      )
    }
    check(bitmapUploads === 0, 'Height-only changes upload no new bitmap textures')
    check(loadingTransitions === 0, 'Height-only changes never request native loading fallback')
    check(invalidations === initialInvalidations, 'Height-only changes decode no new SVG assets')

    const scroller = root.querySelector('#scroller')
    scroller.scrollTop = 30
    const scrolled = compile()
    const child = scrolled.scene.items.find(
      (item) => item.kind === 'sprite' && item.rect.width === 80 && item.rect.height === 140
    )
    check(child.rect.y === 120, 'Nested scrolling updates child geometry when invalidated')
    check(
      child.clip.rect.y === 150 && child.clip.rect.height === 60,
      'Nested scroll retains viewport clip'
    )
    draw(scrolled)
    check(pixel(40, 160)[1] > 250, 'Nested content paints inside scroll viewport')
    check(pixel(40, 140)[1] < 5, 'Nested content remains clipped above scroll viewport')

    const sticky = document.createElement('div')
    sticky.style.cssText = 'position:sticky;top:0;height:10px'
    root.appendChild(sticky)
    check(compile().liveGeometry, 'Sticky content still requires live geometry')
    sticky.remove()

    const meet = root.querySelector('#meet')
    meet.style.height = '120px'
    const resizedMeet = await settled()
    const meetSprite = resizedMeet.scene.items.find(
      (item) => item.kind === 'sprite' && item.rect.x === 300 && item.rect.y === 1000
    )
    const meetContext = meetSprite.bitmap.getContext('2d')
    check(meetContext.getImageData(40, 10, 1, 1).data[3] === 0, 'Meet SVG keeps its new letterbox')
    check(
      meetContext.getImageData(40, 50, 1, 1).data[0] > 250,
      'Meet SVG retains content after height resize'
    )

    backdrop.style.height = '844px'
    backdrop.style.borderRadius = '20px'
    const rounded = await settled()
    const roundedSprite = backgroundSprite(rounded)
    check(
      roundedSprite.bitmap !== initialSprite.bitmap,
      'SVG decoration changes invalidate its raster'
    )
    check(
      roundedSprite.bitmap.getContext('2d').getImageData(0, 0, 1, 1).data[3] === 0,
      'Rounded SVG keeps its actual clipped corner instead of stretching an old bitmap'
    )
    backdrop.style.borderRadius = '0'

    backdrop.style.width = '420px'
    const changedWidth = await settled()
    const changedSprite = changedWidth.scene.items.find(
      (item) => item.kind === 'sprite' && item.space === 'viewport' && item.rect.width === 420
    )
    check(changedSprite.bitmap !== initialSprite.bitmap, 'Width changes refresh raster resolution')
    return { checks, heightChanges: 10, bitmapUploads, storageAllocations, loadingTransitions }
  } finally {
    compiler.dispose()
    renderer.dispose()
    root.remove()
    output.remove()
  }
}

let opened = false
try {
  browser(['open', 'about:blank'])
  opened = true
  browser(['set', 'viewport', '430', '844'])
  const result = browser(
    ['eval', '--stdin'],
    `${bundle}\n(${verify.toString()})(ViewportScene)`
  ).result
  assert.ok(result.checks >= 50)
  assert.equal(result.loadingTransitions, 0)
  console.log(`PASS viewport assets: ${JSON.stringify(result)}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  if (opened) browser(['close'])
}
