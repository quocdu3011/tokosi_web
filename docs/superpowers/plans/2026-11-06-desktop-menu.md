# Desktop Menu Implementation Plan

**Goal:** Allow desktop users to hide and restore the left sidebar.

**Architecture:** AppShell owns a sidebarOpen boolean, separate from mobileOpen. A button in the sidebar header toggles the boolean; CSS shrinks the sidebar to a 56px rail and lets the existing flex content expand. The button stays in place when collapsed.

**Tech Stack:** React, Next.js, CSS, existing Button and Menu icon.

## Constraints

- Preserve the existing 1024px desktop breakpoint and mobile drawer.
- Start expanded; do not persist the preference.
- Keep the restore button accessible when the sidebar is hidden.

## Task 1: Desktop sidebar toggle

- [x] Read AppShell, layout CSS, and installed Next.js client component guidance.
- [x] Add `const [sidebarOpen, setSidebarOpen] = useState(true)` in AppShell.
- [x] Add the `desktop-sidebar` ID and `data-collapsed={!sidebarOpen}` to the sidebar.
- [x] Add a desktop-only sidebar header button using `onClick={() => setSidebarOpen((open) => !open)}`, `aria-expanded={sidebarOpen}`, and `aria-controls="desktop-sidebar-content"`.
- [x] Hide the menu content with `hidden={!sidebarOpen}` so its links leave the tab order. Shrink the desktop sidebar to 56px, hide the brand, and retain the button. Show the desktop button only at min-width 1024px.
- [x] Run web typecheck, targeted ESLint, and existing web tests; inspect the final diff. Typecheck and ESLint passed; all 92 tests passed. Prettier and git diff --check also passed. Interactive browser verification was not performed.
