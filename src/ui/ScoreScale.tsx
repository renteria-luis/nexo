import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import {
  DEFAULT_SCORE_SCALE,
  NO_DATA_COLOR,
  SCORE_PALETTES,
  scoreLevels,
  scoreScaleProblem,
  type ScorePalette,
  type ScoreScaleOptions,
} from '../core/palettes.ts';
import { Button } from './Button.tsx';
import { Card } from './Card.tsx';
import { ScoreCell } from './DisciplineGrid.tsx';
import { NumericField } from './NumericField.tsx';
import { font, sheet, shape } from './theme.ts';

export function ScoreScale({
  value,
  onSave,
}: {
  value: ScoreScaleOptions;
  onSave: (scale: ScoreScaleOptions) => Promise<void>;
}) {
  const [palette, setPalette] = useState(value.palette);
  const [limits, setLimits] = useState([
    String(value.lowMax),
    String(value.mediumMax),
    String(value.topMin),
  ]);
  const [error, setError] = useState<string | null>(null);
  // Lo que llega por otro camino (un respaldo importado, la base borrada) manda sobre lo
  // escrito: lo escrito ya se guardo al soltarlo.
  const [seen, setSeen] = useState(JSON.stringify(value));
  if (seen !== JSON.stringify(value)) {
    setSeen(JSON.stringify(value));
    setPalette(value.palette);
    setLimits([String(value.lowMax), String(value.mediumMax), String(value.topMin)]);
  }
  const draft = {
    palette,
    lowMax: parse(limits[0]),
    mediumMax: parse(limits[1]),
    topMin: parse(limits[2]),
  };
  const problem = scoreScaleProblem(draft);
  // Se guarda solo, como el resto de Ajustes: el boton propio dejaba la paleta pintada
  // como elegida aunque saliera sin tocarlo (2026-10-24).
  const save = (next: ScoreScaleOptions) => {
    if (JSON.stringify(next) === JSON.stringify(value)) return;
    setError(null);
    onSave(next).catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar.'),
    );
  };
  const preview = problem ? { ...value, palette } : draft;
  return (
    <Card title="Colores de cumplimiento">
      <Text style={styles.help}>
        Elige los tonos y sus límites. Solo cambia el color: tu puntuación y tus rachas siguen
        igual.
      </Text>
      {(Object.keys(SCORE_PALETTES) as ScorePalette[]).map((id) => (
        <Pressable
          key={id}
          accessibilityRole="radio"
          accessibilityLabel={`Paleta ${SCORE_PALETTES[id].name}`}
          aria-checked={palette === id}
          onPress={() => {
            setPalette(id);
            save({ ...(problem ? value : draft), palette: id });
          }}
          style={[styles.palette, palette === id && styles.selected]}
        >
          <Text style={styles.name}>{SCORE_PALETTES[id].name}</Text>
          {SCORE_PALETTES[id].colors.map((color) => (
            <ScoreCell key={color} color={color} size={18} />
          ))}
        </Pressable>
      ))}
      {['Bajo hasta', 'Medio hasta', 'Muy alto desde'].map((label, index) => (
        <View key={label} style={styles.row}>
          <Text style={styles.label}>{label}</Text>
          <NumericField
            accessibilityLabel={`${label} (%)`}
            value={limits[index]}
            allowDecimal
            onChange={(next) => setLimits((old) => old.map((v, i) => (i === index ? next : v)))}
            onCommit={() => {
              if (problem === null) save(draft);
            }}
            style={styles.input}
          />
          <Text style={styles.labelUnit}>%</Text>
        </View>
      ))}
      {problem && (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          Sin guardar: {problem}
        </Text>
      )}
      <Text style={styles.help}>Vista previa</Text>
      {scoreLevels(preview).map((level) => (
        <View key={level.label} style={styles.row}>
          <ScoreCell color={level.color} size={18} />
          <Text style={styles.label}>
            {level.label} · {level.range}
          </Text>
        </View>
      ))}
      <View style={styles.row}>
        <ScoreCell color={NO_DATA_COLOR} size={18} />
        <Text style={styles.label}>Sin datos o sin puntuación</Text>
      </View>
      {error && (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          Sin guardar: {error}
        </Text>
      )}
      <Button
        label="Restaurar límites 25 / 50 / 100"
        variant="ghost"
        disabled={
          draft.lowMax === DEFAULT_SCORE_SCALE.lowMax &&
          draft.mediumMax === DEFAULT_SCORE_SCALE.mediumMax &&
          draft.topMin === DEFAULT_SCORE_SCALE.topMin
        }
        onPress={() => {
          setLimits([
            String(DEFAULT_SCORE_SCALE.lowMax),
            String(DEFAULT_SCORE_SCALE.mediumMax),
            String(DEFAULT_SCORE_SCALE.topMin),
          ]);
          save({ ...DEFAULT_SCORE_SCALE, palette });
        }}
      />
    </Card>
  );
}

function parse(text: string): number {
  return text.trim() ? Number(text.replace(',', '.')) : NaN;
}

const styles = sheet((theme) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  palette: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 44,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: theme.lineSoft,
    borderRadius: shape.radiusSmall,
  },
  selected: { borderColor: theme.line, backgroundColor: theme.surfaceWarm },
  name: { flex: 1, fontSize: 13, fontFamily: font.bold, color: theme.text },
  label: { flex: 1, fontSize: 12, fontFamily: font.bold, color: theme.textDim },
  labelUnit: { fontSize: 12, fontFamily: font.bold, color: theme.textDim },
  // Lo justo para el numero: a 44 de alto los tres limites ocupaban media pantalla.
  input: {
    minWidth: 65,
    minHeight: 32,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: theme.lineSoft,
    borderRadius: shape.radiusSmall,
    paddingHorizontal: 8,
    fontSize: 16,
    fontFamily: font.bold,
    color: theme.text,
  },
  help: { fontSize: 12, fontFamily: font.regular, color: theme.textDim },
  error: { fontSize: 12, fontFamily: font.bold, color: theme.danger },
}));
