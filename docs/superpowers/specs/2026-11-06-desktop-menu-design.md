# Desktop menu collapse

Approved behavior: a hamburger button at the top of the left sidebar collapses its content and expands the content area. A 56px sidebar rail keeps the same button visible in the same position so clicking again restores the sidebar. The sidebar starts expanded; the preference lasts while AppShell stays mounted. Mobile retains its existing drawer behavior.

Implementation: local React state in AppShell, an accessible desktop-only button in the sidebar header with aria-expanded and aria-controls targeting the menu content, and CSS at the existing 1024px breakpoint. The collapsed sidebar hides the brand and menu links, leaving the button visible. Hidden sidebar links must leave the keyboard tab order. No dependencies or persistence are required.

Validation: web typecheck, targeted ESLint, and existing web tests. Check the diff for unrelated changes.
