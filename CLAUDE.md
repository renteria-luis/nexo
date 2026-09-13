# CLAUDE.md

## Project

Personal single-user iOS app. Modules: Training, Nutrition, Deals, and later Finance. Not for distribution, no App Store, no accounts.

**`SPEC.md` in this repo is the source of truth.** Read it before any work. If a request contradicts the spec, say so and ask — do not silently follow either one.

Stack: Expo / React Native / TypeScript. Local-first (SQLite on device). A separate Node ingestion service appears in Phase 1 for the Deals module only. The owner has no Mac; builds go through GitHub Actions macOS runners and are sideloaded.

## Language

- **Code, comments, commit messages, PR titles and bodies, file names, docs, README: English.**
- **Conversation with the owner: Spanish, informal Latin American register.**
- The owner is not a developer and does not plan to become one. He makes the architecture calls; you do the implementation. Explain in plain language and define any term the first time you use it. Never assume he knows a library, pattern, or CLI flag.

## Required response format

**End every response with this block. No exceptions, including for trivial changes.**

```
---
Qué hice: <2–3 frases, sin jerga. Qué hace ahora la app que antes no hacía.>
Qué cambió: <antes → después>
Commits sin subir: <N>
PR en curso: <nombre> — commit <X> de <Y>. Faltan: <lista corta>
Listo para push: <sí | no, porque ...>
```

Rules for the block:

- **Get the unpushed count from git, never from memory.** Run `git rev-list --count @{upstream}..HEAD`. If no upstream is configured, write `sin upstream configurado` rather than a number. A wrong number here is worse than no number.
- If no PR is in progress, write `PR en curso: ninguno`.
- `Listo para push` is `no` whenever the PR plan has unchecked commits, tests fail, or the working tree is dirty. State which.
- "Qué hice" describes behaviour, not implementation. Write "ahora la app calcula el volumen de cada sesión", not "added a reducer to the session slice".

## PR tracking

Before the first commit of any PR, write `.claude/pr-plan.md`:

```md
# PR: <slug>
Goal: <one line>
Commits:
- [ ] <type>(<scope>): <subject>
- [ ] <type>(<scope>): <subject>
```

Check a box immediately after the matching commit lands. The status block reads its counts from this file. Delete the file when the PR merges.

If the plan turns out wrong mid-PR, update the file and say so in the status block. Do not silently commit things that are not in the plan.

## Before writing code

1. Read the relevant section of `SPEC.md`.
2. **Search the codebase before writing any helper, type, or utility.** Duplicate utilities are the single most common defect in agent-written code. Grep for the concept, not just the name.
3. For anything touching more than one file, state the plan and wait for approval.
4. If a package or API is not already in `package.json`, verify it exists before importing it. Do not write against a remembered API surface.

## Code

- Efficient and plain. Solve the problem in front of you and nothing adjacent to it.
- Prefer the standard library and existing project utilities over new dependencies.
- **Do not refactor code you were not asked to touch.** If you spot something worth changing, mention it in the response; do not change it.
- **Do not add features, options, config flags, or abstractions that were not requested.** No "while I was in there".
- Delete code that a change makes dead. Adding without removing is how this codebase rots.
- No comments explaining what the code does. Comments only for why a non-obvious decision was made.
- Errors fail loudly. No silent catch blocks, no empty fallbacks that hide a broken state.

## Commits

Conventional Commits. `<type>(<scope>): <subject>`

- All lowercase. Imperative mood. Roughly 2–10 words.
- **Under 60 characters total.**
- Subject line only. Add a body only when the change is incomprehensible without one.
- One logical change per commit.
- No emoji. No em-dashes.
- **No attribution of any kind.** Nothing referencing Claude, AI, assistants, agents, or generation tools may appear in commit messages, PR titles, PR bodies, code comments, or the README.
- **No `Co-Authored-By` trailer.**

Types: `feat` `fix` `refactor` `test` `docs` `chore` `build` `ci`
Scopes: `training` `nutrition` `deals` `core` `ui` `db` `ci`

```
feat(training): add volume load calculation
fix(nutrition): correct protein band boundary
refactor(core): extract rolling average helper
chore(db): add batch table migration
```

Never: `feat: various improvements`, `fix: bug fixes`, `Update files`, anything title-cased.

## Pull requests

Lowercase titles, same style as commits but a little longer is fine. The body may explain reasoning across several sentences. Still no em-dashes, no emoji, no attribution, no filler openers ("This PR introduces...").

**Check every PR body for attribution before creating it.** PR bodies go through the GitHub API, not through git, so the `commit-msg` hook in `.githooks/` cannot reach them. Read the body you are about to submit and delete any `Claude-Session`, `Co-Authored-By: Claude` or `Generated with Claude Code` line before the PR is opened. Same for PR titles and review comments.

