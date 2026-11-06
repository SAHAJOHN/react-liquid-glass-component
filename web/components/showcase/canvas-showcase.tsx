'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Navbar from '@/components/navbar'
import { createStudioSettings } from '@/lib/studio-settings'
import styled from 'styled-components'
import { colors, fonts, fontSize, fontWeight, sectionGap, sectionPadding } from '@/lib/responsive'
import {
  LiquidGlass,
  LiquidGlassScene,
  type GlassStudioProps,
} from '@/components/liquid-glass-client'
import GlassControls from './glass-controls'

const CanvasShowcaseStyled = styled(LiquidGlassScene)`
  position: relative;
  isolation: isolate;
  min-height: 100dvh;
  color: ${colors.foreground};
  background: #101c2b;

  .canvas-showcase__backdrop {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 0;
    pointer-events: none;
  }

  .canvas-showcase__main {
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: ${sectionGap};
    padding: calc(104px + max(16px, env(safe-area-inset-top))) ${sectionPadding.container}
      calc(40dvh + 48px + env(safe-area-inset-bottom));
  }

  .canvas-showcase__glass {
    min-width: 0;
  }

  .canvas-showcase__hero > .liquid-glass__content {
    display: block;
  }

  .canvas-showcase__hero {
    width: 640px;
    max-width: 100%;
    min-height: 284px;
    padding: 32px;
    text-align: center;
  }

  .canvas-showcase__title {
    margin: 0 0 10px;
    color: ${colors.foreground};
    font-size: ${fontSize['4xl']};
    font-weight: ${fontWeight.bold};
    letter-spacing: -0.03em;
    line-height: 1.2;
  }

  .canvas-showcase__subtitle {
    max-width: 360px;
    margin: 0 auto 24px;
    color: ${colors.foregroundMuted};
    font-size: ${fontSize.xl};
    font-weight: ${fontWeight.normal};
    line-height: 1.6;
  }

  .canvas-showcase__example {
    display: inline-block;
    max-width: 100%;
    padding: 8px 16px;
    border-radius: 8px;
    color: ${colors.foreground};
    font-family: ${fonts.mono};
    font-size: ${fontSize.sm};
    line-height: 1.6;
    overflow-wrap: anywhere;
  }

  .canvas-showcase__variants {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
    gap: 20px;
    width: 100%;
    max-width: 960px;
  }

  .canvas-showcase__variant > .liquid-glass__content {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .canvas-showcase__variant {
    width: 100%;
    min-height: 210px;
    padding: 24px 20px 16px;
    text-align: center;
  }

  .canvas-showcase__variant-title {
    margin: 0 0 6px;
    color: ${colors.foreground};
    font-size: ${fontSize['2xl']};
    font-weight: ${fontWeight.semibold};
    letter-spacing: -0.02em;
    line-height: 1.4;
  }

  .canvas-showcase__variant-text {
    max-width: 180px;
    margin: 0 auto;
    color: ${colors.foregroundMuted};
    font-size: ${fontSize.base};
    line-height: 1.5;
  }

  .canvas-showcase__button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    padding: 10px 14px;
    border: 1px solid rgba(255, 255, 255, 0.5);
    border-radius: 8px;
    background: transparent;
    color: ${colors.foreground};
    font-family: ${fonts.sans};
    font-size: ${fontSize.sm};
    font-weight: ${fontWeight.medium};
    line-height: 1.5;
    text-decoration: none;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;

    &:focus-visible {
      outline: 2px solid #b4eaff;
      outline-offset: 3px;
    }
  }

  .canvas-showcase__install > .liquid-glass__content {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .canvas-showcase__install-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    width: 100%;
  }

  .canvas-showcase__install {
    width: 640px;
    max-width: 100%;
    padding: 16px 20px;
  }

  .canvas-showcase__command {
    min-width: 0;
    color: ${colors.foregroundMuted};
    font-family: ${fonts.mono};
    font-size: ${fontSize.md};
    line-height: 1.7;
    overflow-wrap: anywhere;
  }

  .canvas-showcase__package {
    display: inline-block;
    max-width: 100%;
    overflow-wrap: anywhere;
    vertical-align: bottom;
  }

  .canvas-showcase__install .canvas-showcase__button {
    flex-shrink: 0;
  }

  .canvas-showcase__install-note {
    flex: 1 1 100%;
    margin: 8px 0 0;
    color: ${colors.foregroundMuted};
    font-size: ${fontSize.sm};
    line-height: 1.5;
  }

  .canvas-showcase__scroll {
    width: 100%;
    max-width: 960px;
    margin-top: 32px;
  }

  .canvas-showcase__intro {
    max-width: 600px;
    margin-bottom: 32px;
  }

  .canvas-showcase__eyebrow {
    margin: 0 0 12px;
    color: ${colors.foregroundMuted};
    font-size: 0.75rem;
    font-weight: ${fontWeight.semibold};
    letter-spacing: 0.12em;
    line-height: 1.5;
  }

  .canvas-showcase__heading {
    margin: 0 0 12px;
    color: ${colors.foreground};
    font-size: clamp(1.8rem, 4vw, 2.8rem);
    font-weight: ${fontWeight.bold};
    letter-spacing: -0.03em;
    line-height: 1.15;
  }

  .canvas-showcase__text {
    margin: 0;
    color: ${colors.foregroundMuted};
    font-size: 1rem;
    font-weight: ${fontWeight.normal};
    line-height: 1.65;
  }

  .canvas-showcase__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
    gap: 20px;
  }

  .canvas-showcase__card > .liquid-glass__content {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
    min-height: 210px;
  }

  .canvas-showcase__card {
    min-height: 266px;
    padding: 28px;
  }

  .canvas-showcase__number {
    color: ${colors.foregroundMuted};
    font-size: 0.8rem;
    font-weight: ${fontWeight.medium};
    line-height: 1.5;
  }

  .canvas-showcase__card-title {
    margin: 0 0 8px;
    color: ${colors.foreground};
    font-size: 1.2rem;
    font-weight: ${fontWeight.semibold};
    letter-spacing: -0.02em;
    line-height: 1.4;
  }

  .canvas-showcase__notes {
    max-width: 640px;
    padding-top: 72px;
  }
  .canvas-showcase__notes .canvas-showcase__text + .canvas-showcase__text {
    margin-top: 16px;
  }
  .canvas-showcase__notes-heading {
    margin: 0 0 16px;
    color: ${colors.foreground};
    font-size: 1.5rem;
    font-weight: ${fontWeight.semibold};
    line-height: 1.35;
  }

  @media (min-width: 900px) {
    .canvas-showcase__main {
      padding-bottom: 80px;
    }
  }

  @media (max-width: 700px) {
    .canvas-showcase__title {
      font-size: clamp(1.6rem, 6.5vw, 1.8rem);
    }
    .canvas-showcase__main {
      padding-left: max(16px, env(safe-area-inset-left));
      padding-right: max(16px, env(safe-area-inset-right));
    }
    .canvas-showcase__hero {
      padding: 24px;
    }
    .canvas-showcase__example {
      padding: 6px 12px;
      font-size: ${fontSize.xs};
    }
    .canvas-showcase__command {
      font-size: 0.7rem;
    }
    .canvas-showcase__scroll {
      margin-top: 16px;
    }
    .canvas-showcase__grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .canvas-showcase__card {
      min-height: 238px;
      padding: 24px;
    }
    .canvas-showcase__card > .liquid-glass__content {
      min-height: 190px;
    }
    .canvas-showcase__notes {
      padding-top: 56px;
    }
  }

  @media (max-width: 420px) {
    .canvas-showcase__install-row {
      align-items: flex-start;
      flex-direction: column;
    }
    .canvas-showcase__install .canvas-showcase__button {
      align-self: flex-end;
    }
  }
`

