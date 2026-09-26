# Sliders that do not fight the swipe

Research only. Nothing in the app uses a slider today: the RPE one was removed in
September 2026 because dragging it stole the swipe between tabs, and it came back as
minus and plus steppers. This is what to do when it returns.

## The problem, stated properly

The tabs are a pager (`react-native-pager-view`, through
`@react-navigation/material-top-tabs`). A horizontal drag inside a page is ambiguous:
it can mean "move the slider" or "go to the next tab", and **the native side has to
decide synchronously while JavaScript can only answer asynchronously**. That is the
whole reason the first attempt failed, and it is a documented limitation of the JS
responder system, not a bug in the app.

So any solution has to make the decision on the native side, or take the pager out of
the argument while the finger is down.

## The three approaches that work

### 1. Turn the pager off while dragging (no new dependency)

The pager accepts `swipeEnabled`. Set it to false when the slider's touch starts and
back to true when it ends. It costs one piece of state lifted to the navigator and no
libraries.

Caveats found in the wild:
- On iOS `scrollEnabled={false}` has been reported as **not respected** on the pager
  ([issue #1058](https://github.com/callstack/react-native-pager-view/issues/1058)),
  while `swipeEnabled` is the prop `material-top-tabs` actually forwards. Test on the
  device before trusting it.
- The flag has to flip on `onTouchStart` of the slider, not on the first move, or the
  pager already owns the gesture.

### 2. Gesture Handler with offset thresholds (the standard answer)

With `react-native-gesture-handler`, a `Gesture.Pan()` configured as

```ts
Gesture.Pan()
  .activeOffsetX([-10, 10])   // se activa al moverse en horizontal
  .failOffsetY([-5, 5])       // y se rinde si el dedo va en vertical
```

lets the native side decide: the slider claims horizontal movement, the scroll keeps
vertical. To beat the pager specifically, gesture-handler exposes
`blocksExternalGesture(nativeGesture)`, which is the documented way to say "this pan
wins over that native scroll".

### 3. `react-native-awesome-slider` (the finished version of #2)

Built on Reanimated shared values and gesture-handler, it runs the drag on the UI
thread and states outright that it does not interfere with swipe gestures. It is the
smooth one.

## The catch for this project, and it is the important part

Both #2 and #3 need **Reanimated**, and Reanimated is what crashed the app on
2026-09-21: `react-native-keyboard-controller` pulled Reanimated 4.7, which needs
`react-native-worklets` 0.13, outside the 0.7 to 0.10 range this Expo SDK's
`expo-modules-core` supports. The app died at startup with
`TypeError: undefined is not a function` inside `installUnpackers`.

So the order is:

1. **Try #1 first.** No dependency, half an hour of work, and if it holds on the
   device the problem is solved.
2. If #1 is not enough, check with `npx expo install --check` which Reanimated version
   this SDK actually wants, install **that** one and no other, and only then add
   gesture-handler and the slider.
3. Never install a slider library without pinning Reanimated through `expo install`.

## What a slider has to earn

The RPE slider was replaced by steppers and nothing was lost: between one set and the
next, two taps beat a drag with sweaty hands. A slider is worth it where the value is
continuous and the exact number does not matter much (a rest timer, a percentage), not
where he types a figure he knows.

Sources: [pager-view scrollEnabled on iOS](https://github.com/callstack/react-native-pager-view/issues/1058),
[pan inside a ScrollView](https://github.com/software-mansion/react-native-gesture-handler/issues/1933),
[composing gestures with ScrollView](https://github.com/software-mansion/react-native-gesture-handler/issues/2616),
[react-native-awesome-slider](https://www.npmjs.com/package/react-native-awesome-slider),
[@react-native-community/slider](https://docs.expo.dev/versions/latest/sdk/slider/).
