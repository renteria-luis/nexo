import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { useAppData } from '../../shell/AppData.tsx';
import { mono, theme } from '../theme.ts';

/**
 * The frame every tab shares: scrolls, paints the full height so nothing shows
 * through underneath, and refuses to render its contents until the database is
 * open. A screen that opened on a failed database would look empty rather than
 * broken.
 *
 * El scroll es el de react-native-keyboard-controller y no el de React Native:
 * KeyboardAvoidingView empuja la pantalla entera y dentro de un scroll deja el campo
 * igual de tapado, mientras que este sigue al teclado cuadro a cuadro y sube justo el
 * campo enfocado. Es lo que se usa hoy para esto y trae modulo nativo, asi que la app
 * ya no corre en Expo Go: se instala desde el IPA.
 */
export function Screen({ title, children }: { title?: string; children: ReactNode }) {
  const { state } = useAppData();

  return (
    <KeyboardAwareScrollView
      bottomOffset={24}
      style={styles.scroll}
      contentContainerStyle={styles.content}
    >
      {title ? (
        <Text style={styles.title}>
          <Text style={styles.prompt}>$ </Text>
          {title.toLowerCase()}
        </Text>
      ) : null}

      {state.phase === 'opening' && <ActivityIndicator accessibilityLabel="Abriendo la base" />}

      {state.phase === 'failed' && (
        <Text style={styles.error}>No abrió la base de datos: {state.message}</Text>
      )}

      {state.phase === 'ready' && children}
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  content: {
    flexGrow: 1,
    backgroundColor: theme.bg,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 40,
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontFamily: mono,
    color: theme.text,
  },
  prompt: {
    color: theme.accent,
  },
  error: {
    fontSize: 14,
    color: theme.danger,
    textAlign: 'center',
  },
});
