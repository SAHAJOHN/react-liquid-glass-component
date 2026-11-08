'use client'

import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import {
  LiquidGlass,
  LiquidGlassScene,
  type GlassStudioProps,
} from '@/components/liquid-glass-client'
import Navbar from '@/components/navbar'
import VideoBackground from '@/components/video-background'
import GlassControls from '@/components/showcase/glass-controls'
import { createStudioSettings } from '@/lib/studio-settings'
import { colors, fonts, fontWeight } from '@/lib/responsive'

const DemoStyled = styled.div`
  min-width: 0;
  min-height: 100dvh;
  background: #102031;
  color: ${colors.foreground};

  .demo__scene {
    min-width: 0;
    min-height: 100dvh;
  }

  .demo__main {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
    width: 100%;
    max-width: 1600px;
    margin: 0 auto;
    padding: calc(104px + max(16px, env(safe-area-inset-top))) max(16px, env(safe-area-inset-right))
      calc(40dvh + 48px + env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
  }

  .demo__header,
  .demo__preview,
  .demo__details {
    width: 960px;
    max-width: 100%;
    min-width: 0;
  }

  .demo__title {
    display: inline-block;
    margin: 0;
    padding: 6px 12px;
    border-radius: 10px;
    background: rgba(28, 78, 105, 0.72);
    color: ${colors.foreground};
    font-size: clamp(1.8rem, 4vw, 2.4rem);
    font-weight: ${fontWeight.bold};
    line-height: 1.2;
    letter-spacing: -0.03em;
  }

  .demo__description {
    display: table;
    max-width: 100%;
    margin: 8px 0 0;
    padding: 4px 8px;
    border-radius: 6px;
    background: rgba(28, 78, 105, 0.72);
    color: ${colors.foreground};
    font-size: 0.9rem;
    line-height: 1.5;
  }

  .demo__preview {
    height: clamp(240px, 32dvh, 320px);
  }

  .demo__preview > .liquid-glass__content {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    min-width: 0;
    padding: 24px;
    text-align: center;
  }

  .demo__preview-title {
    margin: 0;
    padding: 6px 12px;
    border-radius: 10px;
    color: ${colors.foreground};
    font-size: clamp(1.5rem, 4vw, 2rem);
    font-weight: ${fontWeight.semibold};
    line-height: 1.2;
    letter-spacing: -0.02em;
  }

  .demo__copy {
    min-width: 120px;
    min-height: 44px;
    padding: 10px 16px;
    border: 1px solid ${colors.buttonBorder};
    border-radius: 10px;
    background: transparent;
    color: ${colors.foreground};
    font: inherit;
    font-size: 0.875rem;
    font-weight: ${fontWeight.medium};
    line-height: 1.5;
    cursor: pointer;

    &:focus-visible {
      outline: 2px solid #b4eaff;
      outline-offset: 3px;
    }
  }

  .demo__details {
    padding: 24px;
    border-radius: 16px;
    background: rgba(28, 78, 105, 0.78);
  }

  .demo__details-title {
    margin: 0 0 8px;
    color: ${colors.foreground};
    font-size: 1rem;
    font-weight: ${fontWeight.semibold};
    line-height: 1.4;
  }

  .demo__hint {
    margin: 0 0 16px;
    color: ${colors.foregroundMuted};
    font-size: 0.875rem;
    line-height: 1.6;
  }

  .demo__code {
    margin: 0;
    color: ${colors.foreground};
    font-family: ${fonts.mono};
    font-size: 0.8rem;
    line-height: 1.7;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  @media (min-width: 900px) {
    .demo__main {
      padding-bottom: 80px;
    }
  }

  @media (max-width: 899px) {
    .demo__controls > aside {
      left: max(16px, env(safe-area-inset-left));
      right: max(16px, env(safe-area-inset-right));
      width: auto;
      max-height: 40dvh;
    }
  }

  @media (max-width: 700px) {
    .demo__main {
      gap: 20px;
      padding-top: calc(96px + max(16px, env(safe-area-inset-top)));
      padding-left: max(16px, env(safe-area-inset-left));
      padding-right: max(16px, env(safe-area-inset-right));
    }
    .demo__preview {
      height: clamp(220px, 30dvh, 280px);
    }
    .demo__preview > .liquid-glass__content {
      padding: 20px;
    }
    .demo__details {
      padding: 20px;
    }
  }
`

