import { Text, View } from 'react-native';

import {
  PALETTE_NAMES,
  PREVIEW_SCORES,
  colorForScore,
  fillForScore,
  type PaletteId,
} from '../core/palettes.ts';

import { Card } from './Card.tsx';
import { ScoreCell } from './DisciplineGrid.tsx';
import { Toggle } from './Toggle.tsx';
import { font, sheet } from './theme.ts';

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
            accessibilityLabel={`Paleta ${PALETTE_NAMES[palette]}`}
            onPress={() => onSelect(palette)}
            // Elegida se levanta del papel; las otras dos se quedan planas.
            raised={isSelected}
          >
            <View style={styles.head}>
              <View style={styles.headText}>
                <Text style={styles.name}>{PALETTE_NAMES[palette]}</Text>
                <Text style={styles.scale}>0 a 100</Text>
              </View>
              {/* Siempre hay una paleta puesta, asi que apagar la que esta elegida no
                  significa nada: cualquier toque en la fila elige la suya. */}
              <Toggle
                value={isSelected}
                accessibilityLabel={`Usar la paleta ${PALETTE_NAMES[palette]}`}
                onChange={() => onSelect(palette)}
              />
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
    justifyContent: 'space-between',
    gap: 10,
  },
  headText: {
    flexShrink: 1,
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
