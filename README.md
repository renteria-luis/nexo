# nexo

Personal single-user iOS app. A shell that hosts independent modules over a shared core.

Not distributed. No App Store, no accounts, no multi-user.

## Modules

| Module | What it covers | Status |
|---|---|---|
| Training | Gyms, routines, sessions, sets, volume and strength progression | Planned |
| Nutrition | Foods, batch cooking, daily targets, water, discipline score | Planned |
| Deals | Read-only aggregation of Canadian grocery and retail deals, with deep links out | Planned |
| Finance | Expenses, income, subscriptions, budgets | Later |

Each module is a self-contained vertical: its own tables, its own navigation slot, its own feature flag. Turning one off leaves the rest working. No module imports another module's internals; cross-module data moves through a declared read interface.

## Shared core

Design system and colour palettes, a generic weighted scoring engine, the heatmap grid, streaks, rolling date and week handling, units and money, local notifications, and the local-first storage layer. A component moves into the core when a second module needs it, not before.

## Stack

- Expo / React Native / TypeScript
- SQLite on device, local-first. The phone is the system of record.
- A separate Node ingestion service for the Deals module only: scheduled fetchers, a normaliser, and a read-only REST API. It holds no personal data.
- Builds are produced on GitHub Actions macOS runners and sideloaded.

## Running it locally

Requires Node 20 or newer. Development happens on Linux; the browser is the day to day target.

```
npm install
npm run web
```

That serves the app at `http://localhost:8081`. `npm install` also points git at `.githooks` through a postinstall script, because `core.hooksPath` lives in `.git/config` and is not versioned.

| Script | What it does |
|---|---|
| `npm run web` | Dev server in the browser |
| `npm start` | Dev server with every target offered |
| `npm run lint` | ESLint, using the Expo config |
| `npm run format` | Prettier over the source, markdown excluded |
| `npm run format:check` | The same check, read only |

## Repository layout

```
.claude/          Claude Code config
  hooks/          PreToolUse guard that blocks secrets from reaching disk or git
.githooks/        commit-msg hook that strips tool attribution
assets/           App icon, splash and favicon
scripts/          Repo maintenance run by npm lifecycle hooks
App.tsx           The one screen that exists so far
index.ts          Entry point
app.json          Expo app config
CLAUDE.md         Working conventions for this repo
DECISIONS.md      Architectural decisions, one entry each
README.md         This file
```

Module source, database migrations and the Deals ingestion service are added as the modules are built.

## Secrets

Credentials for the Deals sources live in environment variables on the ingestion server. They never enter this repository, the app bundle, or a test fixture.

`.claude/hooks/block-secrets.py` runs before every write, edit and shell command and denies anything touching credential files, certificates, database dumps or known token formats. Run its test suite with:

```
python3 .claude/hooks/block-secrets.test.py
```

The functional specification is kept out of this repository because it contains personal data.
