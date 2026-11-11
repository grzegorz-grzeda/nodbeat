# 0020: Count failed logins, per IP and per email

Spec: 0004
Status: done

**What to build:** Only failed logins count towards the login limit. Besides 5 per 15 min per IP, failed logins are limited to 10 per hour per email, so guessing one User's password from many IPs is slow.

**Blocked by:** none.

- [x] A successful login doesn't use up an attempt
- [x] 5 failures per 15 min per IP, 10 failures per hour per normalised email; either answers `429` with the existing message
- [x] Unknown emails are limited the same way (no enumeration through the limiter)
- [x] Tests through the HTTP seam: 6 successful logins in a row work; the 6th failure from one IP gets `429`; 11 failures for one email from different IPs get `429`; the limits lift after their windows
