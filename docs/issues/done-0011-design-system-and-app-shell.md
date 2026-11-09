# 0011: Design system and app shell

Spec: 0002
Status: done

**What to build:** Every page uses one static, token-based stylesheet, a nav bar for logged-in Users, and a footer with the running version. No inline scripts or styles; a strict CSP.

**Blocked by:** 0010 (version info for the footer).

- [x] CSS served from `/assets/app.css?v=<commit>`; tokens as CSS custom properties, light and dark sets (dark via `data-theme="dark"` and `data-theme="system"` + `prefers-color-scheme`)
- [x] System font stack, one accent color, state colors for Up/Down/New/Paused, WCAG AA contrast in both themes, visible focus
- [x] Inline-SVG ECG-line logo and favicon
- [x] Nav: Dashboard, New Monitor, Settings, email, Log out; collapses on a phone
- [x] Footer: `vX.Y.Z · <short commit>` linking to the GitHub release
- [x] Dashboard poll script moved to `/assets/dashboard.js`
- [x] `Content-Security-Policy: default-src 'self'` on HTML responses
- [x] Existing pages (login, Dashboard, Monitor, new/edit Monitor, Settings) restyled on the new shell
- [x] Tests: CSP header present, no inline `<script>`/`<style>`, assets served with long cache
