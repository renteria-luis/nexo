// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite runs on the web through wa-sqlite, which is a .wasm file. Metro
// does not treat .wasm as an asset by default, so the import fails to resolve.
config.resolver.assetExts.push('wasm');

module.exports = config;
