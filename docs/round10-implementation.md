# Round 10 implementation and verification

Completed on 2026-10-28 on `critique-p10`, continuing the work described in
`critique.md` under **Round 10 critique**. This is a repair pass, not a new critique
round or a redesign. No new dependencies were added. After verification, the owner
authorized documenting, committing and publishing the work and launching the IPA.

## Next session: start here

- Round 10's objective repairs are implemented. Do not restart the ten critiques
  or treat the two deferred interaction choices below as approved features.
- Publication follows the existing workflow: preserve `critique-p10` locally,
  consolidate onto current `main`, push without a PR, then dispatch
  `.github/workflows/ios.yml` on that exact revision. The local date is October 28;
  at publication time it is already October 29 UTC. Commit dates use the actual
  clock, without backdating.
- The local `.claude/pr-plan.md` records the final commit and build run URL after
  dispatch. On another machine, inspect the latest `ios` workflow run and compare
  its `headSha` with the published commit before downloading `nexo-ipa`.
- The workflow produces an unsigned `nexo.ipa` for the existing on-device signing
  flow. Starting a build does not mean that the artifact is ready or that native
  iOS behaviour has been verified. Check its final conclusion and artifact first.
- On iPhone, check a blank past day and period average, profile completion, the
  workout recap and return bus, recipe Save above the keyboard, help bubbles,
  native maps, and notification/GPS behaviour. These are follow-up device checks,
  not a request for a redesign.
- Keep migration 072 immutable after publication. Preserve the distinction between
  no score and missed-training history when changing any day consumer.
- `.agents/`, `.codex/` and `.expo/round10-evidence/` are local tooling/evidence.
  They are preserved outside the publication; the first two are excluded through
  `.git/info/exclude`. Do not publish the private spec, critique or phone backups.

## Recovered state

The starting HEAD was `9468265fb49e9a707dc5a996a62242b84f773ce2`. It already included
the central no-data scoring fix (`e4ff871`), migration 071 (`82f89de`) and
the food form labels (`9468265`). Those changes were retained.

Eight tracked files contained unfinished changes: `AssistantSettings`, `InfoBubble`,
`SessionLog`, `TransitPlanner`, `ExercisesScreen`, `ReadingsScreen`, `RecipesScreen`
and `SettingsScreen`. Their useful help/copy changes were continued. In particular,
the Transit help change still needed its imports. There were no staged changes.
The pre-existing untracked `.agents/` and `.codex/` directories were left untouched.

Before editing, git status, branch, history, staged/unstaged diffs, the complete
critique, PRODUCT, DESIGN, SPEC, project instructions and the relevant code were
read. An initial worktree snapshot was saved outside the repository. A host restart
later cleared that `/tmp` snapshot; HEAD and the recorded starting file list remain
the original reference. The resumed checkpoint, final diff, screenshots and logs
are now under ignored `.expo/round10-evidence/`.

## P1 — Empty days

- Kept `trained = false` for past missed sessions in `shell/day.ts`: SPEC 4.3's
  missed-training history still needs it. The committed `scoreDay` fix separately
  leaves an entirely unrecorded day unscored, with no penalty.
- Checked the complete path through assembled days, reports, persisted scores,
  records, grid cells and period averages. Empty days remain `null`, never a stored
  zero that lowers the average. An explicitly recorded false/zero still counts.
- Added migration 072 for old zero scores with an empty session or only warmups,
  which migration 071 did not cover. Real working sets, food, explicit daily
  entries and marked rest days are preserved.
- Day detail distinguishes "sin entreno anotado" from a scored missed workout;
  the training empty state uses the same distinction.
- Regression coverage includes real data added after empty days, the ongoing miss
  run, clearing an entry, weight alone, marked rest, empty sessions and warmups.

## P2 — Clarity, workout completion and onboarding

- Completed the existing `(i)` pattern for food fields, dairy/GI information,
  dumbbell weight, core sets, Lecturas, Recetas, Assistant configuration, weight
  units, readaptation, phase and notification timing. Body weight remains in kg;
  the workout unit setting says what it changes.
- Transit help explains Salgo ahora, personal paths, offline availability and
  Terminar versus Cancelar. The actual trip behaviours were preserved.
- Tooltips respect the card gutter. Android Back closes an open help bubble first,
  leaving the current form intact. Android keyboard events and actual overlap are
  handled; iOS retains its existing `keyboardWillShow/Hide` path.