**The `commit-msg` hook does not run on GitHub squash merges.** GitHub composes the squash commit message from the PR title and body on its servers, where no local hook exists. So reviewing the PR body is not a courtesy to reviewers, it is what keeps attribution out of the permanent history on `main`. Check it before merging, not only before opening.

Body structure:

```md
what this does
<plain sentences>

why
<the reason, or the spec section it implements>

what to check
<what the owner should look at or test>
```

## Security — non-negotiable

**Never commit:** `.env`, `.env.*`, API keys, tokens, passwords, credentials, session files, `*.pem`, `*.p12`, `*.mobileprovision`, certificates, database dumps, or any file containing a secret.

Maintain `.gitignore` proactively. When you add anything that produces a secret or a credential file, add the pattern in the same commit.

**Enforcement, not instruction.** This file is context, not a guard rail — Claude Code treats `CLAUDE.md` as guidance it can reason around, so a rule written here alone does not block anything. A `PreToolUse` hook in `.claude/settings.json` must block writes and commits touching these patterns. Set this up in the first session and never disable it.

Credentials for the Deals module (Flashfood, Too Good To Go) live in environment variables on the ingestion server only. They never enter the repo, the app bundle, or a test fixture.

### Repo visibility — decision the owner must confirm

The repo needs to be **public** for free macOS runner minutes on GitHub Actions. But `SPEC.md` contains the owner's weight, body fat, sleep records, diet, and other personal health details.

**Recommendation: keep `SPEC.md` out of the public repo.** Add it to `.gitignore`, keep it locally, and commit only a short `README.md` describing the project structure without personal data. The spec still works as your source of truth locally; it just does not get published.

Do not push anything until the owner has confirmed this.

## Known agent failure modes — avoid these specifically

These are documented patterns in agent-written code, not hypotheticals. Each one has bitten real projects.

1. **Duplicate utilities.** Writing a helper that already exists because `lib/` was never read. Search first, every time.
2. **Hallucinated APIs.** Inventing functions, packages, or parameters that read as plausible and do not exist. Verify against the installed version, not memory.
3. **Overconfident refactoring.** Rewriting working logic that was not part of the ask, breaking edge cases that existed for undocumented reasons.
4. **Scope creep.** Out-planning and out-executing the actual request. The most-reported complaint about capable coding models. Build what was asked. Stop.
5. **Context rot.** In long sessions, earlier instructions, file states, and architectural decisions get progressively lost. When a session runs long, re-read `SPEC.md` and `DECISIONS.md` rather than trusting recall.
6. **Stale harness.** Decisions accumulate over weeks and never get written back, so the agent starts generating code that contradicts choices made a month earlier while faithfully following outdated rules. This is the failure that appears around week three. Countered by `DECISIONS.md` below.
7. **Adding without deleting.** Features quietly disappear between plan and shipped because old code was left in place alongside new code.
8. **Agreeing by default.** If the owner proposes something that will not work, say so and explain why in plain Spanish. He is explicitly relying on you to catch this, since he cannot read the code and evaluate it himself. Agreement is not helpfulness here.
9. **Destructive operations.** Never run a command that deletes data, drops a table, force-pushes, or rewrites history without explicit approval in that message. "I was told to clean up" is not approval.

Projects without architectural rules in a file like this one ship substantially more design flaws and privilege-escalation paths than projects with them. That is why this file exists and why it must stay current.

## DECISIONS.md

Every architectural decision the owner makes gets one entry, appended in the same session it was made:

```md
## <date> — <decision in one line>
Context: <what forced the choice>
Decision: <what was chosen>
Rejected: <what was not chosen, and why>
```

Read this file at the start of any session that has been idle more than a few days. When a request contradicts a logged decision, quote the entry and ask before proceeding.

## Workflow

- Build in thin vertical slices that touch every layer, rather than finishing one layer at a time. A working end-to-end path proves the architecture; three finished layers that have never met each other prove nothing.
- Commit before starting anything large, so there is a clean point to return to.
- Run the tests before saying something is done. If there are no tests for the area, say that plainly instead of implying it was verified.
- **Never commit directly to `main`.** Every PR is a branch, and it lands through a GitHub **squash merge** so that one PR becomes exactly one commit on `main`. The owner's contribution graph counts commits on the default branch: a nine-commit PR merged without squashing registers as nine contributions.
- Local commits stay granular, one logical change each. The squash happens at merge time, never while working. Do not pre-squash a branch by hand.
- The squash commit message is composed from the PR title and body, so both must already follow the commit rules above.
- Keep sessions scoped to one PR. Start a new session for a new area of work.

## Out of scope — do not build

Accounts, login, sharing, social features, multi-user, App Store distribution, rest-between-reps tracking, generated or scraped exercise technique media, in-app deal redemption, DoorDash or Uber Eats integration.

If you believe one of these is needed, raise it. Do not build it.
