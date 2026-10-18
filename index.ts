import { registerRootComponent } from 'expo';

// First: iOS can deliver a trip's location readings before any screen exists.
import './src/shell/trip-task.ts';
// Nothing uses Reanimated yet. Importing it starts its runtime at launch, so a version
// mismatch like the 2026-09-21 crash shows on the first build instead of mid-redesign.
// Remove once a screen imports it.
import 'react-native-reanimated';
import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
