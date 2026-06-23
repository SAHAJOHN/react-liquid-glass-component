import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { LiquidGlass } from '../LiquidGlass'

describe('LiquidGlass', () => {
  it('renders children', () => {
    render(<LiquidGlass>hello</LiquidGlass>)
    expect(screen.getByText('hello')).toBeInTheDocument()
  })

  it('applies default liquid-glass class', () => {
    const { container } = render(<LiquidGlass>x</LiquidGlass>)
    const root = container.firstChild as HTMLElement
    expect(root).toHaveClass('liquid-glass')
  })

  it('renders with either --svg or --fallback modifier class', () => {
    const { container } = render(<LiquidGlass>x</LiquidGlass>)
    const root = container.firstChild as HTMLElement
    // The environment may or may not support SVG backdrop-filter
    const modifierClass = Array.from(root.classList).find(
      (c) => c === 'liquid-glass--svg' || c === 'liquid-glass--fallback',
    )
    expect(modifierClass).toBeTruthy()
  })

  it('forwards ref to root div element', () => {
    const ref = createRef<HTMLDivElement>()
    render(<LiquidGlass ref={ref}>x</LiquidGlass>)
    expect(ref.current).toBeInstanceOf(HTMLDivElement)
  })

  it('merges custom className with default classes', () => {
    const { container } = render(<LiquidGlass className="my-custom-class">x</LiquidGlass>)
    const root = container.firstChild as HTMLElement
    expect(root).toHaveClass('my-custom-class')
    expect(root).toHaveClass('liquid-glass')
  })

  it('applies borderRadius as CSS pixels', () => {
    const { container } = render(<LiquidGlass borderRadius={50}>x</LiquidGlass>)
    const root = container.firstChild as HTMLElement
    expect(root.style.borderRadius).toBe('50px')
  })

  it('renders without children (empty content)', () => {
    const { container } = render(<LiquidGlass />)
    const contentEl = container.querySelector('.liquid-glass__content')
    expect(contentEl).toBeInTheDocument()
  })

  it('preserves string width/height without appending px', () => {
    const { container } = render(
      <LiquidGlass width="100%" height="50vh">
        x
      </LiquidGlass>,
    )
    const root = container.firstChild as HTMLElement
    expect(root.style.width).toBe('100%')
    expect(root.style.height).toBe('50vh')
  })

  it('sets glassColor and backgroundOpacity as CSS custom properties', () => {
    const { container } = render(
      <LiquidGlass glassColor="#ff6b6b" backgroundOpacity={0.5}>
        x
      </LiquidGlass>,
    )
    const root = container.firstChild as HTMLElement
    expect(root.style.getPropertyValue('--glass-color')).toBe('#ff6b6b')
    expect(root.style.getPropertyValue('--glass-frost')).toBe('0.5')
  })
})
