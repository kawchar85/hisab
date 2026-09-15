# Hisab

A lightweight, installable Firebase PWA for shared mess accounting — meals, bazar, utilities, rent, and monthly settlement.

Hisab is designed for a small shared household or mess where members need a simple way to track daily meals, shared expenses, rent, utilities, and the final monthly balance.

## Features

- Google sign-in
- One-time nickname claiming for members
- Monthly meal tracking with absolute meal counts
- Configurable default meals by weekday
- Global **Mess Off** for dates when meals are disabled for everyone
- Bazar and Utility expense tracking
- Shared expense history with personal ownership
- Monthly settlement with Pay / Receive balances
- Historical month selection
- Admin month finalization and reopening
- Admin member, nickname, rent, and account-management controls
- Rent and active-member snapshots so old months remain unchanged
- Meal-rate and utility trend charts after multiple months exist
- Installable PWA with service-worker caching
- Firestore Security Rules for ownership, admin access, and month locks

## Accounting model

For each month:

```text
Meal Rate = Total Bazar / Total Meals

Food Cost = Member Meals × Meal Rate

Utility Share = Total Utility / Active Members

Final Balance =
  Rent
  + Food Cost
  + Utility Share
  - Bazar Paid
  - Utility Paid
```

A positive final balance means the member needs to **Pay** that amount. A negative final balance means the member should **Receive** the absolute amount.

Because the total food cost equals the total bazar spend and utility shares equal the total utility spend, the sum of all member balances remains equal to the total rent for the month.

## Meal model

The default configuration is:

```text
Sunday–Thursday: 1 meal
Friday–Saturday: 2 meals
```

The UI always shows absolute meal counts, never adjustment deltas.

A member can set a personal meal count for any date in an open month. If the value is changed back to that date's default, the personal override is removed.

A global **Mess Off** day sets the effective meal count to `0` for every member. Personal overrides are preserved underneath, so they become active again if Mess Off is cancelled.

Historical `mealAdjustments` records are still readable for backward compatibility. New meal changes are stored as absolute `mealOverrides`.

## Monthly lifecycle

Each month is stored independently.

```text
New month
   ↓
Open
   ↓
Members can edit expenses and meals
   ↓
Admin finalizes the month
   ↓
Read-only
```

An admin can reopen a finalized month when a correction is required.

Rent and active members are snapshotted when a month is created. Later changes to rent or membership do not silently rewrite historical settlements.

Removing a member archives them instead of deleting their identity, preserving historical records.

## Architecture

Hisab has no custom application server.

```text
Browser / Installed PWA
        ↓
Firebase Hosting
        ↓
Firebase Authentication + Cloud Firestore
```

- **Frontend:** HTML, CSS, and JavaScript
- **Hosting:** Firebase Hosting
- **Authentication:** Firebase Authentication with Google Sign-In
- **Database:** Cloud Firestore
- **Authorization:** Firestore Security Rules
- **PWA:** Web App Manifest + Service Worker

Firebase configuration is loaded automatically from Firebase Hosting through `/__/firebase/init.json`, so a copied `firebaseConfig` object is not required in the source code.

## Project structure

```text
.
├── public/
│   ├── app.js                  # Application controller
│   ├── index.html              # App shell
│   ├── styles.css              # UI styles
│   ├── manifest.webmanifest    # PWA manifest
│   ├── service-worker.js       # PWA caching
│   ├── icons/
│   └── js/                     # Data, calculations, UI and Firebase modules
├── tests/
│   └── calculations.test.mjs   # Accounting/meal calculation tests
├── firestore.rules             # Firestore authorization rules
├── firestore.indexes.json      # Firestore indexes
├── firebase.json               # Firebase Hosting/Firestore configuration
├── .firebaserc                 # Local Firebase project mapping
├── PLAN.md                     # Product rules and data-model notes
└── README.md
```

See [`PLAN.md`](PLAN.md) for the detailed product rules and Firestore collection model.

## Firebase setup

### 1. Create a Firebase project

Create a project in the Firebase Console and note its **Project ID**.

Register a **Web app** inside the project. You do not need to copy the generated `firebaseConfig` object into this repository.

### 2. Enable Google Sign-In

In Firebase Console:

```text
Authentication
→ Sign-in method
→ Google
→ Enable
```

Set the project's public-facing name and support email as appropriate for your deployment.

### 3. Create Firestore

Create a **Cloud Firestore Standard edition** database.

Use **production mode** because this repository includes its own Firestore Security Rules.

Choose a database region close to the expected users.

### 4. Configure the app

Before the first deployment, review:

```text
public/js/constants.js
```

Configure:

- `ADMIN_EMAIL`
- `TIME_ZONE`
- `INITIAL_MEMBERS`
- each member's initial rent and role
- `DEFAULT_MEALS`

The admin identity is also enforced by `firestore.rules`. Update the `bootstrapAdmin()` email there to match `ADMIN_EMAIL`.

The admin member ID used in the `/users/{uid}` creation rule must also match the admin member ID configured in `INITIAL_MEMBERS`.

Keep the frontend configuration and Firestore rules consistent before deploying.

## Install Firebase CLI

Install Node.js first, then:

```bash
npm install -g firebase-tools
```

Authenticate:

```bash
firebase login
```

Associate the local repository with your Firebase project:

```bash
firebase use --add
```

Select your project and give it an alias such as `default`.

Verify before deploying:

```bash
firebase use
```

## Deploy

Deploy the frontend, Firestore rules, and indexes:

```bash
firebase deploy --only firestore,hosting
```

The default Firebase Hosting URL is:

```text
https://{firebase-project-id}.web.app
```

For frontend-only changes:

```bash
firebase deploy --only hosting
```

After a frontend deployment, an already-open or installed PWA may briefly use the previous service-worker cache. Close and reopen the app, hard-refresh the browser, or clear the site's cached data if an older version remains visible.

## Firestore data model

The main collections are:

```text
system
users
members
claimSlots
months
expenses
mealOverrides
mealDays
mealAdjustments   # legacy compatibility
```

Important behavior:

- `members` stores the current member configuration.
- `months` stores the member/rent snapshot used for each month's settlement.
- `expenses` stores Bazar and Utility transactions.
- `mealOverrides` stores absolute per-member meal values for specific dates.
- `mealDays` stores global date-level state such as Mess Off.
- `claimSlots` maps one-time member nickname claims to authenticated accounts.

## Security model

The frontend is not treated as the security boundary. Firestore Security Rules enforce the important permissions.

At a high level:

- users authenticate with Google
- members can read the shared mess data required by the app
- members can create and modify their own expenses while a month is open
- members can modify their own meal counts while a month is open
- active members can toggle Mess Off
- admin operations are protected separately
- finalized months prevent normal expense and meal changes
- member documents are archived instead of hard-deleted

Any permission change should be reviewed in both the frontend and `firestore.rules`.

## Tests

Run the calculation tests with Node.js:

```bash
node --test tests/calculations.test.mjs
```

Run the tests after changing settlement, meal, rent, or utility logic.

## Contributing

Bug reports, fixes, and improvements are welcome.

A simple contribution workflow:

```bash
git checkout -b fix/short-description
# make changes
node --test tests/calculations.test.mjs
git add .
git commit -m "Fix short description"
git push -u origin fix/short-description
```

Then open a pull request against `main`.

For bugs, open a GitHub Issue with the steps to reproduce, expected behavior, actual behavior, browser/device information, and screenshots when useful.
