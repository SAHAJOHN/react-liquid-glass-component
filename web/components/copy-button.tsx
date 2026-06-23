'use client'

import { useState, useCallback } from 'react'
import styled from 'styled-components'
import { colors, borderRadius } from '@/lib/responsive'
import { Copy, Check } from 'lucide-react'

const CopyButtonStyled = styled.button<{ $visible: boolean }>`
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid ${colors.buttonBorder};
  border-radius: ${borderRadius.xl};
  background: #ffffff94;
  color: black;
  cursor: pointer;
  opacity: ${({ $visible }) => ($visible ? '1' : '0')};
  transition: opacity 0.2s, background 0.2s, color 0.2s;

  &:hover {
    background: rgba(255, 255, 255, 0.14);
    color: ${colors.foreground};
  }
`

interface CopyButtonProps {
  text: string
  visible: boolean
}

export default function CopyButton({ text, visible }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API not available
    }
  }, [text])

  return (
    <CopyButtonStyled
      $visible={visible}
      onClick={handleCopy}
      aria-label={copied ? 'Copied' : 'Copy code'}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </CopyButtonStyled>
  )
}
