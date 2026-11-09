# 0021: Password change and Log out everywhere

Spec: 0004
Status: ready-for-agent

**What to build:** On Settings a User can change their password, which ends every other session, and can log out everywhere, which ends every session including the current one.

**Blocked by:** 0020 (a wrong current password counts as a failed login).

- [ ] "Password" section on Settings: current password, new password, confirmation; CSRF-protected POST
- [ ] New password follows the `createUser` rules; mismatched confirmation is an error
- [ ] A wrong current password is an error and counts as a failed login against both limits
- [ ] On success: hash replaced, every other session of the User deleted, current session kept, flash "Password changed."
- [ ] "Log out everywhere" button: deletes every session of the User and redirects to `/login`
- [ ] Tests through the HTTP seam: after a password change the old password fails, the new one works, a second session is logged out and the current one isn't; after "Log out everywhere" both sessions are logged out
