# nexo

Personal single-user iOS app. A shell that hosts independent modules over a shared core.

Not distributed. No App Store, no accounts, no multi-user.

## Modules

| Module | What it covers | Status |
|---|---|---|
| Training | Gyms, routines, sessions, sets, volume and strength progression | Implemented |
| Nutrition | Foods, batch cooking, pantry and recipes, daily targets, water, discipline score | Implemented |
| Deals | Read-only aggregation of Canadian grocery and retail deals, with deep links out | Implemented (Flipp) |
| Transit | Saved places, LTC schedules/live data, personal itineraries, trip guidance and reviewed walks | Implemented; active-trip iPhone validation pending |
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

For a closer look at native behaviour, `npm run android` builds a development client and runs it on an Android emulator. Android is for preview only: it does not draw iOS Liquid Glass, and Transit's map needs a Google Maps key that the iPhone build does not use.

| Script | What it does |
|---|---|
| `npm run web` | Dev server in the browser |
| `npm run android` | Development build on an Android emulator |
| `npm start` | Dev server with every target offered |
| `npm run lint` | ESLint, using the Expo config |
| `npm run format` | Prettier over the source, markdown excluded |
| `npm run format:check` | The same check, read only |

## Repository layout

```
.claude/          Claude Code config
  hooks/          PreToolUse guard that blocks secrets from reaching disk or git
  skills/         Agent skills: design review, emulator and simulator driving
.githooks/        commit-msg hook that strips tool attribution
.impeccable/      Machine-readable companion to DESIGN.md
assets/           App icon, splash and favicon
audit/            Past audits of the app
deals/            Flipp snapshot the app reads, refreshed daily by a workflow
docs/             Notes behind larger changes (redesigns, Transit, the assistant)
scripts/          Repo maintenance, deal fetching and Transit schedule preparation
src/              App source: core, db, shell, ui and one folder per module
transit/          Published Transit schedule and its manifest
transit-live/     Serverless function for Transit live data
App.tsx           Navigation and the app shell
index.ts          Entry point
app.json          Expo app config
CLAUDE.md         Working conventions for this repo
DECISIONS.md      Architectural decisions, one entry each
DESIGN.md         The visual system: colours, type, shapes, components
README.md         This file
```

`SPEC.md`, `PRODUCT.md`, `docs/transit-plan.md` and `docs/critique.md` stay local and gitignored because they hold personal data.

## Secrets

Credentials for the Deals sources live in environment variables on the ingestion server. They never enter this repository, the app bundle, or a test fixture.

`.claude/hooks/block-secrets.py` runs before every write, edit and shell command and denies anything touching credential files, certificates, database dumps or known token formats. Run its test suite with:

```
python3 .claude/hooks/block-secrets.test.py
```

