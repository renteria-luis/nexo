---
name: nexo
description: A personal iOS logbook for training, food and getting around, in warm dark glass with one amber light.
colors:
  accent: "#ffb36b"
  accent-ink: "#1d1510"
  accent-ink-soft: "rgba(29, 21, 16, 0.68)"
  bg: "#17110d"
  surface: "rgba(255, 255, 255, 0.07)"
  surface-high: "rgba(255, 255, 255, 0.12)"
  surface-warm: "rgba(255, 255, 255, 0.16)"
  surface-solid: "#271e18"
  glass: "rgba(0, 0, 0, 0.22)"
  line: "rgba(255, 255, 255, 0.14)"
  line-soft: "rgba(255, 255, 255, 0.09)"
  text: "#fbf7f3"
  text-dim: "rgba(255, 245, 235, 0.84)"
  text-faint: "rgba(255, 245, 235, 0.66)"
  text-ghost: "rgba(255, 245, 235, 0.42)"
  ok: "#8fdca6"
  ok-bg: "rgba(143, 220, 166, 0.16)"
  warn: "#ffe08a"
  warn-bg: "rgba(255, 224, 138, 0.16)"
  danger: "#ff9f9a"
  info: "#a9c4ff"
  protein: "#76dbda"
  blob-ember: "#ff9646"
  blob-rose: "#d65878"
  blob-dusk: "#5484c4"
  score-zero: "#38383c"
  score-green-1: "#2a6b41"
  score-green-2: "#3a9659"
  score-green-3: "#5cc47d"
  score-green-4: "#a8f0c0"
typography:
  display:
    fontFamily: "Plus Jakarta Sans"
    fontSize: "34px"
    fontWeight: 800
    lineHeight: "38px"
    letterSpacing: "-1px"
    fontFeature: "tnum"
  headline:
    fontFamily: "Plus Jakarta Sans"
    fontSize: "27px"
    fontWeight: 800
    letterSpacing: "-0.5px"
  title:
    fontFamily: "Plus Jakarta Sans"
    fontSize: "16px"
    fontWeight: 800
  button:
    fontFamily: "Plus Jakarta Sans"
    fontSize: "15px"
    fontWeight: 800
  body:
    fontFamily: "Plus Jakarta Sans"
    fontSize: "14px"
    fontWeight: 700
  note:
    fontFamily: "Plus Jakarta Sans"
    fontSize: "12px"
    fontWeight: 400
  label:
    fontFamily: "Plus Jakarta Sans"
    fontSize: "11px"
    fontWeight: 800
    letterSpacing: "0.6px"
rounded:
  cell: "4px"
  small: "14px"
  chip: "19px"
  card: "22px"
  button: "26px"
  island: "30px"
  large: "31px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  gutter: "20px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    height: "44px"
    padding: "0 16px"
  button-primary-large:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.button}"
    height: "52px"
    padding: "0 20px"
  button-secondary:
    backgroundColor: "rgba(255, 255, 255, 0.05)"
    textColor: "{colors.text}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    height: "44px"
    padding: "0 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-faint}"
    typography: "{typography.button}"
    height: "40px"
    padding: "0 8px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    height: "44px"
    padding: "0 16px"
  chip:
    backgroundColor: "rgba(255, 255, 255, 0.05)"
    textColor: "{colors.text}"
    rounded: "{rounded.chip}"
    height: "38px"
    padding: "0 14px"
  chip-selected:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.chip}"
    height: "38px"
    padding: "0 14px"
  card:
    backgroundColor: "rgba(255, 255, 255, 0.03)"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
    padding: "16px"
  card-accent:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.card}"
    padding: "16px"
  sheet:
    backgroundColor: "{colors.surface-solid}"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
    padding: "14px"
  search-field:
    backgroundColor: "rgba(255, 255, 255, 0.05)"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.card}"
    padding: "9px 14px"
  tab-island:
    backgroundColor: "{colors.glass}"
    textColor: "{colors.text}"
    rounded: "{rounded.island}"
    height: "60px"
    width: "70%"
    padding: "6px"
  top-bar-button:
    backgroundColor: "{colors.glass}"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
    size: "44px"
  score-cell:
    backgroundColor: "{colors.score-green-3}"
    rounded: "{rounded.cell}"
---

# Design System: nexo

## Overview

**Creative North Star: "Amber Night Glass"**

