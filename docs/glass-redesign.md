# The glass redesign (October 2026)

An account of the move from neobrutalism to a dark glass look: what the owner asked for,
where it is meant to end up, what was built, what went wrong on the way and what is still
rough. It is written to inform, not to bind. If something here turns out to be wrong, or a
better way shows up, change the code and correct this page. The decisions themselves are
in `DECISIONS.md` (2026-10-17 and 2026-10-18 entries); this page is the story around them.

At the time of writing all of it is local and uncommitted, tracked as the `look-d-base`
pile in `.claude/pr-plan.md`, and it has only been seen on the owner's iPhone through Expo
Go. No IPA with it has been built yet.

## Why it started

The app was neobrutalist: cream paper, 2 px black borders, hard offset shadows, flat
saturated colours (`docs/neobrutalism.md`, now history). It had already been softened
once to pastels on 2026-09-30. The owner still found it too heavy and wanted something
lighter and more beautiful.

Another assistant proposed an "industrial bento" look built on Skia, Reanimated,
gesture-handler, NativeWind and Zeego. Reviewing it against this repo:

- It rested on Reanimated, which had crashed the app on 2026-09-21.
- It said "Reanimated v3" when the current major is 4, and claimed iOS cannot draw inset
  shadows, which RN 0.86 does with `boxShadow`.
- NativeWind would have rewritten every stylesheet without changing what is seen.

Five mockups of the Hoy screen were drawn to choose from: the current look, a soft light
one, an industrial light one, the dark bento one, and **D, dark glass**. He picked D.

## What he asked for, in order

His words are paraphrased here; the intent is what matters.

1. **Settle Reanimated first.** See "Reanimated" below.
2. **Look D for the whole app.** It has a warm dark background with soft colour blobs,
   translucent cards, light text and one amber accent.
3. **Backgrounds he chooses, per screen.** A colour, a gradient, the blobs, or one of his
   photos ("a gym photo behind Entreno"), with darken and blur. Later he added zoom and
   pan, to choose which part of a large photo fills the screen.
4. **The switches should be iOS 26's,** whose thumb turns into a small glass drop.
5. **Glass with shine and body everywhere,** not only on the tab bar. His reference was a
   "Liquid Glass Kit" image: glossy pills, a bright rim, light coming from the top-left
   and a soft shadow underneath. The app looked matte to him.
6. **The tab bar should be transparent, not black,** and behave like Apple's: a glass
   bubble that slides to the chosen tab and a lens when a finger drags across it. He
   asked for research on how Apple does it.
7. **Keep swiping between Hoy, Entreno and Comida.**
8. **Real blur behind cards.** On a photo, the area behind each card should be blurred
   (he settled on about 30% of the Fondos blur slider) and slightly darkened, regardless
   of the background's own settings. Without zoom: an early attempt looked "zoomed in" to
   him, meaning smeared into a flat colour.
9. **Sliders, not chips,** for darken and blur. Dragging them must not scroll the screen
   or open the side menu.
10. **Preview on the real screen,** not a small sample card.
11. **Dragging across the tab bar must not open the side menu,** the same way the grid
    already blocks it.
12. **The side menu in the new look.**

He is not a developer and judges by what he sees on the phone. Several rounds failed
before the card blur worked, and he asked for proper research rather than another guess.
Verify a visual claim before reporting it; see "How things were checked".

## Where it is meant to end up

- **Background:** dark, chosen per screen (photo, colour, gradient or blobs), with the
  shipped blobs as the default.
- **Floating layer:** everything that floats is real iOS 26 glass, see-through but slightly
  darkened so light icons and text stay readable. That is the tab bar, the side menu, the
  top bar buttons and the assistant ball.
- **Cards:** frosted glass. Over a photo they show it blurred and darkened behind them,
  with a light rim and a soft shadow.
- **Controls:** buttons, chips and fields are glossy glass pills. The selected or primary
  state is an amber drop with dark ink.
- **Native controls where iOS has them:** the switch, the slider, and the tab selection
  bubble.
- **Swiping between the three main tabs stays.**

Screens beyond Hoy have only been restyled through the shared components. The
screen-by-screen pass is still ahead (see "Still rough").

## What exists now

### Theme (`src/ui/theme.ts`)

- **One dark palette.** `surface` is a translucent white, `surfaceSolid` is opaque for
  things that float over content, `glass` is the fallback fill, text is light,
  `accent` is amber `#ffb36b`, and `accentInk` is dark ink for filled colours.
