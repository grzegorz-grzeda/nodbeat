# 0056: Terms and Privacy pages

Spec: 0014
Status: ready-for-agent

**What to build:** Public `/terms` and `/privacy` pages rendered from Markdown files the Operator keeps in `LEGAL_DIR` on their own server (not in the repo or the image), linked from the footer of every page, with the Operator's details in the footer.

**Blocked by:** None (can start immediately).

- [ ] `LEGAL_DIR` env var, optional; it holds `terms.md`, `privacy.md` (front-matter `version` (date) and `summary`) and `operator.md` (name, NIP, address, contact email)
- [ ] Rendered at startup by a small renderer (headings, paragraphs, lists, links only)
- [ ] Footer of every page links to both and names the Operator; `/terms` starts with the Operator's details
- [ ] `LEGAL_DIR` unset or files missing → both pages `404`, no footer links, no Operator shown
- [ ] No legal text in the repo or the Docker image; tests use fixture files; `docs/deploy.md` says how to mount the directory
- [ ] Tests: pages render, footer links and Operator, `LEGAL_DIR` unset → `404`
