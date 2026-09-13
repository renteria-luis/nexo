import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { openDatabase, readDatabaseStatus, type DatabaseStatus } from './src/db';

type Screen =
  | { phase: 'opening' }
  | { phase: 'ready'; status: DatabaseStatus }
  | { phase: 'failed'; message: string };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ phase: 'opening' });

  useEffect(() => {
    let cancelled = false;

    openDatabase()
      .then(readDatabaseStatus)
      .then((status) => {
        if (!cancelled) setScreen({ phase: 'ready', status });
      })
      .catch((error: unknown) => {
        // A database that will not open is not a state the app can carry on in,
        // so it goes on the screen rather than into a swallowed promise.
        console.error(error);
        const message = error instanceof Error ? error.message : String(error);
        if (!cancelled) setScreen({ phase: 'failed', message });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>nexo</Text>

      {screen.phase === 'opening' && <ActivityIndicator accessibilityLabel="Abriendo la base" />}

      {screen.phase === 'ready' && (
        <Text style={styles.detail}>
          {screen.status.tableCount} tablas, {screen.status.appliedMigrations.length} migraciones
          aplicadas
        </Text>
      )}

      {screen.phase === 'failed' && (
        <Text style={styles.error}>No abrió la base de datos: {screen.message}</Text>
      )}

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    padding: 24,
    gap: 12,
  },
  title: {
    fontSize: 20,
  },
  detail: {
    fontSize: 14,
    color: '#444',
  },
  error: {
    fontSize: 14,
    color: '#8a1f11',
    textAlign: 'center',
  },
});