- A finished workout shows completed/planned sets, only existing records, and the
  return bus immediately after the recap. Set details can be expanded; active
  editing, variant controls, deletion and crowd/routine controls are hidden until
  the workout is reopened. The timing analysis stays available.
- Finished workouts use "Viaje de vuelta", "Ver bus de vuelta" and "Prepárate";
  active workouts retain "Termina". Notification wording follows the same state.
- Onboarding names the missing height/birth date. Weight is requested at Hoy →
  Peso. Completing the profile no longer routes back into an already complete
  profile, and entering weight does not remove a large card above the field.
  Historical days without a target snapshot say so truthfully.

## P3 — Content and state consistency

- Equal displayed departure minutes share a countdown. Live-feed freshness keeps
  second precision. A dated search does not repeat the same date on every row.
- The last departed bus remains as an explicitly labelled reference, as previously
  decided; it is not offered as a selectable future route. Nearby stop departures
  also label passed times. Actual schedules were not changed.
- A valid walking route no longer carries the generic contradictory no-bus line.
  Nighttime stop rows have no numbers that the map does not show.
- Ended trips show actual tracking start/end and elapsed duration, including
  "Menos de 1 min". Manual completion does not claim arrival.
- A saved "Salir ahora" journey stops silently rolling forward after the existing
  180-minute planner window. Its route and original selection time remain visible
  as "Viaje anterior", with an explicit new search. Active workouts and active GPS
  trips are protected. Retrying an old workout journey starts preparation from now,
  not its old workout end. Obsolete advice/reminders are suppressed.
- Recipes name missing/low ingredients once. The existing low-stock distinction,
  stock checks and blocked cooking remain. Protein copy identifies a projected
  portion, explaining the difference from the amount already eaten in Comida;
  calculations still use the same food macros and protein goal.
- Weekly summary uses the singular "ponderada" when appropriate.
- Offers and their source metadata are read in one transaction, queued with the
  download's snapshot replacement. A refresh cannot publish an intermediate empty
  table. Loading/empty/success messages no longer contradict or duplicate one
  another; errors remain visible.

## Minor findings and one-hand use

| Finding | Result |
| --- | --- |
| Planner/editor −, + and swap | Existing 36 pt visuals gain 4 pt hit slop on each side: 44 pt effective targets. |
| Swapping and saving the plan | The changed row is revealed after movement; returning to logging reveals the card from its top. |
| Copying the previous set | Copies weight, reps and RPE; a missing RPE clears a stale draft. |
| Food search order | Exact names, then usual/recent foods, then the stable remaining order. |
| Long food catalogue rows | Keywords remain searchable/editable, without a repeated visible keyword line. |
| Exercise name repetition | Removed the redundant sole-variant chip; editable exercise/family fields remain. |
| Exercise routine membership | Family membership counts machine variants correctly; the detail explains the relationship without claiming an automatic substitution. |
| Exercise action hierarchy | Add-to-routine actions moved below routine settings; removing from a routine asks for confirmation. |
| Exercise history in its detail | Deferred interaction choice, described below. Existing history is preserved. |
| Recomendaciones | Replaced the stale polea-only instruction and its lowercase sentence with gym-dependent copy. |
| Recipe form | Amounts align across units; Save/Cancel stay in the fixed footer, including above Android's keyboard. |
| Reset feedback | The existing destructive confirmation remains; successful reset displays "Datos borrados". |
| Avisos help | Bubble edges stay within the card gutter, including with the keyboard. |
| Night stop numbering | Removed the unsupported map rank. |
| Followed-trip controls | Todo el viaje and Ver paradas align; Ya subí has a full-width target. |
| Recipe menu icon | Uses the recipe/book icon instead of repeating Cocina's hat. |
| Unknown offer protein value | Removed repeated unknown protein/$ placeholders; prices and available nutrition remain. |
| Transit legend and status repetition | Legend remains collapsible with a 44 pt trigger; offline schedule source is stated once per stop, while meaningful live status icons remain. |
| Ver N más | Removed the misleading underline; kept a 44 pt action. |
| Empty measured walks | No empty card when there are no observations; existing observations and errors remain accessible. |
| Origin offered as destination | Excluded for both explicitly selected places and a saved place recognised as Tu ubicación; arbitrary map points remain available. |
| Logged food correction | Deferred interaction choice, described below. |
| Repeated coral set trash | Uses the existing quiet paper treatment with confirmation; hidden for finished workouts. |
| Avisos heading / profile placeholders | Removed the redundant heading; default activity/step placeholders explicitly say they are defaults. |
| Grid footer | Average and streak summaries use consistent typography. |
| Hoy offer sheet tags | Group tags appear when the group changes, not on every row. |

