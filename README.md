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

## Repository layout

```
.claude/          Claude Code config
  hooks/          PreToolUse guard that blocks secrets from reaching disk or git
CLAUDE.md         Working conventions for this repo
DECISIONS.md      Architectural decisions, one entry each
README.md         This file
```

Application source, database migrations and the ingestion service are added as the modules are built.

## Secrets

Credentials for the Deals sources live in environment variables on the ingestion server. They never enter this repository, the app bundle, or a test fixture.

`.claude/hooks/block-secrets.py` runs before every write, edit and shell command and denies anything touching credential files, certificates, database dumps or known token formats. Run its test suite with:

```
python3 .claude/hooks/block-secrets.test.py
```

The functional specification is kept out of this repository because it contains personal data.
