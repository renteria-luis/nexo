import { Text, View } from 'react-native';
import { Check } from 'lucide-react-native';

import {
  PALETTE_NAMES,
  PREVIEW_SCORES,
  colorForScore,
  fillForScore,
  type PaletteId,
} from '../core/palettes.ts';

import { Card } from './Card.tsx';
import { ScoreCell } from './DisciplineGrid.tsx';
import { font, sheet, shape, theme } from './theme.ts';

const ORDER: PaletteId[] = ['deutan', 'standard', 'tritan'];

/**
 * Spec 4.5: the palette is chosen on first run from a live preview showing a sample
 * row of scores from 0 to 100, rather than from three names that mean nothing until
 * you see them.
 */
export function PalettePicker({
  selected,
  onSelect,
}: {
  selected: PaletteId;
  onSelect: (palette: PaletteId) => void;
}) {
  return (
    <View style={styles.list}>
      {ORDER.map((palette) => {
        const isSelected = palette === selected;
        return (
          <Card
            key={palette}
            accessibilityLabel={`Usar la paleta ${PALETTE_NAMES[palette]}`}
            onPress={() => onSelect(palette)}
            // Elegida se levanta del papel; las otras dos se quedan planas.
            raised={isSelected}
          >
            <View style={styles.head}>
              <View style={[styles.mark, isSelected && styles.markOn]}>
                {isSelected ? <Check size={13} color={theme.accentInk} strokeWidth={3} /> : null}
              </View>
              <Text style={styles.name}>{PALETTE_NAMES[palette]}</Text>
            </View>
            <View style={styles.sample}>
              {PREVIEW_SCORES.map((score) => (
                <ScoreCell
                  key={score}
                  color={colorForScore(score, palette)}
                  fill={fillForScore(score)}
                  size={18}
                />
              ))}
            </View>
            <Text style={styles.scale}>0 a 100</Text>
          </Card>
        );
      })}
    </View>
  );
}

const styles = sheet((theme) => ({
  list: {
    alignSelf: 'stretch',
    gap: 10,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mark: {
    width: 20,
    height: 20,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: 5,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markOn: {
    backgroundColor: theme.accent,
  },
  name: {
    fontSize: 15,
    fontFamily: font.black,
    color: theme.text,
  },
  sample: {
    flexDirection: 'row',
    gap: 3,
  },
  scale: {
    fontSize: 11,
    color: theme.textFaint,
    fontFamily: font.bold,
  },
}));
