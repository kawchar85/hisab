# Hisab Plan

## Product rules

- Private 5-person mess app, deployable on Firebase Spark plan.
- Google sign-in only.
- One-time nickname claiming.
- `kawsarhn1@gmail.com` is Admin.
- Home always shows the current calendar month.
- Every month is preserved independently.
- New months start open; Admin can finalize/reopen any month.
- Finalized months are read-only for expenses and meal changes.

## Meals

- Sunday–Thursday default: 1.
- Friday–Saturday default: 2.
- UI always displays absolute meal counts, never deltas.
- A member can set their own absolute count for any date in an open month.
- Setting a date back to its default removes the override.
- Any active member can mark a date `Mess Off` for everyone.
- `Mess Off` makes the effective count 0 for every member but preserves personal overrides underneath, so they return if Mess Off is cancelled.

## Expenses

- Types: Bazar and Utility.
- No category field in v2 UI.
- Form: Date, Amount, Note (optional).
- Everyone can see all transactions.
- Members can edit/delete only their own transactions in an open month.
- Admin can correct any transaction, but a closed month must be reopened first.

## Settlement

- Rent is snapshotted into each month so later rent changes do not rewrite history.
- Meal cost is proportional to final monthly meal counts.
- Utilities are split equally among members in that month.
- Internal calculations are unrounded so the total settlement remains equal to total rent.
- Historical months remain selectable.
- Meal-rate and utility-total trend charts appear after at least two months exist.

## Members

- Admin can add a member, rename a nickname, change configured rent, remove/restore a member, and unclaim a Google account.
- Remove means archive/inactivate; member documents are never hard-deleted, preserving historical data.
- Added/removed members affect future month snapshots. Existing month membership is not silently rewritten.

## Firestore collections

- `system`
- `users`
- `members`
- `claimSlots`
- `months`
- `expenses`
- `mealOverrides`
- `mealDays`