const usageCode = `'use client'

import { LiquidGlass, LiquidGlassScene } from 'react-liquid-glass-component'

export function GlassExample() {
  return (
    <LiquidGlassScene>
      <main>Background content</main>
      <LiquidGlass refThickness={20} blurRadius={1}>
        Your content
      </LiquidGlass>
    </LiquidGlassScene>
  )
}`

export function DemoPanel() {
  const [settings, setSettings] = useState<GlassStudioProps>(createStudioSettings)
  const [convexity, setConvexity] = useState(0)
  const [interactiveGlare, setInteractiveGlare] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (copyTimer.current !== undefined) clearTimeout(copyTimer.current)
    }
  }, [])

  const copy = async () => {
    if (copyTimer.current !== undefined) clearTimeout(copyTimer.current)
    try {
      await navigator.clipboard.writeText(
        `<LiquidGlass\n  {...${JSON.stringify(settings, null, 2)}}\n  convexity={${convexity}}\n  glareAngleMode="${interactiveGlare ? 'interactive' : 'manual'}"\n/>`
      )
      if (mounted.current) setCopyStatus('copied')
    } catch {
      if (mounted.current) setCopyStatus('failed')
    }
    if (mounted.current) copyTimer.current = setTimeout(() => setCopyStatus('idle'), 2500)
  }

  const reset = () => {
    setSettings(createStudioSettings())
    setConvexity(0)
    setInteractiveGlare(false)
  }

  return (
    <DemoStyled>
      <LiquidGlassScene
        className="demo__scene"
        background="#102031"
        maxPixelRatio={Number.MAX_SAFE_INTEGER}
        maxCanvasPixels={16_777_216}
      >
        <VideoBackground src="/videos/bangkok.mp4" />
        <Navbar
          current="demo"
          settings={settings}
          convexity={convexity}
          glareAngleMode={interactiveGlare ? 'interactive' : 'manual'}
          onMenuOpenChange={setMenuOpen}
        />
        <main className="demo__main">
          <header className="demo__header">
            <h1 className="demo__title">Live preview</h1>
            <p className="demo__description">Tune the glass over a moving scene.</p>
          </header>
          <section className="demo__details" aria-labelledby="demo-settings-title">
            <h2 className="demo__details-title" id="demo-settings-title">
              Use these settings
            </h2>
            <p className="demo__hint">
              Copy settings includes every material value. Place your page and glass in the same
              scene. Styles are included automatically.
            </p>
            <pre className="demo__code">
              <code>{usageCode}</code>
            </pre>
          </section>
          <LiquidGlass
            {...settings}
            convexity={convexity}
            glareAngleMode={interactiveGlare ? 'interactive' : 'manual'}
            className="demo__preview"
          >
            <h2 className="demo__preview-title">Liquid Glass</h2>
            <button
              type="button"
              className="demo__copy"
              onClick={copy}
              aria-label={
                copyStatus === 'copied'
                  ? 'Settings copied'
                  : copyStatus === 'failed'
                    ? 'Copy failed. Retry settings'
                    : 'Copy current glass settings'
              }
              aria-live="polite"
            >
              {copyStatus === 'copied'
                ? 'Copied'
                : copyStatus === 'failed'
                  ? 'Retry copy'
                  : 'Copy settings'}
            </button>
          </LiquidGlass>
        </main>
      </LiquidGlassScene>
      <div className="demo__controls" hidden={menuOpen}>
        <GlassControls
          settings={settings}
          interactiveGlare={interactiveGlare}
          onInteractiveGlareChange={setInteractiveGlare}
          onSettingsChange={setSettings}
          convexity={convexity}
          onConvexityChange={setConvexity}
          onReset={reset}
        />
      </div>
    </DemoStyled>
  )
}
