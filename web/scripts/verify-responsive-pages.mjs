// node scripts/verify-responsive-pages.mjs http://127.0.0.1:3102
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:3102')
const session = `liquid-responsive-${process.pid}`
const init = join(tmpdir(), `${session}.js`)
writeFileSync(
  init,
  `window.__pageErrors=[];window.__sceneStatuses=[];const originalError=console.error;console.error=(...args)=>{window.__pageErrors.push(args.map(String).join(' '));originalError.apply(console,args)};addEventListener('error',e=>window.__pageErrors.push(e.message));addEventListener('unhandledrejection',e=>window.__pageErrors.push(String(e.reason)));document.addEventListener('liquid-glass:scene-status',e=>window.__sceneStatuses.push(e.detail),true);`
)
function browser(args, input) {
  const result = spawnSync('agent-browser', ['--session', session, '--json', ...args], {
    encoding: 'utf8',
    input,
    timeout: 45_000,
    maxBuffer: 2 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  const response = JSON.parse(result.stdout)
  if (!response.success) throw new Error(JSON.stringify(response.error))
  return response.data
}
const evaluate = (script) => browser(['eval', '--stdin'], script).result
const settle = () =>
  evaluate(
    `(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));for(let i=0;i<200&&(!document.querySelector('[data-liquid-glass-scene-ready="true"]')||[...document.querySelectorAll('video')].some(v=>v.readyState<2));i++)await new Promise(r=>setTimeout(r,50));return document.querySelector('[data-liquid-glass-scene]')?.dataset.liquidGlassSceneReady})()`
  )
const open = (path) => {
  browser(['open', new URL(path, base).href])
  assert.equal(settle(), 'true', `Scene not ready: ${path}`)
}
const metrics = () =>
  evaluate(`(()=>{
 const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
 const scene=document.querySelector('[data-liquid-glass-scene]');const nav=document.querySelector('[role="navigation"]');
 const controls=document.querySelector('.glass-controls__header')?.parentElement;
 return {route:location.pathname,width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,
 scenes:document.querySelectorAll('[data-liquid-glass-scene]').length,canvases:document.querySelectorAll('canvas').length,
 panes:document.querySelectorAll('.liquid-glass').length,managed:document.querySelectorAll('.liquid-glass--managed').length,
 standalone:document.querySelectorAll('.liquid-glass__webgl').length,ready:scene?.dataset.liquidGlassSceneReady,
 inputsInScene:scene?.querySelectorAll('input,select,textarea').length,
 nav:rect(nav),navOverflow:nav.scrollWidth-nav.clientWidth,active:[...nav.querySelectorAll('[aria-current="page"]')].map(a=>a.getAttribute('href')),
 controls:controls?.getClientRects().length?rect(controls):null,
 videos:[...document.querySelectorAll('video')].map(v=>({ready:v.readyState,paused:v.paused})),
 nativeViewports:document.querySelectorAll('[data-native-scroll-viewport]').length,
 nativeInsideScene:scene?.querySelectorAll('.scroll-edge__blur-layer').length,
 errors:window.__pageErrors};})()`)
function checkLayout(data, route) {
  assert.equal(data.ready, 'true', JSON.stringify(data))
  assert.equal(data.scenes, 1, 'One scene per page')
  assert.equal(data.canvases, 1, 'No video mirror or per-pane canvases')
  assert.equal(data.standalone, 0, 'No legacy per-pane renderer')
  assert.ok(data.panes > 0 && data.panes === data.managed, 'Every glass pane is managed')
  assert.equal(data.inputsInScene, 0, 'Native controls remain outside the scene')
  assert.ok(data.scrollWidth <= data.width + 1, `Horizontal overflow: ${JSON.stringify(data)}`)
  assert.ok(
    data.nav.left >= 15 && data.nav.right <= data.width - 15 && data.nav.top >= 15,
    'Navbar retains its outer gap'
  )
  assert.ok(data.navOverflow <= 1, `Navbar content overflow: ${JSON.stringify(data)}`)
  assert.ok(data.active.includes(route), 'Current navigation link is correct')
  if (data.controls) {
    assert.ok(
      data.controls.left >= -1 && data.controls.right <= data.width + 1,
      'Controls fit horizontally'
    )
    assert.ok(
      data.controls.top >= data.nav.bottom + 15 && data.controls.bottom <= data.height + 1,
      'Controls remain below navigation and inside viewport'
    )
  }
  assert.equal(
    data.videos.length,
    route === '/' ? 0 : 1,
    'Exactly one video source on video routes'
  )
  assert.ok(
    data.videos.every((v) => v.ready >= 2),
    'Video has a decodable frame'
  )
  assert.equal(data.nativeViewports, route === '/scroll-edge' ? 4 : 0, 'Native viewport lifecycle')
  assert.equal(data.nativeInsideScene, 0, 'ScrollEdge masks never enter the scene compiler')
  assert.deepEqual(data.errors, [], 'No page errors')
}

let opened = false
try {
  browser(['--init-script', init, 'open', 'about:blank'])
  opened = true
  const rows = []
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [420, 844],
    [421, 844],
    [430, 932],
    [768, 1024],
    [1024, 768],
    [1440, 900],
    [844, 390],
    [568, 320],
    [1024, 320],
  ]) {
    browser(['set', 'viewport', String(width), String(height)])
    for (const route of ['/', '/demo', '/scroll-edge']) {
      open(route)
      const data = metrics()
      checkLayout(data, route)
      rows.push({ route, width, height, panes: data.panes, ready: true, overflow: false })
    }
  }
  console.log(`PASS responsive layout: ${rows.length} route/viewport combinations`)

  browser(['set', 'viewport', '390', '844'])
  for (const route of ['/', '/demo', '/scroll-edge']) {
    open(route)
    browser(['click', '.navbar__toggle'])
    settle()
    const menu = evaluate(
      `(()=>{const nav=document.querySelector('[role="navigation"]');const panel=document.querySelector('.glass-controls__header')?.parentElement;return {expanded:nav.querySelector('.navbar__toggle').getAttribute('aria-expanded'),links:[...nav.querySelectorAll('.navbar__mobile a')].every(a=>{const r=a.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}),controlsHidden:!panel||!panel.getClientRects().length}})()`
    )
    assert.equal(menu.expanded, 'true')
    assert.ok(menu.links && menu.controlsHidden)
    browser(['press', 'Escape'])
    settle()
    assert.equal(evaluate(`document.activeElement?.classList.contains('navbar__toggle')`), true)
    assert.equal(
      evaluate(`document.querySelector('.navbar__toggle').getAttribute('aria-expanded')`),
      'false'
    )
  }

  open('/scroll-edge')
  evaluate(`document.querySelector('video').pause()`)
  settle()
  for (const mode of ['fade', 'blur', 'fade-all', 'blur-all']) {
    evaluate(
      `document.querySelector('[data-native-scroll-anchor="${mode}"]').scrollIntoView({block:'center'})`
    )
    settle()
    const state = evaluate(
      `(()=>{const a=document.querySelector('[data-native-scroll-anchor="${mode}"]');const l=document.querySelector('[data-native-scroll-viewport="${mode}"]');const ar=a.getBoundingClientRect(),lr=l.getBoundingClientRect();const s=l.querySelector('.scroll-edge__scrollable');s.scrollTop=160;if('${mode}'.endsWith('-all'))s.scrollLeft=160;return {delta:Math.max(Math.abs(ar.left-lr.left),Math.abs(ar.top-lr.top),Math.abs(ar.width-lr.width),Math.abs(ar.height-lr.height)),tabIndex:s.tabIndex,outside:!l.closest('[data-liquid-glass-scene]')}})()`
    )
    assert.ok(
      state.delta <= 1 && state.outside && state.tabIndex === 0,
      `Native alignment ${mode}: ${JSON.stringify(state)}`
    )
    settle()
    const scroll = evaluate(
      `(()=>{const l=document.querySelector('[data-native-scroll-viewport="${mode}"]');const s=l.querySelector('.scroll-edge__scrollable');return {top:s.scrollTop,left:s.scrollLeft,blur:l.querySelectorAll('.scroll-edge__overlay--blur').length,mask:getComputedStyle(l.querySelector('.scroll-edge__mask-vertical')).maskImage,horizontalMask:getComputedStyle(l.querySelector('.scroll-edge__mask-horizontal')).maskImage,shadowOverlays:l.querySelectorAll('.scroll-edge__overlay--shadow').length}})()`
    )
    assert.ok(scroll.top > 0)
    if (mode.endsWith('-all')) assert.ok(scroll.left > 0)
    if (mode === 'blur') assert.equal(scroll.blur, 2)
    if (mode === 'blur-all') assert.equal(scroll.blur, 4)
    assert.equal(scroll.shadowOverlays, 0, 'No colored shadow overlays')
    if (mode.startsWith('fade')) {
      assert.equal(scroll.blur, 0, 'Fade examples do not enable blur')
      assert.notEqual(scroll.mask, 'none')
      if (mode === 'fade-all') assert.notEqual(scroll.horizontalMask, 'none')
    } else {
      assert.equal(scroll.mask, 'none', 'Blur examples do not enable fade')
      assert.equal(scroll.horizontalMask, 'none')
    }
  }
  evaluate(
    `(()=>{const a=document.querySelector('[data-native-scroll-anchor="fade"]');scrollTo(0,a.getBoundingClientRect().top+scrollY-20)})()`
  )
  settle()
  const clipped = evaluate(
    `(()=>{const l=document.querySelector('[data-native-scroll-viewport="fade"]');const r=l.getBoundingClientRect();return {clip:l.style.clipPath,covered:Boolean(document.elementFromPoint(r.left+20,30)?.closest('[data-native-scroll-viewport]'))}})()`
  )
  assert.ok(
    !clipped.covered && !clipped.clip.startsWith('inset(0px'),
    'Native viewport cannot cover the navbar'
  )
  browser(['click', '.navbar__toggle'])
  settle()
  browser(['click', '.navbar__mobile a[href="/demo"]'])
  browser(['wait', '--url', '**/demo'])
  settle()
  assert.equal(
    evaluate(`document.querySelectorAll('[data-native-scroll-viewport]').length`),
    0,
    'SPA navigation removes native portals'
  )
  checkLayout(metrics(), '/demo')
  console.log(
    'PASS interactions: navigation, menu/Escape, four native scroll modes, alignment, nav clipping and portal cleanup'
  )
  console.log(JSON.stringify(rows))
} catch (error) {
  try {
    console.error(
      JSON.stringify({
        url: browser(['get', 'url']),
        state: evaluate(`({statuses:window.__sceneStatuses,errors:window.__pageErrors})`),
      })
    )
  } catch {}
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  if (opened)
    try {
      browser(['close'])
    } catch {}
  unlinkSync(init)
}
