import type { ReactNode } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text } from 'react-native';

import { useAppData } from '../../shell/AppData.tsx';

/**
 * The frame every tab shares: scrolls, paints the full height so nothing shows
 * through underneath, and refuses to render its contents until the database is
 * open. A screen that opened on a failed database would look empty rather than
 * broken.
 */
export function Screen({ title, children }: { title?: string; children: ReactNode }) {
  const { state } = useAppData();

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      {title ? <Text style={styles.title}>{title}</Text> : null}

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
    backgroundColor: '#fff',
  },
  content: {
    flexGrow: 1,
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 40,
    gap: 12,
  },
  title: {
    fontSize: 20,
  },
  error: {
    fontSize: 14,
    color: '#8a1f11',
    textAlign: 'center',
  },
});
