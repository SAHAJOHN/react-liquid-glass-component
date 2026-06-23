import { useState, useEffect } from 'react'
import { LiquidGlass } from 'react-liquid-glass-component'
import bgVideo from './assets/bangkok.mp4'

type Page = 'showcase' | 'demo'

const DEFAULT_PROPS = {
  borderRadius: 28,
  borderWidth: 0.07,
  blur: 14,
  opacity: 0.92,
  brightness: 48,
  saturation: 1,
  distortionScale: -160,
  displace: 0.6,
  backgroundOpacity: 0,
  redOffset: 0,
  greenOffset: 10,
  blueOffset: 20,
  xChannel: 'R' as const,
  yChannel: 'G' as const,
  mixBlendMode: 'difference' as const,
}

const BLEND_MODES = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference',
  'exclusion', 'hue', 'saturation', 'color', 'luminosity', 'plus-darker',
  'plus-lighter',
] as const

function Showcase() {
  return (
    <>
      {/* Hero */}
      <section className="hero">
        <LiquidGlass
          borderRadius={28}
          blur={14}
          opacity={0.92}
          brightness={48}
          width={640}
          height={280}
          displace={0.6}
          distortionScale={-160}
        >
          <div className="hero-content">
            <h1>React Liquid Glass Component</h1>
            <p className="hero-sub">
              Frosted glass effect for React — SVG distortion, chromatic aberration, blur.
            </p>
            <code className="hero-code">
              import {'{ LiquidGlass }'} from 'react-liquid-glass-component'
            </code>
          </div>
        </LiquidGlass>
      </section>

      {/* Variants */}
      <section className="variants">
        <LiquidGlass
          borderRadius={30} blur={10} opacity={0.93} brightness={50}
          width={280} height={180} className="variant-card"
        >
          <div className="variant-body">
            <h2>Natural</h2>
            <p>Default frosted glass with subtle distortion.</p>
          </div>
        </LiquidGlass>

        <LiquidGlass
          borderRadius={30} blur={24} opacity={0.88} brightness={42}
          displace={2} distortionScale={-220}
          width={280} height={180} className="variant-card"
        >
          <div className="variant-body">
            <h2>Deep Blur</h2>
            <p>High blur look with gentle liquid warp.</p>
          </div>
        </LiquidGlass>

        <LiquidGlass
          borderRadius={30} blur={8} opacity={0.95} brightness={55}
          redOffset={18} greenOffset={0} blueOffset={-18} distortionScale={-300}
          width={280} height={180} className="variant-card"
        >
          <div className="variant-body">
            <h2>Chromatic</h2>
            <p>Strong RGB channel split for a prismatic look.</p>
          </div>
        </LiquidGlass>
      </section>

      {/* Install */}
      <section className="install">
        <LiquidGlass
          borderRadius={16} blur={12} opacity={0.85} brightness={40}
          backgroundOpacity={0.3}
          className="install-card"
          style={{
            background: "#0064ff38",
            padding: "20px",
          }}
        >
          <code className="install-code">
            <span className="prompt">$</span> npm install react-liquid-glass-component styled-components
          </code>
        </LiquidGlass>
      </section>
    </>
  )
}