const variants = [
  {
    title: 'Refraction',
    text: 'Tune the glass edge with Thickness, Background Distance and Refraction Factor.',
  },
  {
    title: 'Blur',
    text: 'Adjust Blur Radius and Blur Edge to soften the background through the glass.',
  },
  {
    title: 'Dispersion',
    text: 'Adjust Dispersion Gain to separate colors along the refracted edge.',
  },
]

const cards = [
  {
    title: 'Shape it to your layout',
    text: 'Set a width, height, and corner radius, or let the surface size itself around its content.',
  },
  {
    title: 'Tune the distortion',
    text: 'Adjust Thickness, Background Distance and Refraction Factor to change how the edge bends the scene.',
  },
  {
    title: 'Add a little color',
    text: 'Choose a Tint color and alpha to make the surface fit its surroundings.',
  },
  {
    title: 'Keep content in focus',
    text: 'Text, buttons, and other children stay on top of the glass, ready to use as normal React elements.',
  },
  {
    title: 'Adapt to the backdrop',
    text: 'The effect updates as the surface changes size, so it can follow responsive layouts.',
  },
  {
    title: 'Try it as you scroll',
    text: 'Move through this page to see how the glass sits over different parts of the background.',
  },
]

const packageName = 'react-liquid-glass-component'
const installCommand = `npm install ${packageName}`

