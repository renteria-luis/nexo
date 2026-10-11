// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier/flat');

module.exports = defineConfig([
  expoConfig,
  // Last: turns off the stylistic rules Prettier already owns.
  prettierConfig,
  {
    // transit-live is its own Node project, checked by its own install, types and tests.
    ignores: ['dist/*', 'transit-live/**'],
  },
  {
    // Los scripts sueltos corren en node, no en el telefono: ahi Buffer existe y la
    // configuracion de Expo no lo declara.
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { Buffer: 'readonly' } },
  },
]);
