'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import styled from 'styled-components'
import {
  GLASS_STUDIO_DEFAULTS,
  LiquidGlass,
  type GlassStudioProps,
} from '@/components/liquid-glass-client'
import { colors, fontSize, fontWeight } from '@/lib/responsive'

const NavbarStyled = styled(LiquidGlass)`
  &.navbar {
    top: max(16px, env(safe-area-inset-top));
    left: max(16px, env(safe-area-inset-left));
    right: max(16px, env(safe-area-inset-right));
    max-width: 960px;
    margin-inline: auto;
    z-index: 100;
    min-width: 0;
  }

  & > .liquid-glass__content {
    display: block;
  }

  .navbar__inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    height: 62px;
    max-width: 1600px;
    margin: 0 auto;
    padding-left: 24px;
    padding-right: 24px;
  }

  .navbar__logo {
    flex-shrink: 0;
    color: ${colors.foreground};
    font-size: ${fontSize['2xl']};
    font-weight: ${fontWeight.bold};
    letter-spacing: -0.02em;
    line-height: 1.5;
    white-space: nowrap;
    padding: 4px 6px;
    margin-inline: -6px;
    border-radius: 6px;
  }

  .navbar__links {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }

  .navbar__link,
  .navbar__toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    padding: 10px 12px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: ${colors.foreground};
    font: inherit;
    font-size: ${fontSize.sm};
    font-weight: ${fontWeight.medium};
    line-height: 1.5;
    text-decoration: none;
    white-space: nowrap;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;

    &:hover {
      color: ${colors.foreground};
    }

    &:focus-visible {
      outline: 2px solid #b4eaff;
      outline-offset: 3px;
    }
  }

  .navbar__link[aria-current='page'] {
    color: ${colors.foreground};
    text-decoration: underline;
    text-underline-offset: 4px;
  }

  .navbar__toggle {
    display: none;
    min-width: 60px;
    border: 1px solid rgba(255, 255, 255, 0.5);
    color: ${colors.foreground};
    font-size: ${fontSize.base};

  }

  .navbar__mobile {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 16px 16px;
  }

  .navbar__mobile .navbar__link {
    justify-content: flex-start;
    width: 100%;
    font-size: ${fontSize.lg};
  }

  @media (min-width: 421px) and (max-width: 600px) {
    .navbar__inner {
      gap: 8px;
      padding-left: 12px;
      padding-right: 12px;
    }

    .navbar__link {
      padding-left: 8px;
      padding-right: 8px;
    }
  }

  @media (min-width: 421px) {
    .navbar__mobile {
      display: none;
    }
  }

  @media (max-width: 420px) {
    .navbar__links {
      display: none;
    }

    .navbar__toggle {
      display: inline-flex;
    }
  }
`

const pages = [
  { id: 'showcase', href: '/', label: 'Showcase' },
  { id: 'demo', href: '/demo', label: 'Demo' },
  { id: 'scroll-edge', href: '/scroll-edge', label: 'ScrollEdge' },
] as const

export type NavbarPage = (typeof pages)[number]['id']

interface NavbarProps {
  current: NavbarPage
  settings?: GlassStudioProps
  convexity?: number
  glareAngleMode?: 'manual' | 'interactive'
  onMenuOpenChange?: (open: boolean) => void
}

/** Render inside the page's LiquidGlassScene so navigation shares its renderer. */
export default function Navbar({
  current,
  settings = GLASS_STUDIO_DEFAULTS,
  convexity = 0,
  glareAngleMode = 'manual',
  onMenuOpenChange,
}: NavbarProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = useCallback(() => setMenuOpen(false), [])

  useEffect(() => {
    onMenuOpenChange?.(menuOpen)
  }, [menuOpen, onMenuOpenChange])

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 421px)')
    const onChange = () => {
      if (desktop.matches) closeMenu()
    }
    desktop.addEventListener('change', onChange)
    return () => desktop.removeEventListener('change', onChange)
  }, [closeMenu])

  useEffect(() => {
    if (!menuOpen) return
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) closeMenu()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeMenu()
      menuButtonRef.current?.focus({ preventScroll: true })
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', closeMenu, { capture: true, passive: true })
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', closeMenu, true)
    }
  }, [menuOpen, closeMenu])

  const links = () => (
    <>
      {pages.map((page) => (
        <Link
          key={page.id}
          href={page.href}
          className="navbar__link"
          aria-current={page.id === current ? 'page' : undefined}
          onClick={closeMenu}
        >
          {page.label}
        </Link>
      ))}
      <a
        className="navbar__link"
        href="https://github.com/SAHAJOHN/react-liquid-glass-component"
        target="_blank"
        rel="noopener noreferrer"
        onClick={closeMenu}
      >
        GitHub
      </a>
    </>
  )

  return (
    <NavbarStyled
      {...settings}
      convexity={convexity}
      glareAngleMode={glareAngleMode}
      ref={rootRef}
      className="navbar"
      role="navigation"
      aria-label="Main navigation"
      style={{ position: 'fixed' }}
    >
      <div className="navbar__inner">
        <span className="navbar__logo">Liquid Glass</span>
        <div className="navbar__links">{links()}</div>
        <button
          ref={menuButtonRef}
          type="button"
          className="navbar__toggle"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? 'Close' : 'Menu'}
        </button>
      </div>
      {menuOpen && (
        <div className="navbar__mobile" id={menuId}>
          {links()}
        </div>
      )}
    </NavbarStyled>
  )
}
