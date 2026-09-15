import { StyleSheet, Text, View } from 'react-native';

import { Screen } from './Screen.tsx';

/**
 * A tab whose module has not been built yet. It says so plainly instead of showing
 * an empty page that reads as broken.
 */
export function PendingScreen({ title, note }: { title: string; note: string }) {
  return (
    <Screen title={title}>
      <View style={styles.box}>
        <Text style={styles.note}>{note}</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 8,
    padding: 16,
  },
  note: {
    fontSize: 13,
    color: '#777',
    lineHeight: 19,
  },
});
