---
name: build-session-tunebook
description: Design or build an Irish traditional music tunebook using the Session design system. Use for tune libraries, score readers, ABC editing, sets, session views, print layouts, and related shadcn/ui interfaces when the user invokes this skill or asks to continue this tunebook project.
---

# Build Session Tunebook

Use the [design specification](references/design-system.md) as the source of visual and interaction rules. Open the [HTML specimen](assets/session-tunebook-design-system.html) when visual context helps; it is an illustrative reference, not application code or a notation renderer.

## Workflow

1. Inspect the existing project and its design conventions before editing. Preserve its framework, installed shadcn implementation family, build tooling, and working features.
2. Identify the requested surface: library, tune sheet, ABC editor, set builder, session mode, or print view. Apply only the relevant rules in the reference.
3. Use shadcn/ui primitives for controls and accessibility behavior. Compose tune-specific components above them. Check current official documentation if implementation details or APIs matter.
4. Keep the tune readable first. Make editing explicit. Use actual notation rendering from source music data; never ship the specimen's illustrative music glyphs as a score.
5. Check keyboard behavior, responsive reading width, 200% zoom, and print output for the surfaces touched. Validate the app with its existing build or relevant tests.

## Product invariants

- Keep the interface nearly monochrome with warm neutrals and restrained borders. Use semantic shadcn tokens, not scattered color literals.
- Give notation a centered 720–880 px reading column at normal desktop widths. Let the user scale the score; do not shrink staves until they are illegible.
- Model tune titles and aliases, type, key, meter, source, attribution uncertainty, variations, and set membership without flattening distinct facts into tags.
- Permit partial tune capture and preserve draft ABC, scroll position, and the user's selected view during editing.
- Offer rendered score, ABC, and split view where appropriate. Print black on white without app chrome.
- Label icon buttons, expose visible focus, provide non-drag controls for tune order, and avoid color-only states.

The user can change these defaults. Treat the reference as a coherent starting point, not a reason to override explicit requests.