A warm night seen through glass. The screen is a dark, faintly warm room lit by soft blobs of ember, rose and dusk blue (or a photo he chose), and everything he reads sits on translucent panels that catch a little light along their top edge. One amber light marks what he can act on. The feel is calm and premium, like Apple's own apps after dark: soft highlights, fine edges, nothing harsh, so it can stay open for a whole gym session without tiring the eye.

It is also an instrument. Numbers are the content: sets, loads, protein, minutes to the bus. They are set in tabular figures, aligned, and given the largest type on the screen. Being precise is not the same as being bare, though. Stats and charts are where the system is allowed to be rich (gradients, glow, colour by series), because that is where the work of the day becomes visible. What is not allowed is clutter: captions, explanatory subtitles and data he will not act on.

Dark is the only appearance today. A light appearance is welcome if it can be built just as clean and as beautiful; that would be a new decision, designed as a peer of the dark one, never an inversion of it.

**Key Characteristics:**
- Warm near-black ground with chosen backgrounds per screen (blobs, gradient, colour or his own photo).
- Translucent glass panels with a light top edge and a soft shadow; real iOS Liquid Glass only on what floats.
- One amber accent; every filled colour carries dark ink.
- Plus Jakarta Sans throughout, heavy weights, tabular numerals.
- Continuous iOS corners and capsule controls.
- Generous where it reads (numbers, charts), quiet everywhere else.

## Colors

A warm umber night with light, cream-tinted text and a single glowing amber.

### Primary
- **Lantern Amber** (`accent`): the one interactive tint. The main action of a screen, a selected chip, a toggle's track, the put-away spot for the assistant ball when it is about to land. It is always a filled "gloss" droplet with dark ink on it, never thin amber text on dark.
- **Amber Ink** (`accent-ink`, `accent-ink-soft`): the dark warm brown written on top of every filled colour, amber or status. It keeps filled things readable without white text.

### Neutral
- **Night Umber** (`bg`): what sits under every background while it loads or where it does not reach.
- **Glass Veil** (`surface`, `surface-high`, `surface-warm`): white at 7, 12 and 16 percent, for translucent panels and rows that step up in emphasis.
- **Sheet Umber** (`surface-solid`): the opaque warm brown of sheets, bubbles, menus and alerts, anything floating over content.
- **Glass Tint** (`glass`): the 22 percent dark tint laid on Liquid Glass, and the fallback fill where iOS does not draw it (browser, older iOS).
- **Light Edge** (`line`, `line-soft`): the hairline that outlines cards, fields and squares; the softer one for flat or off states.
- **Candle White** (`text`) and its three warm steps (`text-dim` 84, `text-faint` 66, `text-ghost` 42 percent): primary reading text, secondary text, notes and labels, placeholders and disabled.

### Status
- **Sage** (`ok`, `ok-bg`), **Butter** (`warn`, `warn-bg`), **Coral** (`danger`), **Periwinkle** (`info`): light pastel fills for state. Filled, they carry Amber Ink; as text they sit on the dark ground. The `-bg` variants are 16 percent washes for a quieter row.

### Goals
- **Periwinkle** (`info`) and **Aqua** (`protein`): the two daily food goals, calories and protein, as filled tiles with Amber Ink. Protein has its own hue so a met goal never reads as an error. The other nutrient tiles share the same shape on Glass Veil; a value past its limit says so in Butter text on its note, not with another fill.

### Backgrounds
- **Ember, Rose and Dusk** (`blob-ember`, `blob-rose`, `blob-dusk`): the default background's three soft blobs. Each screen can instead use a colour, a gradient or a photo, with darken and blur, chosen in Ajustes, Fondos.

### Score squares
- **Score Green** (`score-green-1` to `-4`) and **Score Zero** (`score-zero`): the default palette of the discipline grid, running dark to bright so a better day stands out more; a recorded zero is a neutral grey below the first step. Four more palettes with the same structure (pink, red, blue, grey) live in `src/core/palettes.ts` and are chosen in Ajustes. Transit line colours (`src/ui/routeColors.ts`) identify bus routes and are outside this system.

### Named Rules
**The One Light Rule.** Amber is the only interactive tint. Status colours report state; they never stand in for a button.

**The Dark Ink Rule.** Anything filled with colour (amber, sage, butter, coral, periwinkle) is written in Amber Ink, never white.

**The Lightness Ladder Rule.** Score palettes step by lightness from dark to bright, with every step brighter than the one before (a test enforces it). This applies to the score squares only; elsewhere hue is chosen freely.

