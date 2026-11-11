# 0036: Feedback link

Spec: 0006
Status: done

**What to build:** Every page's footer gets a "Feedback" link to `https://github.com/grzegorz-grzeda/nodbeat/issues`, next to the version link.

**Blocked by:** none.

- [x] Link in the shared footer in `src/layout.ts`, logged in and out
- [x] Tests through the HTTP seam: the landing page, the Dashboard and an error page all contain the link