function Demo() {
  const [p, set] = useState(DEFAULT_PROPS)

  const setNum = (key: keyof typeof DEFAULT_PROPS) => (e: React.ChangeEvent<HTMLInputElement>) =>
    set(prev => ({ ...prev, [key]: parseFloat(e.target.value) }))

  const setChan = (key: 'xChannel' | 'yChannel') => (e: React.ChangeEvent<HTMLSelectElement>) =>
    set(prev => ({ ...prev, [key]: e.target.value as 'R' | 'G' | 'B' }))

  const setBlendMode = (e: React.ChangeEvent<HTMLSelectElement>) =>
    set(prev => ({ ...prev, mixBlendMode: e.target.value as typeof BLEND_MODES[number] }))

  return (
    <div className="demo-layout">
      {/* Controls panel = LiquidGlass ตัวเอง */}
      <LiquidGlass
        borderRadius={p.borderRadius}
        borderWidth={p.borderWidth}
        blur={p.blur}
        opacity={p.opacity}
        brightness={p.brightness}
        saturation={p.saturation}
        distortionScale={p.distortionScale}
        displace={p.displace}
        backgroundOpacity={p.backgroundOpacity}
        redOffset={p.redOffset}
        greenOffset={p.greenOffset}
        blueOffset={p.blueOffset}
        xChannel={p.xChannel}
        yChannel={p.yChannel}
        mixBlendMode={p.mixBlendMode}
        style={{ padding: 0, maxWidth: '100%', maxHeight: '80dvh', width: '440px', background: '#00000066' }}
      >
        <div className="demo-controls">
          <div className="controls-header">
            <h3>Properties</h3>
            <button className="reset-btn" onClick={() => set(DEFAULT_PROPS)}>Reset</button>
          </div>

          <Slider label="Border Radius" value={p.borderRadius} min={0} max={400} onChange={setNum('borderRadius')} />
          <Slider label="Border Width" value={p.borderWidth} min={0} max={0.3} step={0.01} onChange={setNum('borderWidth')} />
          <Slider label="Blur" value={p.blur} min={0} max={80} onChange={setNum('blur')} />
          <Slider label="Opacity" value={p.opacity} min={0} max={1} step={0.01} onChange={setNum('opacity')} />
          <Slider label="Brightness" value={p.brightness} min={0} max={100} onChange={setNum('brightness')} />
          <Slider label="Saturation" value={p.saturation} min={0} max={6} step={0.1} onChange={setNum('saturation')} />
          <Slider label="Distortion Scale" value={p.distortionScale} min={-600} max={600} onChange={setNum('distortionScale')} />
          <Slider label="Displace" value={p.displace} min={0} max={10} step={0.1} onChange={setNum('displace')} />
          <Slider label="Background Opacity" value={p.backgroundOpacity} min={0} max={1} step={0.01} onChange={setNum('backgroundOpacity')} />

          <div className="control-group">
            <label className="control-label">Chromatic Offsets</label>
            <div className="chroma-row">
              <Slider label="R" value={p.redOffset} min={-60} max={60} onChange={setNum('redOffset')} compact />
              <Slider label="G" value={p.greenOffset} min={-60} max={60} onChange={setNum('greenOffset')} compact />
              <Slider label="B" value={p.blueOffset} min={-60} max={60} onChange={setNum('blueOffset')} compact />
            </div>
          </div>

          <div className="control-group">
            <label className="control-label">Channels</label>
            <div className="chroma-row">
              <Select label="X Channel" value={p.xChannel} options={['R','G','B']} onChange={setChan('xChannel')} />
              <Select label="Y Channel" value={p.yChannel} options={['R','G','B']} onChange={setChan('yChannel')} />
            </div>
          </div>

          <Select label="Mix Blend Mode" value={p.mixBlendMode} options={[...BLEND_MODES]} onChange={setBlendMode} />
        </div>
      </LiquidGlass>
    </div>
  )
}

/* ── reusable form widgets ── */

function Slider({ label, value, min, max, step = 1, compact, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; compact?: boolean;
  onChange: React.ChangeEventHandler<HTMLInputElement>
}) {
  return (
    <div className={`slider-row${compact ? ' slider-row--compact' : ''}`}>
      <label className="slider-label">
        <span>{label}</span>
        <span className="slider-value">{value}</span>
      </label>
      <input type="range" min={min} max={max} step={step} value={value} onChange={onChange} />
    </div>
  )
}

function Select({ label, value, options, onChange }: {
  label: string; value: string; options: string[];
  onChange: React.ChangeEventHandler<HTMLSelectElement>
}) {
  return (
    <div className="select-group">
      <label className="slider-label">{label}</label>
      <select value={value} onChange={onChange} className="demo-select">
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

/* ── App ── */

function App() {
  const [page, setPage] = useState<Page>('showcase')
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    let lastScrollY = window.scrollY

    const onScroll = () => {
      const y = window.scrollY
      if (y < 50) {
        setHidden(false)
      } else if (y > lastScrollY) {
        setHidden(true)   // scroll down → hide
      } else {
        setHidden(false)  // scroll up → show
      }
      lastScrollY = y
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <>
      <video className="bg-video" src={bgVideo} autoPlay muted loop playsInline />
      <nav className={`navbar${hidden ? ' navbar--hidden' : ''}`}>
        <div className="navbar__inner">
          <span className="navbar__logo">Liquid Glass</span>
          <div className="navbar__links">
            <button
              className={`navbar__link${page === 'showcase' ? ' navbar__link--active' : ''}`}
              onClick={() => setPage('showcase')}
            >
              Showcase
            </button>
            <button
              className={`navbar__link${page === 'demo' ? ' navbar__link--active' : ''}`}
              onClick={() => setPage('demo')}
            >
              Demo
            </button>
            <a
              className="navbar__link navbar__link--external"
              href="https://github.com/SAHAJOHN/react-liquid-glass-component"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub ↗
            </a>
          </div>
        </div>
      </nav>

      <main>
        {page === 'showcase' ? <Showcase /> : <Demo />}
      </main>
    </>
  )
}

export default App