## Typography

**Display Font:** Plus Jakarta Sans ExtraBold (800)
**Body Font:** Plus Jakarta Sans Bold (700) and Regular (400)

**Character:** One geometric humanist family carries everything, leaning on its heavy weights. The ExtraBold numbers give the instrument its voice; Regular is reserved for quiet notes.

### Hierarchy
- **Display** (800, 34px, 38px line, -1px tracking, tabular): the day's score and the big number of a card. Larger cuts exist for a single hero number: 44px for the rest on the set card, 52px on a day's detail, 96px for the rest timer in landscape.
- **Headline** (800, 27px, -0.5px tracking): the title of a screen, one per screen.
- **Title** (800, 16 to 18px): card titles, exercise and food names.
- **Button** (800, 15px; 17px on large buttons): button and top-bar labels.
- **Body** (700, 13 to 15px): the main reading text and values in rows.
- **Note** (400, 12 to 13px, `text-faint`): secondary lines, hints, timestamps.
- **Label** (800, 11px, 0.6px tracking, uppercase, `text-faint`): section labels inside cards and the side menu. The tab bar's labels are 700 at 11px, not uppercase.

### Named Rules
**The Tabular Rule.** Every number that can change (weights, reps, grams, minutes, scores) uses tabular figures, so a column of values never shifts as it updates.

**The Heavy Voice Rule.** Hierarchy comes from weight and size inside one family; no second typeface is introduced.

## Layout

A single scrolling column per screen with a 20px gutter, 14px of top air under the top bar, and 12px between cards. Inside a card, 16px of padding and 8px between its pieces. Spacing steps are 4, 6, 8, 10, 12, 16 and 20px.

The top-level screens (Hoy, Entreno, Comida) sit in a horizontal pager that follows the finger, under a floating tab island and a top bar with round glass buttons. Every screen leaves room at the bottom for the floating island so its last card is never covered. Pushed screens slide in from the right with their own opaque background. Sheets centre on screen at the height they need rather than filling it.

The app is portrait. The one screen that rotates is the rest view in Entreno: turning the phone sideways mid-workout shows the rest time, the exercise and the last set, huge and untouchable, to read from the bench. One hand, short glances: controls the thumb needs sit low and large.

## Elevation & Depth

Depth is layered glass, in four planes, each with one job:

1. **Background:** blobs, gradient, colour or photo, chosen per screen, drawn opaque by each screen.
2. **Panels:** cards are translucent. Each darkens what is behind it by 25 percent and, over a photo, draws its own blurred copy of the piece it covers, then lays a light gradient from the top left, a bright inner top edge, a dark inner bottom edge and a soft drop shadow.
3. **Floating layer:** the tab island, the side menu, the assistant ball and the top-bar buttons are real iOS 26 Liquid Glass (clear, light variant, 22 percent dark tint), with a highlight and a soft shadow.
4. **Sheets:** opaque Sheet Umber, over the screen blurred by 20 points behind a 50 percent veil.

### Shadow Vocabulary
- **Panel** (`0 10px 28px rgba(0,0,0,0.28)` with `inset 0 1px 0 rgba(255,255,255,0.28)` and `inset 0 -1px 0 rgba(0,0,0,0.22)`): cards.
- **Control** (`0 4px 12px rgba(0,0,0,0.25)` with `inset 0 1px 0 rgba(255,255,255,0.35)` and `inset 0 -1px 0 rgba(0,0,0,0.25)`): secondary buttons, chips, fields, anything touchable on a card.
- **Gloss** (`0 6px 16px rgba(0,0,0,0.3)` with `inset 0 1px 1px rgba(255,255,255,0.85)` and `inset 0 -2px 4px rgba(0,0,0,0.12)`, plus a white highlight fading out by the middle): filled colour, like a droplet of coloured glass.

### Named Rules
**The Floating Glass Rule.** Real Liquid Glass belongs only to what floats over content. Cards are translucent panels; over a smooth background they look the same at no cost.

**The Opaque Sheet Rule.** Anything that floats over content (sheet, bubble, alert, menu) is opaque, so two layers of text are never read at once.

## Shapes

Everything uses iOS's continuous corners. Cards round at 22px, small inner pieces (time slots, inline fields, the scale legend) at 14px, and every control is a full capsule: buttons (26px on a 44px height), chips (19px on 38px), the search field, the tab island and the assistant ball. Edges are a 1px light hairline, never a dark outline. The score squares are the one near-square shape (4px corners), solid with no proportional fill.