The global navigation and iOS back gesture were retained. Thumb-heavy workout
controls and the recipe footer were improved without introducing a new navigation
pattern. Reachability on a physical iPhone was not tested.

## Validation

Final checks passed after the last code change:

- `npx tsc --noEmit`.
- `npm run lint`, with no warnings.
- `npm test`: 1,036 Node tests, 37 secret-hook checks and 4 Python transit tests.
- Prettier on changed TypeScript files; `git diff --check`. The project excludes
  hand-written Markdown from formatting.

Regression tests cover P1 end to end, migration data preservation, the offers
refresh race, previous-set copying, recap state and count, journey expiry/retry and
notification wording, departure/date/walking copy, food ranking, recipe projection,
Android keyboard overlap and Back handling. Layout-only changes did not receive
tests that merely restate their styles.

Android verification used the connected Pixel 9 Pro XL emulator and the project's
Expo development client. All writes were confined to a separate Android user 10
with invented test profile/workout/pantry records. No real backup was imported.
The original Android user 0 was restored after verification. The test records were
removed through the app's reset flow, also verifying its success message.

Manually exercised:

- Fresh Hoy, profile completion and persistence, missing weight, weight entry,
  empty past-day detail and Registros.
- Start workout, log a set, swap an exercise, save the plan, finish, inspect recap
  and return bus, and expand completed sets.
- Food labels/help, Avisos help and Android Back returning to the same form.
- Recipe entry with count/ml units and keyboard open, save and expand. The test
  recipe (21 g protein/240 kcal plus 300 ml at 3.6 g/40 kcal per 100 ml, two portions)
  correctly showed 15.9 g protein and 180 kcal per portion, and one missing list.
- Real offers refresh, grouped rows without unknown protein/$ placeholders,
  expired journey state and explicit new search, reset and its success alert.

Transit was additionally exercised in isolated headless Chromium at 440 × 956,
using public seed places and the actual stored schedule: a bus route, a walk to
Costco, nearby departures, destination picker and the overnight state. Only the
browser clock was moved to 02:30 Toronto for the overnight check; no schedule data
or bus times were fabricated. No browser runtime errors were recorded.

Selected local evidence (ignored, not part of the commit):

- `../.expo/round10-evidence/android-workout-finished.png`
- `../.expo/round10-evidence/android-recipe-ingredients.png`
- `../.expo/round10-evidence/android-recipe-saved.png`
- `../.expo/round10-evidence/android-empty-final.png`
- `../.expo/round10-evidence/android-reset-success.png`
- `../.expo/round10-evidence/web-route-final.png`
- `../.expo/round10-evidence/web-transit-fanshawe-gym-night.png`
- `../.expo/round10-evidence/tests-final.log`

## Decisions left unchanged

1. **Correct a logged food:** inline quantity editing is fast; reopening Anotar
   prefilled also supports changing the food/portion without a second editor.
   Recommendation: reuse Anotar in a separately agreed change, with explicit
   behaviour for batch portions and historical entries. Current confirmed removal
   and re-entry remain available.
2. **Exercise history in its catalogue detail:** inline history reduces navigation
   but lengthens an editing screen; a direct link keeps the detail short but adds a
   tap. Recommendation: a direct link to the existing history. Neither interaction
   was imposed in this pass.

## Limits

- Native Android Transit still fails on the pre-existing missing Google Maps API
  key. The crash was reproduced and captured. No key was invented and the native
  map was not replaced to conceal the configuration problem.
- No iOS simulator/device was available on this Linux host. Native Apple Maps,
  glass, back gestures and keyboard behaviour still need an iPhone check.
- Real live-feed/GPS journeys, background delivery of notices and the Apple local
  model were not exercised. Their relevant state/copy has automated coverage,
  which is not a substitute for an on-device journey.
- Older screenshots capture intermediate states. In particular, the refreshed
  journey screenshot predates the final old-workout detachment; that additional
  fix is covered by the final regression tests. There is no claimed new Impeccable
  score or assertion that every platform/state has been visually checked.
