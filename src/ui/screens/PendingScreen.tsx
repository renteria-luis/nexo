import { Text } from 'react-native';

import { Card } from '../Card.tsx';
import { font, sheet } from '../theme.ts';

import { Screen } from './Screen.tsx';

/**
 * A tab whose module has not been built yet. It says so plainly instead of showing
 * an empty page that reads as broken.
 */
export function PendingScreen({ title, note }: { title: string; note: string }) {
  return (
    <Screen title={title}>
      {/* Sin relieve: lo que no se puede tocar no se levanta del papel. */}
      <Card raised={false}>
        <Text style={styles.note}>{note}</Text>
      </Card>
    </Screen>
  );
}

const styles = sheet((theme) => ({
  note: {
    fontSize: 14,
    fontFamily: font.regular,
    color: theme.textFaint,
  },
}));