## Components

### Buttons
Glass droplets that invite the thumb.
- **Shape:** full capsule (26px radius), 44px tall, 52px when large.
- **Primary:** Lantern Amber gloss with Amber Ink label and optional 16px line icon. One per screen.
- **Secondary:** glass control with Candle White label.
- **Ghost:** text only in `text-faint`, 40px tall, for the least important action.
- **Danger:** Coral gloss with Amber Ink.
- **Pressed:** dims to 72 percent and shrinks to 98 percent, visible from the corner of the eye. Loading turns the icon into a spinner and refuses another tap. Disabled loses its glass and sits on the soft edge.

### Chips
- **Style:** 38px capsule, 13px bold label, optional 14px icon.
- **State:** selected is an amber gloss with dark ink; unselected is glass control with light text. They act as radio options for short lists (phase, unit, filters).

### Cards / Containers
The "cartilla": every block of information is one.
- **Corner Style:** 22px continuous.
- **Background:** translucent glass panel with frost of what is behind (see Elevation).
- **Tones:** accent, ok, warn, info and danger fill the card with that colour's gloss and switch its text to Amber Ink, for what must catch the eye.
- **Border:** 1px Light Edge; a flat variant uses the soft edge.
- **Internal Padding:** 16px, 8px between pieces; a title (Title style) with an optional small action on its right.
- **Pressable cards** shrink and dim like a button.

### Inputs / Fields
- **Style:** the iOS system keyboard always (dictation, accents, swipe typing), with the app's own bar above it carrying the done key. Fields are glass control capsules or rounded rectangles; the search field is a 22px capsule with 15px bold text and `text-ghost` placeholder.
- **Focus:** content scrolls so the field sits above the keyboard.

### Navigation
- **Tab island:** a floating Liquid Glass capsule at 70 percent of the width, 60px tall, clear of the screen's rounded corners. iOS's own segmented control lies inside it, invisible, so iOS 26 draws the sliding bubble and the lens under the finger; the app's icons and 11px labels are drawn on top. Swiping between the three tabs still follows the finger.
- **Top bar:** round 44px glass buttons (Ajustes, the assistant's parking spot) and the date in bold.
- **Side menu:** glass, with uppercase section labels.
- **Toggles:** the native iOS switch with an amber track.

### Signature: the discipline grid
Twelve Monday-to-Sunday weeks of small squares, 2px apart, with Spanish month labels above and a "Menos … Más" legend below. Solid squares in the chosen score palette; a recorded zero is Score Zero grey; a day without data is an empty outlined square; today has a 2px Candle White outline. It scrolls back through history with its own bounce, without handing the drag to the tabs.

### Signature: the assistant ball
A 56px glass orb floating over every screen. Tap opens the chat; drag moves the ball and chat together; let go and it settles on the nearest side. Dropped on the dashed circle beside Ajustes (which turns solid amber under it), it shrinks into the top bar and stays put away.

### Signature: chosen backgrounds
Each screen draws the background he picked, framed by dragging and pinching on the real screen, with darken and blur. The three tabs blend their backgrounds as the pager slides.

## Do's and Don'ts

### Do:
- **Do** keep amber for the one action, the selected state and toggles, always filled, always with Amber Ink on top.
- **Do** keep real Liquid Glass on the floating layer only: tab island, side menu, assistant ball, top-bar buttons.
- **Do** make every sheet, bubble, menu and alert opaque Sheet Umber over a blurred screen.
- **Do** set every changing number in tabular figures, and give the number the biggest type on its card.
- **Do** let charts and statistics be rich: gradients, glow and colour by series are welcome there.
- **Do** start every button at 44px tall and use continuous corners everywhere.
- **Do** test over a bright photo background, not only the default blobs: a card must still read.

### Don't:
- **Don't** go back to neobrutalism: thick black borders, hard offset shadows, flat paper colours.
- **Don't** put Liquid Glass on cards or lists.
- **Don't** crowd a screen: no captions under charts, no explanatory subtitles, no data he will not act on.
- **Don't** write white text on a filled colour, or use thin amber text as a button.
- **Don't** add a second interactive tint; status colours report, they do not invite a tap.
- **Don't** make a sheet translucent over content.
- **Don't** limit hue choices for colour blindness outside the score squares.
