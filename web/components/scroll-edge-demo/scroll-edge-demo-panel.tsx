'use client'

import { useId, type ReactNode } from 'react'
import styled from 'styled-components'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Layers,
  MoveVertical,
  Sparkles,
} from 'lucide-react'
import {
  GLASS_STUDIO_DEFAULTS,
  LiquidGlass,
  LiquidGlassScene,
} from '@/components/liquid-glass-client'
import Navbar from '@/components/navbar'
import VideoBackground from '@/components/video-background'
import { borderRadius, breakpoints, colors, fonts, fontWeight } from '@/lib/responsive'
import NativeScrollViewport, { type NativeScrollMode } from './native-scroll-viewport'

const ScrollEdgeDemoStyled = styled(LiquidGlassScene)`
  min-height: 100dvh;
  color: ${colors.foreground};

  .scroll-edge-demo__main {
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 32px;
    padding: calc(94px + max(16px, env(safe-area-inset-top))) max(16px, env(safe-area-inset-right))
      max(40px, env(safe-area-inset-bottom))
      max(16px, env(safe-area-inset-left));
  }

  .scroll-edge-demo__hero {
    width: 100%;
    max-width: 960px;
    min-width: 0;
    padding: 32px 28px;
    text-align: center;
  }

  .scroll-edge-demo__hero > .liquid-glass__content {
    display: block;
  }

  .scroll-edge-demo__eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 14px;
    font-size: 0.75rem;
    font-weight: ${fontWeight.medium};
    color: ${colors.foregroundMuted};
    letter-spacing: 0.06em;
    line-height: 1.5;
    padding: 4px 8px;
    border-radius: 6px;
  }

  .scroll-edge-demo__eyebrow svg,
  .scroll-edge-demo__card-icon svg {
    /* These icons fit their viewBoxes; no extra nested SVG clipping is needed. */
    overflow: visible;
  }

  .scroll-edge-demo__title {
    display: table;
    margin: 0 auto 12px;
    color: ${colors.foreground};
    font-size: clamp(1.8rem, 4vw, 2.6rem);
    font-weight: ${fontWeight.bold};
    letter-spacing: -0.03em;
    line-height: 1.15;
    padding: 6px 12px;
    border-radius: 8px;
  }

  .scroll-edge-demo__subtitle {
    max-width: 480px;
    margin: 0 auto;
    color: ${colors.foregroundMuted};
    font-size: 0.95rem;
    line-height: 1.65;
    padding: 6px 10px;
    border-radius: 8px;
  }

  .scroll-edge-demo__grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: stretch;
    gap: 24px;
    width: 100%;
    max-width: 960px;
    min-width: 0;
  }

  .scroll-edge-demo__card {
    min-width: 0;
    padding: 24px;
    border-radius: 28px;
    background: #1c4e69;
  }

  .scroll-edge-demo__card-header {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 20px;
    padding: 12px;
    border-radius: 10px;
  }

  .scroll-edge-demo__card-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    border-radius: 10px;
  }

  .scroll-edge-demo__card-copy {
    min-width: 0;
  }
  .scroll-edge-demo__card-title {
    margin: 0 0 4px;
    font-size: 1rem;
    font-weight: ${fontWeight.semibold};
    line-height: 1.4;
  }
  .scroll-edge-demo__card-desc {
    margin: 0;
    color: ${colors.foregroundMuted};
    font-size: 0.875rem;
    line-height: 1.55;
  }

  .scroll-edge-demo__viewport {
    width: 100%;
    min-width: 0;
    height: 260px;
    border-radius: ${borderRadius.lg};
  }

  .scroll-edge-demo__props {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    min-width: 0;
    margin-top: 16px;
    font-family: ${fonts.mono};
    font-size: 0.6875rem;
    line-height: 1.5;
  }
  .scroll-edge-demo__prop-tag {
    max-width: 100%;
    min-width: 0;
    padding: 4px 7px;
    border-radius: 5px;
    color: ${colors.foreground};
    overflow-wrap: anywhere;
  }

  .scroll-edge-demo__hint {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin: 0;
    font-size: 0.8rem;
    line-height: 1.5;
    color: ${colors.foregroundMuted};
    text-align: center;
    padding: 6px 12px;
    border-radius: 8px;
    background: rgba(28, 78, 105, 0.72);
  }

  @media (max-width: ${breakpoints.mobile}) {
    .scroll-edge-demo__main {
      gap: 24px;
      padding: calc(86px + max(16px, env(safe-area-inset-top))) max(16px, env(safe-area-inset-right))
        max(32px, env(safe-area-inset-bottom))
        max(16px, env(safe-area-inset-left));
    }
    .scroll-edge-demo__grid {
      grid-template-columns: minmax(0, 1fr);
      gap: 20px;
    }
    .scroll-edge-demo__hero {
      padding: 28px 20px;
    }
    .scroll-edge-demo__card {
      padding: 20px;
    }
  }
`