- **`glass.panel` and `glass.control`:** the shine. Each combines an
  `experimental_backgroundImage` linear gradient (light from the top left), a light
  border, and a `boxShadow` with an outer soft shadow plus an inset light top edge and a
  dark bottom edge. `glass.none` removes them for disabled states.
- **`gloss(color)`:** a filled colour with a strong top highlight, used for primary
  buttons, selected chips and toned cards.
- **Shapes:** `shape.border` is 1 and corners are large and continuous. Hard shadows are
  gone, and `pressed()` now dims and shrinks slightly.
- **Font:** Plus Jakarta Sans replaces Nunito and Archivo Black.
- `experimental_backgroundImage` does not render on react-native-web, so the browser
  shows flat panels. Only the phone shows the shine.

### Floating glass (`src/ui/Glass.tsx`)

- **The glass:** `GlassView` from `expo-glass-effect`, with style `clear`, color scheme
  `light` and tint `rgba(0,0,0,0.22)`.
- **Drawn on top:** an SVG sheen (top light plus a rim that brightens at both ends) and a
  soft outer `boxShadow`.
- **Layering:** the glass is an absolute layer behind the children, not a wrapper. That
  way the shadow is not clipped and the caller's style (padding, rows) still applies.
- **Fallback:** where Liquid Glass is unavailable (web, older iOS), a translucent fill.

### Cards (`src/ui/Card.tsx`, `src/ui/CardFrost.tsx`, `src/ui/scene.ts`)

Plain cards draw their own frost:

- **Darkening:** a 25% black layer behind every plain card.
- **The blurred copy:** over a photo background, the card renders a copy of the photo
  inside itself, offset by the card's own position on screen so it lines up with the real
  background. It is blurred `photo.blur + 12` points and carries the photo's own dim.
- **Cost:** the copy is drawn at a quarter size and scaled up by 4. Blurred content shows
  no loss, and each card decodes and blurs a much smaller bitmap.
- **Scroll:** `Screen` exposes a `SceneContext` (background, an `Animated.Value` of the
  scroll offset driven by the native driver, the offset in JS, the screen frame ref and a
  counter that rises when the content height changes). The copy's `translateY` is bound
  to the scroll value, so it stays still on screen while the card moves, with no JS per
  frame.
- **Measuring:** each card measures itself and the screen frame with `measureInWindow`
  when it lays out and whenever the counter changes.

The maths: with the card at window (x, y), measured while the scroll was s, the copy sits
at `left = frameX - x`, `top = -(y + s)`, and then `translateY = scroll`. Its window
position is therefore always (frameX, 0). That is 0 once a tab page has settled, so the
copy overlays the background exactly. It was verified numerically (see below).

### Backgrounds (`src/core/backgrounds.ts`, `src/ui/Backdrop.tsx`)

- **Setting:** one key, `backgrounds`, holds JSON keyed by screen name, with `*` for the
  general one. The kinds are `blobs`, `color`, `gradient` and `photo`.
- **Photo framing:** a photo stores its pixel size, a zoom (1 to 5) and the point of the
  photo at the centre of the screen. `photoFrame`, `clampPhoto` and `movePhoto` are pure,
  with tests in `backgrounds.test.ts`.
- **Photo files:** photos are copied into the app's documents by
  `src/shell/background-photos.ts` (expo-image-picker plus expo-file-system). Copies no
  background uses are deleted on save. They are not in the JSON backup; only the setting
  is.
- **Drawing per screen:** the background is drawn per stack screen, opaque. A single
  background behind everything let the screen underneath show through while a new one
  slid in.
- **Two slices:** each screen draws it twice, a slice behind `TopBar` and the rest behind
  the content (`ScreenFrame` in `App.tsx`). Both are window-sized and shifted, so they
  join without a seam. For that `TopBar` has a fixed height, given by `topBarHeight()`.
- **Tabs:** the three tabs share the `nexo` route. Their backgrounds are layered and
  cross-faded with the pager's `position`, which the tab bar publishes through
  `PagerPosition`. Tab scenes are transparent.

### Editing backgrounds (`src/ui/background-editing.tsx`, `src/ui/BackgroundEditor.tsx`, `src/ui/screens/BackgroundsScreen.tsx`)

