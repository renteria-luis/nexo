# The look: neobrutalism, and what this app already has for it

Written while rebuilding the Hoy screen (step 3 of the redesign) so the other screens
do not need the research again. Read this before restyling a screen; everything here is
either measured in this repo or quoted from the reference the owner picked,
[neobrutalism.dev](https://www.neobrutalism.dev).

## 1. The canonical tokens, and ours

Pulled from the reference's own stylesheet (`/_next/static/css/…`, the `:root` block):

| Token | Reference | This app (`src/ui/theme.ts`) |
|---|---|---|
| border width | `2px`, and nothing else exists in their CSS | `shape.border = 2` |
| radius | `--border-radius: 5px` | `shape.radius = 10`, `radiusSmall = 7`, `radiusLarge = 25` |
| shadow | `4px 4px 0px 0px var(--border)` | `hardShadow()` → offset 4, radius 0, opacity 1 |
| pressed | translate by the shadow offset + `shadow-none`, 150 ms | `pressed()` → same translate, no animation |
| page | `--background: #dcebfe` (a pastel tint) | `bg: #fff4e0` cream |
| modes | light and dark | **light only** (see below) |
| surface | `--secondary-background: white` | `surface: #fffdf7` |
| ink | `--foreground`, `--border`, `--ring`: black | `text`, `line`: `#121212` |
| accent | `--main: #5294ff` | `accent: #ffdc58` yellow |
| heading / body weight | 700 / 500 | 800 / 400–700 (Nunito) |
| font | DM Sans | Nunito + Archivo Black for display |

Differences on purpose:

- **Radius 10 instead of 5.** The owner asked for corners "un poquito redondeados como
  los del diseño C, no tanto como los del diseño A". 5 px reads sharper than he wanted.
- **Cream page, yellow accent** instead of their blue: his pick from the four Pinterest
  references, and the cream keeps the paper feeling that the graph-paper grid needs.
- **No press animation.** 150 ms of transition on a phone in a gym is 150 ms of doubt.
  The translate happens on the same frame as the touch.
- **One palette, light.** A dark palette was built and removed on 2026-09-26: it looked
  bad and the light one is the one being finished. It would come back as a second
  `Palette` plus a switch inside `theme.ts`, without touching a single screen, which is
  why `sheet()` still takes the palette as an argument.

## 2. Colour

Five flat, saturated colours, the same in light and dark mode:

| Name | Hex | Means, in this app |
|---|---|---|
| `accent` | `#ffdc58` yellow | the day's score, the primary action, anything selected |
| `ok` | `#a3e636` lime | training, and "inside the band" |
| `info` | `#88aaee` blue | food, and "above the band" |
| `warn` | `#ff9f45` orange | notices that need a decision, "below the band" |
| `danger` | `#ff6b6b` coral | deals, destructive buttons |

Rules that keep it readable:

- **Ink on a colour is always `accentInk` (`#121212`).** `accentInkSoft` (68 % black) is
  for the secondary line on a coloured card.
- The pastel variants (`okBg`, `warnBg`, `infoBg`) are for large quiet areas behind
  something else (the band inside a chart), never for cards.
- **The colourblind palettes (spec 4.5) are only for the grid squares.** The owner was
  explicit. They live in `src/core/palettes.ts` and nothing else may read them.
- Never hardcode a hex in a screen: every colour comes from `theme`.

## 3. Type

| Role | Family | Where |
|---|---|---|
| display | `font.display` = Archivo Black | **only** the screen title and the one big number |
| heavy | `font.black` = Nunito 800 | card titles, values, labels, buttons |
| medium | `font.bold` = Nunito 700 | secondary lines, captions, inputs |
| body | `font.regular` = Nunito 400 | explanations, hints, anything of a sentence or more |

- Sizes in use: 56 (hero number), 27 (screen title), 18–19 (header, card title), 15–17
  (values), 12–14 (labels and body), 11 (eyebrows, with `letterSpacing: 1`).
- **Every number that can change gets `fontVariant: ['tabular-nums']`** so a column of
  weights or a running clock does not jiggle.
- Archivo Black has one weight and no italics. Used in a third place it stops being the
  app's voice and becomes noise.

## 4. Shape and relief

- Everything touchable: 2 px ink border, `shape.radius` (or `radiusSmall` under ~40 px
  tall), flat background, `hardShadow()`.
- Pressing translates into the shadow (`pressed()`), so the element looks stuck to the
  page for as long as the finger is down. Flat things (a list row, a ghost button) dim
  to 55 % instead.
- **Raised means touchable, flat means not.** A `Card` with `raised={false}` reads as
  disabled or as a plain surface; that is how the Finanzas card says "not built yet".
- Shadows need an opaque background underneath them on iOS, which every component here
  has. `elevation: 0` means Android gets no shadow, and this app is iOS only.
- One offset only: 4 for cards and buttons, 3 for chips and keys, 2 for the today
  square in the grid. No blur anywhere, ever.

## 5. What is already built (reuse before writing)

| Component | File | Use it for |
|---|---|---|
| `Button` | `src/ui/Button.tsx` | any action. `primary` / `secondary` / `ghost` / `danger`, `size="large"`, `block`, `icon` |
| `Card` | `src/ui/Card.tsx` | any block of information. `tone`, `raised`, `onPress`, `title` |
| `Chip` | `src/ui/Chip.tsx` | one option out of a short list. Selected = yellow and raised |
| `IconButton` | `src/ui/IconButton.tsx` | an action that is only an icon: the (i) on a portion, the bin on a row |
| `SearchField` | `src/ui/SearchField.tsx` | a search box: the magnifier, the text, and a clear button once something is typed |
| `Toggle` | `src/ui/Toggle.tsx` | one thing that is on or off, in a row with its label |
| `Star` | `src/ui/Star.tsx` | the one decorative sticker per screen, with a number inside |
| `Screen` | `src/ui/screens/Screen.tsx` | the frame: scroll, title, database states, overlay slot |
| `TopBar` | `src/ui/TopBar.tsx` | the app's own header on every screen: the wordmark, and Ajustes or the done check |
| `TabBar` | `src/ui/TabBar.tsx` | the app's own floating bottom bar, with the yellow block that slides to the open tab |
| `CommandBar` | `src/ui/CommandBar.tsx` | the typed shortcut, already restyled |
| `NumberPad` | `src/ui/NumberPad.tsx` | the app's own keypad; never the system one for numbers |
| `NumericField` | `src/ui/NumericField.tsx` | a number that the keypad writes into |
| `DisciplineGrid` | `src/ui/DisciplineGrid.tsx` | the twelve weeks. Memoized; feed it stable props |
| `DayBars` / `LineChart` / `MuscleBars` | `src/ui/charts/` | the charts |

Writing a fourth variant of one of these is the failure mode this file exists to
prevent. If a screen needs something the list does not cover, add it to the list.

### The spinner

An action that can take a noticeable time gets `loading` on its `Button`: the icon slot
turns into a spinning `LoaderCircle` and the button stops accepting touches, which is the
reference's "spinner in button" (`/r/spinner.json` is a `Loader2Icon` with `animate-spin`;
lucide renamed that icon `loader-circle`).

