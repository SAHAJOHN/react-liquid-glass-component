'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import styled from 'styled-components'
import { motion, AnimatePresence } from 'framer-motion'
import { fontWeight, fontSize, colors } from '@/lib/responsive'

const NavbarStyled = styled.nav<{ $hidden: boolean }>`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  background: ${colors.navBackground};
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid ${colors.navBorder};
  transform: translateY(${({ $hidden }) => ($hidden ? '-100%' : '0')});
  transition: transform 0.3s ease;

  .navbar__inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 62px;
    max-width: 1600px;
    margin: 0 auto;
    padding: 0 24px;
  }

  .navbar__logo {
    font-weight: ${fontWeight.bold};
    font-size: ${fontSize['2xl']};
    letter-spacing: -0.02em;
    color: ${colors.foreground};
    white-space: nowrap;
  }

  .navbar__links {
    display: flex;
    align-items: center;
    gap: 4px;

    @media (max-width: 420px) {
      display: none;
    }
  }

  .navbar__link {
    background: none;
    border: none;
    font: inherit;
    font-size: ${fontSize.sm};
    font-weight: ${fontWeight.medium};
    color: ${colors.foregroundDim};
    padding: 6px 12px;
    border-radius: 8px;
    cursor: pointer;
    text-decoration: none;
    transition: color 0.2s, background 0.2s;
    letter-spacing: 0.02em;

    &:hover {
      color: ${colors.foreground};
      background: rgba(255, 255, 255, 0.08);
    }

    &--active {
      color: ${colors.foreground};
      background: rgba(255, 255, 255, 0.1);
    }
  }

  .navbar__link--external {
    opacity: 0.45;

    &:hover {
      opacity: 0.85;
    }
  }

  /* Hamburger toggle */
  .navbar__toggle {
    display: none;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    background: none;
    border: none;
    cursor: pointer;
    border-radius: 8px;
    transition: background 0.2s;
    -webkit-tap-highlight-color: transparent;

    &:hover {
      background: rgba(255, 255, 255, 0.08);
    }

    @media (max-width: 420px) {
      display: flex;
    }
  }

  /* Animated hamburger icon */
  .navbar__hamburger {
    position: relative;
    width: 22px;
    height: 22px;
  }

  .navbar__hamburger-line {
    position: absolute;
    left: 0;
    width: 100%;
    height: 2px;
    background: ${colors.foreground};
    border-radius: 2px;
    transition: transform 0.25s ease, opacity 0.25s ease;

    &:nth-child(1) {
      top: 2px;
    }

    &:nth-child(2) {
      top: 10px;
    }

    &:nth-child(3) {
      top: 18px;
    }
  }

  .navbar__hamburger--open {
    .navbar__hamburger-line:nth-child(1) {
      transform: translateY(8px) rotate(45deg);
    }

    .navbar__hamburger-line:nth-child(2) {
      opacity: 0;
    }

    .navbar__hamburger-line:nth-child(3) {
      transform: translateY(-8px) rotate(-45deg);
    }
  }

  /* Mobile dropdown menu */
  .navbar__mobile {
    border-radius: 0 0 24px 24px;
    position: absolute;
    top: 62px;
    left: 0;
    right: 0;
    background: ${colors.navBackground};
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-bottom: 1px solid ${colors.navBorder};
    display: flex;
    flex-direction: column;
    padding: 8px 16px 12px;
    gap: 4px;
    z-index: 99;
    overflow: hidden;
  }

  .navbar__mobile-link {
    display: block;
    background: none;
    border: none;
    font: inherit;
    font-size: ${fontSize.sm};
    font-weight: ${fontWeight.medium};
    color: ${colors.foregroundDim};
    padding: 12px 12px;
    border-radius: 8px;
    cursor: pointer;
    text-decoration: none;
    transition: color 0.2s, background 0.2s;
    letter-spacing: 0.02em;

    &:hover {
      color: ${colors.foreground};
      background: rgba(255, 255, 255, 0.08);
    }

    &--active {
      color: ${colors.foreground};
      background: rgba(255, 255, 255, 0.1);
    }

    &--external {
      opacity: 0.45;

      &:hover {
        opacity: 0.85;
      }
    }
  }
`

interface NavbarProps {
  current: 'showcase' | 'demo'
}

export default function Navbar({ current }: NavbarProps) {
  const [hidden, setHidden] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    let lastScrollY = window.scrollY

    const onScroll = () => {
      const y = window.scrollY
      if (y < 50) {
        setHidden(false)
      } else if (y > lastScrollY) {
        setHidden(true)
      } else {
        setHidden(false)
      }
      lastScrollY = y
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Close mobile menu on scroll
  useEffect(() => {
    if (!menuOpen) return
    const onScrollClose = () => setMenuOpen(false)
    window.addEventListener('scroll', onScrollClose, { passive: true })
    return () => window.removeEventListener('scroll', onScrollClose)
  }, [menuOpen])

  // Close mobile menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[class*="navbar"]')) {
        setMenuOpen(false)
      }
    }
    // Delay adding listener so the toggle click isn't captured
    const id = setTimeout(() => {
      document.addEventListener('click', handleClick)
    }, 0)
    return () => {
      clearTimeout(id)
      document.removeEventListener('click', handleClick)
    }
  }, [menuOpen])

  // Close mobile menu when navigating
  const closeMenu = () => setMenuOpen(false)

  const linkClass = (page: 'showcase' | 'demo') =>
    `navbar__link${current === page ? ' navbar__link--active' : ''}`

  const mobileLinkClass = (page: 'showcase' | 'demo') =>
    `navbar__mobile-link${current === page ? ' navbar__mobile-link--active' : ''}`

  return (
    <NavbarStyled $hidden={hidden}>
      <div className="navbar__inner">
        <span className="navbar__logo">Liquid Glass</span>

        {/* Desktop links */}
        <div className="navbar__links">
          <Link href="/" className={linkClass('showcase')}>
            Showcase
          </Link>
          <Link href="/demo" className={linkClass('demo')}>
            Demo
          </Link>
          <a
            className="navbar__link navbar__link--external"
            href="https://github.com/SAHAJOHN/react-liquid-glass-component"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub ↗
          </a>
        </div>

        {/* Hamburger toggle */}
        <button
          className="navbar__toggle"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
        >
          <div
            className={`navbar__hamburger${menuOpen ? ' navbar__hamburger--open' : ''}`}
          >
            <span className="navbar__hamburger-line" />
            <span className="navbar__hamburger-line" />
            <span className="navbar__hamburger-line" />
          </div>
        </button>
      </div>

      {/* Mobile dropdown */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            className="navbar__mobile"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          >
            <Link
              href="/"
              className={mobileLinkClass('showcase')}
              onClick={closeMenu}
            >
              Showcase
            </Link>
            <Link
              href="/demo"
              className={mobileLinkClass('demo')}
              onClick={closeMenu}
            >
              Demo
            </Link>
            <a
              className="navbar__mobile-link navbar__mobile-link--external"
              href="https://github.com/SAHAJOHN/react-liquid-glass-component"
              target="_blank"
              rel="noopener noreferrer"
              onClick={closeMenu}
            >
              GitHub ↗
            </a>
          </motion.div>
        )}
      </AnimatePresence>
    </NavbarStyled>
  )
}
