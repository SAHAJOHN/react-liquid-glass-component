'use client'

import { createGlobalStyle } from 'styled-components'
import { colors, fonts } from '@/lib/responsive'

export const GlobalStyle = createGlobalStyle`
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  html,
  body {
    min-height: 100dvh;
  }

  body {
    background: ${colors.background};
    color: ${colors.foreground};
    font-family: ${fonts.sans};
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  a {
    color: inherit;
    text-decoration: none;
  }

  button {
    font-family: inherit;
  }
`
