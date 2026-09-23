import type { ReactNode } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text } from 'react-native';

import { useAppData } from '../../shell/AppData.tsx';
import { NUMBER_PAD_HEIGHT, useNumberPad } from '../NumberPadHost.tsx';
import { mono, theme } from '../theme.ts';

/**
 * The frame every tab shares: scrolls, paints the full height so nothing shows
 * through underneath, and refuses to render its contents until the database is
 * open. A screen that opened on a failed database would look empty rather than
 * broken.
 *
 * El teclado se resuelve con las tres propiedades que ya trae el ScrollView de iOS y
 * sin ninguna libreria: la app arrancaba con un TypeError porque el paquete que se
 * usaba antes arrastraba reanimated 4, que pide una version de worklets que este SDK
 * de Expo todavia no soporta.
 */
export function Screen({ title, children }: { title?: string; children: ReactNode }) {
  const { state } = useAppData();
  const pad = useNumberPad();

  return (
    <ScrollView
      // El campo enfocado nunca queda debajo del teclado.
      automaticallyAdjustKeyboardInsets
      // Un toque en un boton con el teclado abierto lo pulsa a la primera; uno en
      // cualquier otro sitio sigue cerrando el teclado.
      keyboardShouldPersistTaps="handled"
      // Y arrastrar hacia abajo lo baja siguiendo el dedo.
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      style={styles.scroll}
      // Con el teclado de la app abierto, el contenido se puede seguir subiendo para
      // sacar de debajo el campo que se esta escribiendo.
      contentContainerStyle={[styles.content, pad.isOpen && { paddingBottom: NUMBER_PAD_HEIGHT }]}
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
    </ScrollView>
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
