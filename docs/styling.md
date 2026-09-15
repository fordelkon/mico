# Styling Principles

Use these rules when changing CSS, component styling, or themes. Keep visual decisions at the narrowest owner that can express them; preserve existing public styling contracts unless the task intentionally changes them.

## Separate Theme Values from Component Behavior

- Components consume semantic roles such as surface, foreground, border, and selected state. Choose tokens by meaning, not by whichever current color looks closest; brand, primary action, and selection are not interchangeable.
- Theme presets supply values for those roles. Keep preset-specific selectors and palette values at the theme boundary, rather than adding preset branches to individual components.
- A palette change belongs in the preset; a shared semantic default belongs in the shared theme; a product-specific visual relationship belongs in the renderer. A layout or interaction change belongs to its component, even when discovered while adjusting a theme.
- Derive product colors and effects from existing semantic tokens where that relationship is intentional. Add explicit appearance or preset overrides only when the derived result does not satisfy the intended design.
- Use the application's resolved appearance state. Components should not independently infer light/dark mode or select a preset. Keep application colors distinct from syntax-highlighting theme choices.

The shared contract lives in [the UI theme](../packages/ui/src/styles/theme.css); product derivations live in [the renderer theme](../src/renderer/src/assets/theme.css); palette overrides live in [theme presets](../src/renderer/src/assets/theme-presets.css).

## Give Every Token a Purpose and an Owner

- Reuse existing tokens and primitive defaults before introducing new ones. Add a token for a distinct semantic role, deliberate theme variation, or a relationship shared by consumers; repeated literals alone do not establish a design concept.
- Keep component-local measurements and effects local. Promote a token to the product or shared theme only when its consumers and meaning justify that scope. Shared primitives must not acquire new dependencies on renderer-only tokens.
- Name tokens by role or state, not palette values. Preserve exported tokens and their meaning; renaming or repurposing one requires checking its consumers, presets, and standalone UI rendering.
- Prefer established spacing, radius, typography, and shadow scales. Use a local value when a concrete layout or platform requirement needs it; do not create a global token for every dimension.
- Keep raw palette colors at the theme boundary. Fixed colors may express theme-independent content, platform conventions, previews, or mask geometry; keep those exceptions local and explain non-obvious intent.
- Expose a token through Tailwind only when utility consumers need it. Use ordinary CSS custom properties for other values, and `@theme inline` for utility mappings that reference runtime variables. See [Tailwind theme variables](https://tailwindcss.com/docs/theme#referencing-other-variables).

## Choose Styling by Scope

- Start with components exported by `@mico/ui` and their existing variants. Extend a reusable primitive at its owner when the missing behavior belongs to that primitive; keep product compositions in the renderer.
- Use Tailwind for one-off layout and styling on an element, including simple local states. Use nearby product CSS for coordinated parent/child states, platform relationships, pseudo-elements, animations, and complex selectors.
- Keep application-wide CSS for application-wide behavior. A feature's selectors belong with that feature, not in a global stylesheet merely for convenience.
- Use inline styles for runtime values that cannot be expressed as static classes, such as measured dimensions or user-provided values. Keep static design decisions in utilities or CSS.
- Match the surrounding convention. Moving existing CSS into utilities, or the reverse, needs a task-related benefit; stylistic uniformity alone does not justify a rewrite.

## Keep Overrides Predictable

- Inspect inheritance, primitive defaults, and the winning declaration before adding an override. Fix the owning rule when possible; remove redundant utilities, props, and no-op class merges introduced or made obsolete by the change.
- Scope selectors to the owning component or product region. Prefer intentional classes, state attributes, and supported slots over incidental DOM structure. Keep unavoidable third-party structure dependencies narrow and explain why they exist.
- Reuse existing state attributes and accessible state semantics. Keep coordinated state rules together rather than scattering equivalent conditions across descendants.
- Preserve the intended theme cascade: shared defaults, product derivations, then preset overrides. Account for selector specificity and variable scope as well as import order; verify resolved values when changing these relationships.
- Use `!important` only for a concrete constraint that ordinary ownership or cascade changes cannot resolve. Scope it narrowly and document the reason; do not stack stronger selectors to compensate for an unclear owner.

## Preserve Interaction and Accessibility

- Keep hover, focus, active, selected, and disabled states distinguishable. Hover-revealed actions must remain keyboard-accessible, and decorative layers must not intercept input.
- Preserve foreground/background contrast across supported appearances and affected presets. Verify actual combinations, including muted text, borders, destructive actions, and overlays.
- Keep scroll and overflow ownership explicit. Allow flex/grid children to shrink where needed; contain wide content at its intended viewport rather than hiding application overflow to conceal a layout defect.
- Animate only the properties needed for the effect. For added or changed motion, provide reduced-motion behavior that preserves state and usability. Keep platform drag regions separate from interactive controls.

## Verify the Changed Contract

Apply the [repository verification requirements](../CLAUDE.md#verification). Inspect the affected interface in the running application: relevant appearances and presets, interaction states, resizing, and reduced motion. For shared changes, also check standalone UI rendering so renderer overrides do not hide missing defaults. Report which cases were inspected and any gaps; do not treat existing CSS as proof that every rule is already satisfied.