It spins through `Animated.loop` on the **native driver**, so it keeps turning while the
JavaScript thread is busy with the very thing being waited for. On web the icon stays
still, because react-native-web's native-driver shim does not carry rotations — that is a
dev-only cosmetic gap, not a bug to chase.

Used by: export and import in Ajustes (each button spins only for its own job, so the
busy flag names which one), and "usar mi ubicación" while the GPS answers. A button that
finishes in a frame does not get one.

### The switch, and when it is the wrong control

`Toggle` follows the reference's own switch (`/r/switch.json`): a **pill** track with the
2 px ink border, white when off and `accent` when on, and a **round** thumb that carries
its own 2 px border. Ours is 56 × 30 with a 22 pt thumb — theirs is 48 × 24, which is
under the finger size for a phone — and it slides in 130 ms, thumb and colour both on the
native driver (the colour is a filled layer whose opacity animates, because background
colour cannot go through the native driver).

Use it for a real boolean with its own label: the nudges, "was it within 6 h of
training". Do not use it for:

- **three or more options** — that is `Chip`, because a switch cannot show a third state;
- **anything that can still be unrecorded.** Creatine is the example: the score treats
  "not written down" and "written down as not taken" differently (the first leaves the
  criterion out of the day's total, the second scores it as zero), and a switch would
  draw both as off. That stays two chips.

When a group of switches depends on a master switch, leave them visible and `disabled`
rather than unmounting them: the list keeps its height and he can see what exists.

**Choice card** (the reference's own name for it): a whole `Card` is the hit area and it
carries the label, the sample and the switch. The palette picker is built that way — the
card shows the three colours of the scale, the switch on the right says which one is in
use, and either one selects it. A palette is always selected, so turning the active
switch off does nothing; that is the one place where a switch stands in for a radio, and
the code says so out loud.

## 6. Icons

**The pack is [lucide](https://lucide.dev) (`lucide-react-native` 1.47, 1848 icons),
and it must be imported one icon at a time.** `src/ui/icons.ts` is the only file allowed
to touch the package; everything else imports from there.

Measured on this repo (`/index.bundle?platform=ios&dev=true`):

| | barrel import | one module per icon |
|---|---|---|
| modules in the bundle | 3267 | 1441 |
| dev bundle | 10.6 MB | 6.9 MB |

The barrel (`import { Check } from 'lucide-react-native'`) re-exports all 1848 icons, so
all of them end up in the app to serve the twenty it draws. `lucide-react-native/icons/<kebab-name>`
is one file with a default export, which is what lucide's own React Native guide
recommends.

Conventions: `size` 14–15 inside a chip or a badge, 17–20 in a card or a tab bar, 22 for
a lone action. `strokeWidth` 2.25–2.5 (lucide's default 1.75 looks thin next to a 2 px
border). An icon that labels something sits in its own **badge**: a 26–28 px box with the
2 px border and `radiusSmall`, which is the style's own way of drawing an icon.

There is no hand-drawn pack for React Native worth adding (`@expo/vector-icons` would
bring nine more families of the same clean-line kind, and Iconify's hand-drawn sets have
no RN components). The "drawn" feeling the owner liked comes from the heavier stroke, the
ink border and the tilted star, not from another pack.

## 7. Charts

Hand-drawn with `react-native-svg` (15.15.4, installed), and that stays. A chart library
is not worth its cost here:

- `victory-native` (XL) needs `@shopify/react-native-skia`; `react-native-gifted-charts`
  and most animated ones need Reanimated. **Reanimated 4 is what crashed the app on
  2026-09-21** (`react-native-worklets` outside the range this Expo SDK supports) — see
  `docs/sliders.md`.
- The charts here are three: bars per day, a line over time, horizontal bars per muscle.
  All three are twenty lines of SVG each and already match the style.

The recipe, as applied in `src/ui/charts/`:

- A 2 px ink baseline drawn **on top of** the bars: it is the floor of the drawing.
- Bars filled flat with a 1.5 px ink stroke, narrowed by the stroke so neighbours do not
  touch. Selected bar turns yellow.
- The target band is a pastel rectangle behind the bars (`okBg`), never a gradient.
- Lines: 3 px, round caps, dots `r` 3.5 with a 1.5 px ink stroke.
- The tooltip is a small card: surface, 2 px border, `hardShadow(3)`, the date in bold
  12, the value in `font.black` 18, and the action as a yellow mini-button.
- Axis labels: `font.bold` 11, `textFaint`, tabular numbers. Two dates and one number is
  all the axis a phone needs.
- Available SVG primitives if something more is wanted: `Pattern` (a hatch or dot fill
  reads very neobrutalist), `Polygon` (the star), `Mask`, `ClipPath`, `Text`, `TSpan`.

### Dragging a list, without Reanimated

`SessionPlanner`'s order list is the one draggable thing in the app, and it is built on
`PanResponder` and `Animated` only, for the same reason the sliders are not: every drag
library in React Native pulls in Reanimated, and Reanimated is what crashed the app on
2026-09-21 (`docs/sliders.md`).

What makes it work, and what to copy if another list ever needs it:

- **It drags from a handle and nothing else.** A 34 pt wide, full-height column with
  lucide's three lines and the exercise's number under them: touching it lifts the row at
  once, with no hold to wait for, and the rest of the row stays free for reading,
  scrolling and the set steppers. (It started as a 250 ms hold on the whole row, and the
  owner asked for the handle instead — a hold is a rule you have to remember, a grip is a
  thing you can see.) The pan responder still lives on the list and claims moves while a
  row is held (`onMoveShouldSetPanResponderCapture` reads a ref, not state, because the
  gesture runs outside the render).
- **The scroll and the pager are locked, but only from the moment the finger lands.**
  The row's own responder claims the touch at `onStartShouldSetPanResponderCapture` and
  answers `onPanResponderTerminationRequest: () => false`; on top of that, lifting a row
  sets the screen's `scrollEnabled` to false and the pager's `swipeEnabled` to false.
  Ordering is the whole trick: flipping those flags *during* a gesture makes iOS cancel
  the touch and the row stays hanging mid-screen, which is what happened when the lock
  was driven by a state change that landed a frame late. `onPanResponderEnd` is wired to
  the same drop handler as a last guard, because it fires for both endings.
- **The animated value is reset at the lift and at the drop.** Only at the lift was not
  enough: the last move can reach the view a frame after the render that released the
  row, and then the row sits on top of its neighbour. That is why the overlap appeared
  more often the faster he let go.
- **Leaving the card cancels the drag**: past the first or the last row the drag drops
  itself, the row returns to its place and the order does not change. A row dragged onto
  the card above means nothing, and leaving it hanging there means less.
- **Dropping is one state change and nothing else.** The lifted row is identified by the
  exercise's id, not by its position, and the animated value is reset when the drag
  *starts*, not when it ends. Keyed by position, a frame where the new order had landed
  but the highlight had not cleared painted the row that had just taken that slot: the
  flash the owner saw on release. Resetting the animated value at the end had the same
  shape of problem for the position, because an animated value travels to the view by its
  own channel and not with the render.
- **One fixed row height** (`ROW`), so the landing index is `round(dy / ROW)` instead of a
  table of measured heights.
- **The lifted row uses an `Animated.Value`** (no re-render per move) and the rows it
  passes shift by `±ROW` from state, which changes only when the landing index does.
- **The handle is the number and the name, not the whole row**, so holding a stepper
  button does not lift anything.
- Lifted looks lifted: yellow fill, `hardShadow(5)` and `zIndex: 2`.

### When the keypad covers what he is typing

The app's own keypad is a fixed 220 pt overlay at the root, so there are no keyboard
events to listen for and nothing scrolls out of the way by itself. `Screen` provides
`useReveal()`, and `NumericField` calls it on focus:

- The field asks to be revealed; a field can name **a whole block instead of itself**
  (`reveals={ref}`), which is what the training form does — the weight box is useless
  without the reps box and the "+ serie" button next to it, so the whole exercise card
  comes up.
- The maths is all in screen coordinates: measure the target and the screen frame with
  `measureInWindow`, work out how much of the target falls below where the keypad starts,
  and scroll by exactly that, never more than would push the block's own top off the top.
  Measuring against the scroll content instead gave numbers in another origin and the
  scroll came up short.
- It only ever scrolls **up**: something already visible does not move.
- One frame of `requestAnimationFrame` first, because the content has just grown a
  220 pt tail to make room for the keypad and without that room the scroll clamps.

## 8. Sliders

Researched and written up separately in `docs/sliders.md`: the pager steals the
horizontal drag, so a slider needs `swipeEnabled` turned off while dragging, or
gesture-handler, and gesture-handler drags Reanimated in. Nothing in the app uses a
slider today; steppers won.

## 9. Layout and proportion

- The frame is `Screen`: 20 px side gutters, 14 px top, 40 px bottom, `gap: 12` between
  blocks, and a 2 px line under the navigation header (the native header cannot carry a
  border, so the content's top border draws it).
- Card padding 14, or 12 when two cards share a row.
- Two columns: `flexDirection: 'row'`, `gap: 12`, each card `flex: 1` → 169 pt on a
  390 pt screen. Anything narrower than about 150 pt cannot hold a value and a label.
- **The grid measures itself.** Its thirteen columns (the weekday letters plus twelve
  weeks) are `flex: 1` with a 2 pt gap, and each square is `aspectRatio: 1`, so the grid
  fills the card's inner width exactly on any screen: 23 pt squares inside a 318 pt card
  on a 390 pt phone. Fixed cell sizes left a dead strip on the right, which is what the
  owner spotted.
- Vertical order on a screen: the one number that matters, the fast input, the history,
  the ways out, the forms, the reference. The Hoy screen is the reference implementation.
- **Both bars are ours.** The top one is the page's cream and draws no rule of its own:
  the line under it is the `Screen`'s own top border, and a second border there would
  read as 4 px. It is the wordmark in a **flat** yellow sticker (it is not touchable) and
  one **raised** button on the right (which is): the gear into Ajustes on the main
  screen, and a yellow check that closes the screen on every pushed one. It is wired as
  the stack's `header` option, so it is the same bar everywhere, it carries `insets.top`
  itself, and `back` from the navigator — not a guess — decides which button it shows.
- **The bar carries no title.** The screen's own display title says where you are, and
  the native header used to say it a second time in 18 pt right above it. Every pushed
  screen therefore passes `title` to `Screen`; the ones that used to lean on the route
  name (Registros, Gráficas, Lecturas, Recomendaciones, Experimentos, Resumen semanal,
  Día and the exercise card) now say their own name.
- **The tab bar floats**, which is how the owner's design C draws it: a `surface` island
  with the ink border all the way round, `shape.radiusLarge`, `hardShadow()`, laid
  **over** the pages rather than under them. Its wrapper is `pointerEvents="box-none"`,
  so the cream around the island belongs to the screen underneath and not to the bar.
  Design C's own bar is a stadium; ours stops at 25, which is round enough to read as a
  loose object and still short of the 32 that would make the ends semicircles.
- **Where a floating island can sit is decided by the corner of the phone**, not by
  taste. It keeps 20 pt from the sides and drops 14 pt into the bottom safe area (never
  closer than 8 pt to the edge), which on a phone with a gesture bar leaves it 20 pt up.
  Its rounded corner then ends up about 43 pt from the centre of the screen's own corner
  arc, which is inside it on every iPhone that has one. Lower or wider than that and the
  corners start to be eaten by the curve of the glass.
- Inside it, five items with the icon over an uppercase label, and the one you are on is
  a yellow block with the 2 px border and `hardShadow(3)`. The block is absolutely
  positioned and its `translateX` is the pager's own `position`, so it follows the finger
  across a swipe instead of waiting for the page to land, and it rides the native driver
  because a translation is all it does.
- **A floating bar has to hand down its height**, or it covers the last card on every
  screen. `TabBar` exports `FloatingBarSpace` and `tabBarSpace(bottomInset)`, the tabs
  provide that number around the navigator, and `Screen` adds it to the bottom of its
  scroll content. Outside the tabs the context is 0, so a pushed screen keeps its plain 40.
  Putting that space in the scene instead would have shortened the frame `Screen`
  measures, and the keypad's reveal maths is measured against that frame.
- The keypad is 220 pt tall and content shrinks for it; overlays inside `Screen` do the
  same, and the keypad covers the tab bar while it is open.

## 10. Do and do not

Do: flat fills, ink borders, hard shadows, big type, one accent per screen, one star per
screen, black ink on every colour, tabular numbers, a badge around a labelling icon.

Do not: gradients, blurred or soft shadows, semi-transparent surfaces, more than one
display face, colour as the only signal (spec 4.5 forbids it and the grid proves it can
be done), a second star, a shadow on something that is not touchable (except the card,
which is the page's paper), the system font (every `Text` style sets a family), a second
palette while the light one is not finished.

## 11. Where the redesign stands

Done: `theme.ts` (one light palette), `Button` (with `loading`), `Card`, `Chip`,
`Toggle`, `Star`, `Screen`, `CommandBar`, `NumberPad`, `NumericField` styling,
`DisciplineGrid`, the three charts, `TargetsCard`, `PalettePicker`, `TodayLog`,
`DayDialog`, the Ajustes controls, and the **Hoy** screen.

Also done: **Entreno**, both halves of it — the planner before the session
(`SessionPlanner`: the four decisions in one card with a rule between each, then the
numbered order of the day) and the session itself (`TrainingScreen` + `SessionLog`: a
card for the routine and the crowd, one for volume and the clock, one for the exercise
list, one for the open exercise with its form). The numbers in the planner's list are the
one place numbered markers are used, because there the order is the content: it is the
order he will train in, and the selector inside the session follows it (spec 8.5).

Also done: **Ejercicios** (`ExercisesScreen`), the catalogue editor reached from Ajustes:
a searchable list, then one card per thing that can be changed about the exercise, with
switches for the implements and the gyms, chips for the tier, and a numeric field per time
budget. It is the template for any future "edit the data" screen.

Also done: **the frame itself** — `TopBar` and `TabBar`. The bar React Navigation ships
painted the open tab's icon and label in the accent colour, which here is yellow on
paper: unreadable, and the only real signal left was a four-point line. Now the signal is
an object, which is what this style does.

Also done: **Comida**, all of it (`NutritionScreen`, `FoodLog`, `FoodPicker`,
`PortionMacros`, `BatchPanel`, `FoodsScreen`, `FoodForm`). The shape is the Hoy one: a
coloured hero card with the day's calories as the big number and the protein inside the
star, because the protein floor is what decides whether a day of eating counts; then the
rest of the macros as bordered cells inside one card, the portions as ruled rows with an
`IconButton` each side, the picking in its own card, and the batches in another. The
`+` that marks an incomplete total (spec 16.3 rule 5) rides on the figure it belongs to,
and the line that explains it is a warn-tinted strip inside the card rather than a
shouting orange card of its own.

Also done: **Ajustes** (`SettingsScreen`), twice. First onto cards, then — his words —
because it was still "demasiado overwhelming, mucho texto y campos". What that second
pass removed is the lesson: **a settings screen explains itself with its labels or not at
all.** Every paragraph that described a field is gone, and what the paragraphs carried is
now in the field itself: a `*` on the two that the targets cannot be computed without,
the factory value as the grey placeholder (`settingDefault`), a format as the
placeholder of a date. An error still gets a red line under the field, because that is
not an explanation, it is an answer.

What is left is seven cards: Perfil (height, birth date, activity, phase, weight unit),
Metas (sleep as hours and minutes, steps), Readaptación, Avisos, Catálogo (into the two
editors), Respaldo, Base de datos. Readaptación is a **card with a switch in its head
row** — the palette's choice card, but alone: the switch is the setting (on writes
today's date into `re_entry_started_on`, off clears it) and the two fields only exist
while it is on. The eye in Perfil now hides two fields instead of five, which is what
makes it mean something: his height and his birth date. The body-weight field is gone
from here entirely, since he writes it every day on Hoy.

Moving it onto `Screen` — it used to carry its own `ScrollView`, from back when `Screen`
assumed a tab bar under it — gave it the 2 px rule under the header and the keypad reveal
for free.

Left, screen by screen: Ofertas (`DealsScreen`) and the pushed screens (`DayScreen`,
`ChartsScreen`, `RecordsScreen`, `WeekSummaryScreen`, `ReadingsScreen`,
`RoutineNotesScreen`, `ExperimentsScreen`, `PendingScreen`). Each one is the same job:
replace hand-rolled boxes with `Card`,
option rows with `Chip`, actions with `Button`, set a family on every `Text`, and give
every `Pressable` a pressed style.

The app icon is last, and it is his call.

Sources: the reference's own stylesheet and docs
([neobrutalism.dev](https://www.neobrutalism.dev/docs)), lucide's package layout
(`node_modules/lucide-react-native/package.json` exports map), and the measurements in
this repo quoted above.
