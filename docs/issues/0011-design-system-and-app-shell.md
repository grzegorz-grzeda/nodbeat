# 0011: Design system and app shell

Spec: 0002
Status: ready-for-agent

**What to build:** Every page uses one static, token-based stylesheet, a nav bar for logged-in Users, and a footer with the running version. No inline scripts or styles; a strict CSP.

**Blocked by:** 0010 (version info for the footer).

- [ ] CSS served from `/assets/app.css?v=<commit>`; tokens as CSS custom properties, light and dark sets (dark via `data-theme="dark"` and `data-theme="system"` + `prefers-color-scheme`)
- [ ] System font stack, one accent color, state colors for Up/Down/New/Paused, WCAG AA contrast in both themes, visible focus
- [ ] Inline-SVG ECG-line logo and favicon
- [ ] Nav: Dashboard, New Monitor, Settings, email, Log out; collapses on a phone
- [ ] Footer: `vX.Y.Z · <short commit>` linking to the GitHub release
- [ ] Dashboard poll script moved to `/assets/dashboard.js`
- [ ] `Content-Security-Policy: default-src 'self'` on HTML responses
- [ ] Existing pages (login, Dashboard, Monitor, new/edit Monitor, Settings) restyled on the new shell
- [ ] Tests: CSP header present, no inline `<script>`/`<style>`, assets served with long cache
