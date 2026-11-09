# 0017: API docs links

Spec: 0003
Status: done

**What to build:** The Monitor page and the footer of every page link to the API docs, so a User finds the full Heartbeat URL reference when the curl examples aren't enough. Links never carry a Monitor's token.

**Blocked by:** 0016 (the page), 0011 (the footer).

- [x] "API docs" link to `/docs` next to the curl examples on the Monitor page
- [x] "API docs" link to `/docs` in the footer
- [x] No token in any link to the docs
- [x] Tests through the HTTP seam (`Browser`): the Monitor page links to `/docs` with no token in the link; the footer has the link
