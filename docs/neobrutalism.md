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
| radius | `--border-radius: 5px` | `shape.radius = 10`, `radiusSmall = 7` |
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
| `Toggle` | `src/ui/Toggle.tsx` | one thing that is on or off, in a row with its label |
| `Star` | `src/ui/Star.tsx` | the one decorative sticker per screen, with a number inside |
| `Screen` | `src/ui/screens/Screen.tsx` | the frame: scroll, title, database states, overlay slot |
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
- The tab bar sits at the bottom with a 2 px top border and lifts itself above the home
  indicator with `insets.bottom`. The keypad is 220 pt tall and content shrinks for it;
  overlays inside `Screen` do the same.

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

Left, screen by screen: Entreno (`TrainingScreen`, `SessionPlanner`, `SessionLog`),
Comida (`NutritionScreen`, `FoodLog`, `FoodPicker`, `FoodForm`, `PortionMacros`,
`BatchPanel`, `FoodsScreen`), Ofertas (`DealsScreen`), the pushed screens (`DayScreen`,
`ChartsScreen`, `RecordsScreen`, `WeekSummaryScreen`, `ReadingsScreen`,
`RoutineNotesScreen`, `ExperimentsScreen`, `PendingScreen`), and the rest of
`SettingsScreen`. Each one is the same job: replace hand-rolled boxes with `Card`,
option rows with `Chip`, actions with `Button`, set a family on every `Text`, and give
every `Pressable` a pressed style.

The app icon is last, and it is his call.

Sources: the reference's own stylesheet and docs
([neobrutalism.dev](https://www.neobrutalism.dev/docs)), lucide's package layout
(`node_modules/lucide-react-native/package.json` exports map), and the measurements in
this repo quoted above.
