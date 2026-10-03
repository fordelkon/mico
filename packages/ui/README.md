# @mico/ui

`@mico/ui` is Mico's reusable React component library. It is built on top of
[shadcn/ui](https://ui.shadcn.com/) conventions and Radix UI primitives, with
Tailwind CSS v4 for styling.

The components are owned by this repository, so they can be composed and
adapted to Mico's product needs while keeping a consistent visual language.
The library currently focuses on accessible, composable primitives and small
composite components that are shared across the application.

## Features

- shadcn/ui-based component structure and CSS variable theme
- Radix UI primitives for accessible interactions and behavior
- Tailwind CSS v4 utilities and `tw-animate-css` animations
- Light and dark themes through the `.dark` class
- TypeScript source with Storybook stories and Vitest tests
- Composable APIs with `className`, standard React props, and `asChild` where supported

## Usage

`@mico/ui` is a private workspace package and is consumed by Mico through the
`workspace:*` dependency. Import the shared theme once from the application's
stylesheet:

```css
@import '@mico/ui/styles/theme.css';
```

Then import components from the package entry point:

```tsx
import { Button, IconTooltipButton } from '@mico/ui'
import { PlusIcon } from 'lucide-react'

export function Example() {
  return (
    <div className="flex items-center gap-2">
      <Button>Continue</Button>
      <IconTooltipButton icon={<PlusIcon />} label="Add item" />
    </div>
  )
}
```

For a narrower import, use a component's subpath:

```tsx
import { Button } from '@mico/ui/components/primitives/button'
```

Components use semantic theme utilities such as `bg-primary`,
`text-foreground`, and `border-border`. To enable dark mode, add the `dark`
class to an ancestor of the components, normally the document root.

## Components

### Primitives

#### Chat and content

- `Attachment` — file and media attachment layout with states, orientations, actions, and triggers
- `Bubble` — aligned message bubbles with visual variants, delegated content, and reactions
- `Empty` — structured empty-state layout with media, description, and optional action content
- `Marker` — conversation markers with icons, content, separators, and borders
- `Message` — message layout with grouping, alignment, avatars, headers, content, and footers
- `MessageScroller` — anchored conversation scrolling with auto-follow, turn anchors, jump controls, visibility state, and imperative scrolling hooks

#### Forms and feedback

- `InputGroup` — composes inputs with inline or block-aligned controls, text, and actions

- `Kbd` — semantic keyboard-key and shortcut display primitives
- `AlertDialog` — accessible confirmation dialog for destructive or irreversible actions
- `Button` — button variants, sizes, and `asChild` support
- `Input` — styled single-line text input with validation and disabled states
- `Skeleton` — animated loading placeholder
- `Spinner` — accessible indeterminate loading indicator
- `Textarea` — styled multiline text input with validation and disabled states
- `Tooltip` — accessible tooltip provider, trigger, and content primitives

#### Navigation and layout

- `Command` — searchable command palette with keyboard navigation, groups, and dialog presentation
- `Dialog` — accessible modal dialog primitives with configurable content and close controls

- `ContextMenu` — pointer-positioned context actions with keyboard and long-press support
- `DropdownMenu` — menu, checkbox, radio, separator, shortcut, and submenu primitives
- `Separator` — horizontal or vertical visual separator
- `Sheet` — accessible edge-aligned overlay panel primitives
- `Sidebar` — composable, responsive, resizable, and collapsible sidebar primitives

- `Popover` — anchored, portal-rendered content with controlled and uncontrolled open state

### Composites

- `IconSwap` — a decorative two-icon fade-and-scale transition
- `IconMenuButton` — an accessible icon button that opens a dropdown menu
- `IconTooltipButton` — an accessible icon button with a tooltip
- `RadioSelect` — a controlled single-value selection menu with optional `side`, `align`, and `sideOffset` positioning; collision handling keeps the menu within the viewport
- `SearchPopover` — a searchable popover shell where callers filter and render results
- `Toggle` — an accessible controlled switch with a double-bounce thumb transition

Every component listed above is re-exported from `@mico/ui`. Primitive subpath
imports remain available for consumers that need a narrower dependency surface.

## Project Structure

```text
src/
├── __tests__/              # Contract tests, mirroring component ownership
├── components/
│   ├── primitives/     # shadcn/ui-style building blocks
│   └── composites/     # Reusable combinations of primitives
├── hooks/              # Shared React hooks used by components
├── lib/                # Shared component utilities
├── styles/             # Theme and CSS variable definitions
└── index.ts            # Public package entry point
stories/                # Storybook stories and usage examples
test/                   # Shared test setup
```

Place package tests beneath `src/__tests__/` and mirror the source ownership
path there. For example, a primitive belongs in
`src/__tests__/components/primitives/`, while a composite belongs in
`src/__tests__/components/composites/`. Do not add flat test files directly
under the package test root.

## Development

Run these commands from the repository root:

```bash
# Start Storybook
pnpm --filter @mico/ui storybook

# Run the component tests
pnpm --filter @mico/ui test

# Type check the package and its Storybook configuration
pnpm --filter @mico/ui typecheck

# Build the static Storybook site
pnpm --filter @mico/ui build:storybook
```

When adding a component, keep the source in `src/components`, follow the
existing shadcn/ui composition patterns, add a Storybook story for its
observable states, and add tests for meaningful interaction behavior.