const examples: {
  mode: NativeScrollMode
  title: string
  description: string
  tags: string[]
  icon: ReactNode
}[] = [
  {
    mode: 'fade',
    title: 'Edge fade',
    description: 'Content fades into the background at the edges as you scroll.',
    tags: ["edges={['top', 'bottom']}", 'shadow', 'blur={false}'],
    icon: <MoveVertical size={18} />,
  },
  {
    mode: 'blur',
    title: 'Gradual blur',
    description: 'Content softens progressively near the viewport edges.',
    tags: ["edges={['top', 'bottom']}", 'blur', 'divCount={4}', 'shadow={false}'],
    icon: <Sparkles size={18} />,
  },
  {
    mode: 'fade-all',
    title: 'Fade on all edges',
    description: 'Fade content as you scroll vertically and horizontally.',
    tags: ["edges={['top', 'bottom', 'left', 'right']}", 'shadow', 'blur={false}'],
    icon: (
      <>
        <ArrowUp size={16} />
        <ArrowDown size={16} />
      </>
    ),
  },
  {
    mode: 'blur-all',
    title: 'Blur on all edges',
    description: 'Blur content as you scroll vertically and horizontally.',
    tags: ["edges={['top', 'bottom', 'left', 'right']}", 'blur', 'divCount={4}', 'shadow={false}'],
    icon: (
      <>
        <ArrowLeft size={16} />
        <ArrowRight size={16} />
      </>
    ),
  },
]

function DemoCard({ mode, title, description, tags, icon }: (typeof examples)[number]) {
  const titleId = useId()
  return (
    <article className="scroll-edge-demo__card" aria-labelledby={titleId}>
      <div className="scroll-edge-demo__card-header">
        <div className="scroll-edge-demo__card-icon" aria-hidden="true">
          {icon}
        </div>
        <div className="scroll-edge-demo__card-copy">
          <h2 className="scroll-edge-demo__card-title" id={titleId}>
            {title}
          </h2>
          <p className="scroll-edge-demo__card-desc">{description}</p>
        </div>
      </div>
      <NativeScrollViewport mode={mode} label={title} labelledBy={titleId} />
      <div className="scroll-edge-demo__props">
        {tags.map((tag) => (
          <code className="scroll-edge-demo__prop-tag" key={tag}>
            {tag}
          </code>
        ))}
      </div>
    </article>
  )
}

export function ScrollEdgeDemoPanel() {
  return (
    <ScrollEdgeDemoStyled background="#101c2b">
      <VideoBackground src="/videos/bangkok.mp4" />
      <Navbar current="scroll-edge" />
      <main className="scroll-edge-demo__main">
        <LiquidGlass {...GLASS_STUDIO_DEFAULTS} className="scroll-edge-demo__hero">
          <div className="scroll-edge-demo__eyebrow">
            <Layers size={16} aria-hidden="true" />
            <span>SCROLL AWARE EFFECTS</span>
          </div>
          <h1 className="scroll-edge-demo__title">ScrollEdge</h1>
          <p className="scroll-edge-demo__subtitle">
            Compare transparent edge fade and gradual blur in separate examples.
          </p>
        </LiquidGlass>
        <div className="scroll-edge-demo__grid">
          {examples.map((example) => (
            <DemoCard {...example} key={example.mode} />
          ))}
        </div>
        <p className="scroll-edge-demo__hint">
          <MoveVertical size={16} aria-hidden="true" />
          <span>Scroll inside each box to see the edges react.</span>
        </p>
      </main>
    </ScrollEdgeDemoStyled>
  )
}
