<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

### Styled Components Pattern

Every component file declares ONE styled component at the top with a `Styled` suffix:

```tsx
const MyComponentStyled = styled.div`
  .my-component {
    display: flex;
    gap: 16px;
  }

  .my-component__title {
    font-size: ${theme.fontSize.lg};
    color: ${theme.colors.foreground};
  }

  .my-component__title--active {
    color: ${theme.colors.primary};
  }

  .my-component__icon {
    width: 20px;
    height: 20px;
  }
`;
```

Use BEM naming:
- Block: `.my-component`
- Element: `.my-component__title`
- Modifier: `.my-component__title--active`

### Component Architecture

**Server Components (default):**
- Use for data fetching, auth checks, and layout structure
- Example: `page.tsx`, `layout.tsx`

**Client Components:**
- Mark with `'use client'` at the top
- Use for interactive UI, styled-components, hooks
- Example: `HomePageContent.tsx`, `SidebarClient.tsx`

### Design Tokens

All design tokens live in `app/lib/responsive.ts`. Import them in styled-components:

```ts
import { colors, fonts, fontWeight, fontSize, borderRadius, sectionPadding, sectionGap, breakpoints } from "@/lib/responsive";
```

