'use client'

import styled from 'styled-components'
import { colors, fontSize, borderRadius } from '@/lib/responsive'
import { LiquidGlass } from '@/components/liquid-glass-client'

const InstallStyled = styled.section`
  display: flex;
  justify-content: center;

  .install__code {
    display: flex;
    align-items: center;
    font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
    font-size: ${fontSize.md};
    color: rgba(255, 255, 255, 0.75);
    letter-spacing: -0.01em;
    filter: drop-shadow(0px 0px 8px rgba(0, 0, 0, 0.5));

    @media (max-width: 700px) {
      font-size: 0.7rem;
    }
  }

  .install__prompt {
    opacity: 0.35;
    margin-right: 10px;
  }
`

export default function InstallSnippet() {
  return (
    <InstallStyled>
      <LiquidGlass
        borderRadius={16}
        blur={12}
        opacity={0.85}
        brightness={40}
        backgroundOpacity={0.3}
        style={{
          background: '#0064ff38',
          padding: '20px',
        }}
      >
        <code className="install__code">
          <span className="install__prompt">$</span>
          npm install react-liquid-glass-component styled-components
        </code>
      </LiquidGlass>
    </InstallStyled>
  )
}
