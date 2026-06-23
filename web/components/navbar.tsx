'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import styled from 'styled-components'
import { fonts, fontWeight, fontSize, colors } from '@/lib/responsive'

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
`

interface NavbarProps {
  current: 'showcase' | 'demo'
}

export default function Navbar({ current }: NavbarProps) {
  const [hidden, setHidden] = useState(false)

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

  const linkClass = (page: 'showcase' | 'demo') =>
    `navbar__link${current === page ? ' navbar__link--active' : ''}`

  return (
    <NavbarStyled $hidden={hidden}>
      <div className="navbar__inner">
        <span className="navbar__logo">Liquid Glass</span>
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
      </div>
    </NavbarStyled>
  )
}
