# 0056: Terms and Privacy pages

Spec: 0014
Status: ready-for-agent

**What to build:** Public `/terms` and `/privacy` pages rendered from owner-written Markdown files in the repo, linked from the footer of every page.

**Blocked by:** None (can start immediately).

- [ ] `legal/terms.md` and `legal/privacy.md` with front-matter `version` (date) and `summary`, rendered at startup by a small renderer (headings, paragraphs, lists, links only)
- [ ] Footer of every page links to both when present
- [ ] Files missing → both pages `404` and no footer links
- [ ] Placeholder legal files committed so the pages exist; the real text is the owner's job
- [ ] Tests: pages render, footer links, missing files → `404`
