import { registerRootComponent } from 'expo';

// First: iOS can deliver a trip's location readings before any screen exists.
import './src/shell/trip-task.ts';
import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