- **The list:** Ajustes, then "Elegir fondos", shows the screens with a thumbnail each.
- **The session:** tapping one starts an editing session and navigates to that screen
  (the general background is tried on Hoy).
- **The panel:** a bottom panel holds the type chips, swatches, gradient direction, and
  the native sliders for darken and blur.
- **Photo gestures:** with a photo, a full-screen layer above the screen takes one finger
  to pan and two to pinch.
- **Live preview:** `useBackgrounds()` returns the saved map with the draft on top, and
  both the backgrounds and the card frosts read it.
- **Excluded screens:** "Día" and "Ejercicio" are not offered, because they need a
  parameter to open.

### Tab bar (`src/ui/TabBar.tsx`)

- **The bar:** the custom floating island stays, on `Glass`.
- **The bubble:** inside, iOS's own segmented control
  (`@react-native-segmented-control/segmented-control`) lies invisible across the whole
  row. Its titles are transparent but VoiceOver still reads them. The app's icons and
  labels are drawn on top with `pointerEvents="none"`. In iOS 26 the control draws the
  glass bubble, the slide and the drag lens. The trick comes from
  [UnionTabView](https://github.com/unionst/union-tab-view).
- **Swiping:** the pager keeps its swipe. During a swipe the bubble only jumps once the
  index changes.
- **Side menu:** touching the bar acquires the swipe lock (`useTouchLock` in
  `SwipeLock.tsx`, shared with the grid and the editor), so the side menu's edge gesture
  stays quiet.

### Other pieces

- **Switch:** `Toggle.tsx` is React Native's `Switch`, which is `UISwitch`, so iOS 26 adds
  its glass thumb by itself.
- **Side menu:** `Sidebar.tsx` is a floating glass panel inset from the edges, with a
  lighter scrim. The current screen is marked with the same glass bubble as the tab bar.
- **Hoy:** `TodayScreen.tsx` has a score ring with an amber glow (an iOS shadow taken
  from the ring's own shape), the streaks beside it, and neutral module cards.
- **Score palettes:** `core/palettes.ts` runs from dark to bright on the dark background.
  Spec 4.5 was changed with his approval, and a test checks that each step is brighter
  than the one before. The "Negra" palette is now labelled "Gris".
- **System appearance:** `app.json` sets `userInterfaceStyle` to dark, and the status bar
  is light.
- **Dependencies added at SDK 57 versions:** `expo-glass-effect`,
  `@react-native-segmented-control/segmented-control`, `@react-native-community/slider`,
  `expo-image-picker` and `@expo-google-fonts/plus-jakarta-sans`. Also
  `react-native-reanimated` 4.5.1 and `react-native-worklets` 0.10.1, which are unused so
  far (see below).
- **Dependencies removed:** the Nunito and Archivo Black fonts, and `expo-blur`.

## Problems found, and what they taught

### Reanimated

The 2026-09-21 crash was a version mismatch: `react-native-keyboard-controller` pulled
Reanimated 4.7, whose worklets 0.13 is outside the 0.7 to 0.10 range that
`expo-modules-core` supports.

Reanimated 4.5.1 with worklets 0.10.1, the versions SDK 57 pins, works, and so does
`babel-preset-expo`, which adds the worklets plugin by itself. `index.ts` imports it only
so a bad version would fail at launch. That import can go once a screen uses Reanimated.

When he first opened Expo Go after the install, the old crash message came back
(`installUnpackers`, "Cannot read property 'code' of undefined"). The cause was his
`expo start`, running since before the install, serving files transformed without the
worklets plugin and caching them. After any native or Babel-affecting install, restart
with `npx expo start --clear`.

### Glass that looked black

- **Regular style, dark scheme:** iOS 26 closes this down to nearly black over bright
  content, so that white text stays readable. Over his photos the buttons were black
  discs.
- **Clear style, dark scheme:** still dark grey.
- **What worked:** clear style with the light scheme and an explicit 22% dark tint gives
  see-through glass.
- **Reported by others:** the developer forums have
  [UIGlassEffect rendering black](https://developer.apple.com/forums/thread/800763) and
  [blur effects rendering solid](https://developer.apple.com/forums/thread/801638) on
  iOS 26, both without answers.
- **Opacity:** Apple advises against opacity below 1 on a glass view or its parents.
  Press feedback on glass buttons is therefore a slight scale, not a fade.

### The card blur, four attempts

1. **expo-blur, intensity 40, `systemUltraThinMaterialDark`:** he saw a flat colour that
   looked "zoomed".
2. **expo-blur, intensity 18 then 50, `dark`:** the cards darkened but the photo behind
   stayed sharp. expo-blur sets partial intensity by pausing a `UIViewPropertyAnimator` at
   `fractionComplete`. On iOS 26 that applied the tint without the blur. The first attempt
   was probably the same failure, read as flat colour.
3. **`GlassView` regular, light scheme, 30% tint:** a milky grey slab.
4. **Drawn by the app (current):** `CardFrost` as described above. It does not depend on
   iOS effects and the radius is exact.

### Smaller ones

- **Segmented control height:** the control has a fixed 32-point height in its own
  styles, so the bubble covered only the icons. It needs an explicit `height`.
- **Box shadows:** RN's `boxShadow` on iOS masks outset shadows to outside the box
  (`RCTBoxShadow.mm`), so it is safe on translucent views. The older `shadow*` props
  shade the whole layer.
- **The `react-hooks/refs` lint rule:** it flags building a `PanResponder` or an
  `Animated.event` with handlers that read refs during render. The working patterns here
  are two:
  - handlers defined with `useCallback` in a parent and passed as props to a small
    component that builds the responder (as in `BackgroundEditor` and `SessionPlanner`);
  - a value listener in `useEffect` instead of `Animated.event({ listener })` (as in
    `Screen`).
- **Node tests:** they load real modules unless mocked. `src/ui/test-render.ts` stubs
  `expo-glass-effect`. Card does not import `Glass.tsx`, whose SVG sheen does not load
  under Node.
- **Deals alert:** on a fresh browser profile it opens over Hoy and disables the scroll.
  Close it before testing scroll behaviour.

## How things were checked

- **Every round:** the unit tests (`npm test`, 964 passing at the time), `tsc`, eslint,
  prettier, and iOS and web `expo export`.
- **In a headless browser:** Chrome with `--remote-debugging-port` and small DevTools
  protocol scripts that load the app, click by `aria-label`, wait for text and collect
  console errors. Those scripts lived in the session's scratch folder, not in the repo.
- **Trusted input:** the photo picker only opens on a trusted click
  (`Input.dispatchMouseEvent`). With `Page.setInterceptFileChooserDialog` and
  `DOM.setFileInputFiles`, a generated test image can be set as a background.
- **The card frost alignment:** compare the bounding rectangles of the background photo
  and each card's copy. They were identical, and after a 300-point scroll the cards moved
  300 while the copies stayed on the photo.
- **The phone:** the browser cannot show iOS glass, native controls or the frosted look.
  The owner's phone screenshots are the real check for those.

## Still rough, and ideas

None of these are orders.

- **Text fields:** each screen styles its own, so they are not glass yet. A shared field
  style would remove that duplication.
- **Toned notice cards** (warn, info) are glossy solid colours with dark ink. On the
  glass look they may read heavy; tinted glass with light text would need each screen's
  text colours changed.
- **The screen-by-screen pass** has not been done: Entreno, Comida, Transit, charts,
  Ajustes and the forms.
- **Card frost alignment:**
  - It can go stale if a card's ancestor moves without the content height changing.
  - During a tab swipe the copy travels with the card.
  - Reanimated's UI-thread `measure` could keep it exact every frame, with a cost to weigh.
- **Performance:** not measured on the device. Each card over a photo holds a small blurred
  bitmap, and the floating glass is live. If a screen stutters, measure before changing
  anything (React Profiler, Instruments).
- **Accessibility:** the "Reduce Transparency" setting is not honoured yet.
  `AccessibilityInfo.isReduceTransparencyEnabled()` exists.
- **The bubble during a swipe:** it does not follow the finger. React Navigation's native
  bottom tabs (`@react-navigation/bottom-tabs` 7.20.0 was built against our
  react-native-screens 4.26.2) would give Apple's exact bar, but they drop the
  finger-following swipe. He chose to keep the swipe.
- **Segmented control drag lens:** some developers reported it unreliable in early iOS 26
  builds. It is still unconfirmed on his phone.
- **Standalone build:** nothing here has been seen in an IPA yet. Glass and the native
  controls depend on building with Xcode 26, which the CI's macOS 26 runner should have.
- **Screen list:** `BackgroundsScreen` keeps its own list of screen names, which can drift
  from the routes in `App.tsx`.