function CopyControl({ text, label }: { text: string; label: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (resetTimer.current !== null) clearTimeout(resetTimer.current)
    },
    []
  )

  const copy = async () => {
    if (resetTimer.current !== null) clearTimeout(resetTimer.current)
    try {
      await navigator.clipboard.writeText(text)
      setStatus('copied')
    } catch {
      setStatus('failed')
    }
    resetTimer.current = setTimeout(() => setStatus('idle'), 2500)
  }

  return (
    <button
      type="button"
      className="canvas-showcase__button"
      onClick={copy}
      aria-label={
        status === 'copied'
          ? `${label} copied`
          : status === 'failed'
            ? `Copy failed. Retry ${label}`
            : `Copy ${label}`
      }
      aria-live="polite"
    >
      {status === 'copied' ? 'Copied' : status === 'failed' ? 'Retry copy' : 'Copy'}
    </button>
  )
}

export default function CanvasShowcase() {
  const backdropId = useId().replace(/:/g, '')
  const [menuOpen, setMenuOpen] = useState(false)
  const [settings, setSettings] = useState<GlassStudioProps>(createStudioSettings)
  const [convexity, setConvexity] = useState(0)
  const settingsSnippet = `<LiquidGlass\n  {...${JSON.stringify(settings, null, 2)}}\n  convexity={${convexity}}\n/>`

  return (
    <>
      <CanvasShowcaseStyled background="#101c2b">
        <svg
          className="canvas-showcase__backdrop"
          viewBox="0 0 1000 1000"
          preserveAspectRatio="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={`${backdropId}-base`} x2="1" y2="1">
              <stop stopColor="#0c1726" />
              <stop offset="0.55" stopColor="#18283c" />
              <stop offset="1" stopColor="#101b2a" />
            </linearGradient>
            <radialGradient id={`${backdropId}-teal`}>
              <stop stopColor="#3ca3ae" stopOpacity="0.52" />
              <stop offset="1" stopColor="#3ca3ae" stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`${backdropId}-violet`}>
              <stop stopColor="#6f71cf" stopOpacity="0.52" />
              <stop offset="1" stopColor="#6f71cf" stopOpacity="0" />
            </radialGradient>
            <pattern id={`${backdropId}-grid`} width="80" height="80" patternUnits="userSpaceOnUse">
              <path
                d="M80 0H0V80"
                fill="none"
                stroke="#d2e7f2"
                strokeOpacity="0.22"
                strokeWidth="1.5"
              />
            </pattern>
          </defs>
          <rect width="1000" height="1000" fill={`url(#${backdropId}-base)`} />
          <ellipse cx="180" cy="240" rx="520" ry="360" fill={`url(#${backdropId}-teal)`} />
          <ellipse cx="820" cy="850" rx="520" ry="360" fill={`url(#${backdropId}-violet)`} />
          <rect width="1000" height="1000" fill={`url(#${backdropId}-grid)`} />
          <path
            d="M-40 340L1040 180M-40 960L1040 800"
            stroke="#d2e7f2"
            strokeOpacity="0.3"
            strokeWidth="8"
          />
        </svg>
        <main className="canvas-showcase__main">
          <LiquidGlass
            {...settings}
            convexity={convexity}
            className="canvas-showcase__glass canvas-showcase__hero"
            aria-labelledby="showcase-title"
          >
            <h1 className="canvas-showcase__title" id="showcase-title">
              React Liquid Glass Component
            </h1>
            <p className="canvas-showcase__subtitle">
              Control refraction, Fresnel reflection, glare and blur.
            </p>
            <code className="canvas-showcase__example">
              {"import { LiquidGlass } from 'react-liquid-glass-component'"}
            </code>
          </LiquidGlass>

          <section className="canvas-showcase__variants" aria-label="Glass variants">
            {variants.map((variant) => (
              <LiquidGlass
                key={variant.title}
                {...settings}
                convexity={convexity}
                className="canvas-showcase__glass canvas-showcase__variant"
              >
                <div>
                  <h2 className="canvas-showcase__variant-title">{variant.title}</h2>
                  <p className="canvas-showcase__variant-text">{variant.text}</p>
                </div>
                <CopyControl text={settingsSnippet} label={`${variant.title} example`} />
              </LiquidGlass>
            ))}
          </section>

          <LiquidGlass
            {...settings}
            convexity={convexity}
            className="canvas-showcase__glass canvas-showcase__install"
            aria-label="Install package"
          >
            <div className="canvas-showcase__install-row">
              <code className="canvas-showcase__command">
                {'npm install '}<span className="canvas-showcase__package">{packageName}</span>
              </code>
              <CopyControl text={installCommand} label="install command" />
            </div>
            <p className="canvas-showcase__install-note">
              Styles are included automatically. To share one stylesheet, import styles.css and
              set includeStyles to false.
            </p>
          </LiquidGlass>

          <section className="canvas-showcase__scroll" aria-labelledby="scroll-content-heading">
            <div className="canvas-showcase__intro">
              <p className="canvas-showcase__eyebrow">MADE FOR YOUR INTERFACE</p>
              <h2 className="canvas-showcase__heading" id="scroll-content-heading">
                A little more room to explore.
              </h2>
              <p className="canvas-showcase__text">
                From a small control to a larger panel, adjust the glass to suit the content around
                it.
              </p>
            </div>
            <div className="canvas-showcase__grid">
              {cards.map((card, index) => (
                <LiquidGlass
                  key={card.title}
                  {...settings}
                  convexity={convexity}
                  className="canvas-showcase__glass canvas-showcase__card"
                >
                  <span className="canvas-showcase__number" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <h3 className="canvas-showcase__card-title">{card.title}</h3>
                    <p className="canvas-showcase__text">{card.text}</p>
                  </div>
                </LiquidGlass>
              ))}
            </div>
            <div className="canvas-showcase__notes">
              <p className="canvas-showcase__eyebrow">KEEP EXPLORING</p>
              <h2 className="canvas-showcase__notes-heading">See the details through the glass.</h2>
              <p className="canvas-showcase__text">
                Scroll past the navigation bar to see the text and cards bend underneath it. The
                background stays in place while the page moves.
              </p>
              <p className="canvas-showcase__text">
                Use the Glass settings panel to adjust every surface, then copy the settings you
                want to use.
              </p>
            </div>
          </section>
        </main>

        <Navbar
          current="showcase"
          settings={settings}
          convexity={convexity}
          onMenuOpenChange={setMenuOpen}
        />
      </CanvasShowcaseStyled>
      <div hidden={menuOpen}>
        <GlassControls
          settings={settings}
          onSettingsChange={setSettings}
          convexity={convexity}
          onConvexityChange={setConvexity}
          onReset={() => {
            setSettings(createStudioSettings())
            setConvexity(0)
          }}
        />
      </div>
    </>
  )
}
