# Mess Manager

A private, installable Firebase PWA for shared mess accounting.

## Included

- Google sign-in and one-time nickname claiming
- Admin: `kawsarhn1@gmail.com`
- Monthly history from September 2026 onward
- Bazar and Utility transactions
- Absolute meal counts per date
- Default meals: Sun–Thu 1, Fri–Sat 2
- Global `Mess Off` day, available to every active member
- Monthly settlement and historical month selection
- Admin month finalization/reopen
- Admin add/rename/remove/restore members and rent configuration
- Firestore Security Rules enforcing ownership and month locks
- PWA manifest/service worker
- Trend charts once 2+ months exist

## Deploy updates

From this folder, with Firebase CLI logged in and `mess-manager-web` selected:

```bash
firebase deploy --only firestore,hosting
```

Production URL:

```text
https://mess-manager-web.web.app
```

After a frontend update, refresh the installed/open app once so the new service worker takes control. If an old screen remains cached, close/reopen the PWA or hard-refresh the browser.

## Data model notes

New meal edits are absolute overrides stored in `mealOverrides`. Existing legacy `mealAdjustments` are still read so old data is not lost. A global off day is stored once in `mealDays`; it overrides effective meal counts without deleting personal settings.

Removing a member archives them for future months rather than deleting historical identity. Rent and active members are snapshotted when each month is created.

## Tests

```bash
node --test tests/calculations.test.mjs
```
