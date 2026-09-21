import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  PALETTE_NAMES,
  PREVIEW_SCORES,
  colorForScore,
  fillForScore,
  type PaletteId,
} from '../core/palettes.ts';

import { ScoreCell } from './DisciplineGrid.tsx';
import { mono, theme } from './theme.ts';

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
          <Pressable
            key={palette}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
            onPress={() => onSelect(palette)}
            style={[styles.option, isSelected && styles.optionSelected]}
          >
            <Text style={styles.name}>
              {isSelected ? '● ' : '○ '}
              {PALETTE_NAMES[palette]}
            </Text>
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
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    alignSelf: 'stretch',
    gap: 10,
  },
  option: {
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 8,
    padding: 10,
    gap: 6,
  },
  optionSelected: {
    borderColor: theme.lineStrong,
  },
  name: {
    fontSize: 13,
    fontFamily: mono,
    color: theme.text,
  },
  sample: {
    flexDirection: 'row',
    gap: 3,
  },
  scale: {
    fontSize: 10,
    color: theme.textGhost,
    fontFamily: mono,
  },
});
