# 0053: Accept an Invite with Google or GitHub

Spec: 0013
Status: ready-for-agent

**What to build:** An invited person accepts an Invite with Google or GitHub. The new User has that one Login method, no password, its email taken from the provider's verified address, and is logged in.

**Blocked by:** 0051

- [ ] When a provider is configured, the Invite accept page offers its buttons and no password form; with none configured, password Invites work as before
- [ ] `passwordHash` becomes optional; a User without one can't log in with a password
- [ ] The atomic Invite accept from spec 0008 runs in the callback (`intent=invite:<code>`); a used or revoked Invite is refused
- [ ] A provider account already connected to a User is refused
- [ ] Tests: Invite via Google → User with one Login method and no password, logged in, logs out and back in with Google; no provider configured → password Invite as before
