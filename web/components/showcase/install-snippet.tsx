'use client'

import { useState, useCallback } from 'react'
import styled from 'styled-components'
import { fontSize } from '@/lib/responsive'
import { LiquidGlass } from '@/components/liquid-glass-client'
import { Copy, Check } from 'lucide-react'

const InstallStyled = styled.section`
  display: flex;
  justify-content: center;

  .install__glass {
    background: #0064ff38;
    padding: 20px;
  }

  .install__code-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    overflow: hidden;
  }

  .install__code {
    display: flex;
    align-items: center;
    min-width: 0;
    flex: 1;
    font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
    font-size: ${fontSize.md};
    color: rgba(255, 255, 255, 0.75);
    letter-spacing: -0.01em;
    filter: drop-shadow(0px 0px 8px rgba(0, 0, 0, 0.5));

    @media (max-width: 700px) {
      font-size: 0.7rem;
    }
  }

  .install__text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .install__prompt {
    opacity: 0.35;
    margin-right: 10px;
  }

  .install__copy-btn {
    cursor: pointer;
    margin-top: 2px;
    &:hover {
      color: rgba(255, 255, 255, 0.85);
    }
  }
`

export default function InstallSnippet() {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(
        'npm install react-liquid-glass-component styled-components',
      )
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API not available
    }
  }, [])

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
        <div className="install__code-row">
          <code className="install__code">
            <span className="install__prompt">$</span>
            <span className="install__text">npm install react-liquid-glass-component styled-components</span>
          </code>
          <div
            className="install__copy-btn"
            onClick={handleCopy}
            aria-label={copied ? 'Copied' : 'Copy command'}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </div>
        </div>
      </LiquidGlass>
    </InstallStyled>
  )
}
