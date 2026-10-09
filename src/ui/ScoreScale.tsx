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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draft = {
    palette,
    lowMax: parse(limits[0]),
    mediumMax: parse(limits[1]),
    topMin: parse(limits[2]),
  };
  const problem = scoreScaleProblem(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(value);
  const [seen, setSeen] = useState(JSON.stringify(value));
  if (seen !== JSON.stringify(value)) {
    const wasSaved = JSON.stringify(draft) === seen;
    setSeen(JSON.stringify(value));
    if (wasSaved) {
      setPalette(value.palette);
      setLimits([String(value.lowMax), String(value.mediumMax), String(value.topMin)]);
    }
  }
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
          disabled={busy}
          onPress={() => setPalette(id)}
          style={[styles.palette, palette === id && styles.selected]}
        >
          <Text style={styles.name}>{SCORE_PALETTES[id].name}</Text>
          {SCORE_PALETTES[id].colors.map((color) => (
            <ScoreCell key={color} color={color} size={18} />
          ))}
        </Pressable>
      ))}
      {['Bajo hasta', 'Medio hasta', 'Tono más oscuro desde'].map((label, index) => (
        <View key={label} style={styles.row}>
          <Text style={styles.label}>{label}</Text>
          <NumericField
            accessibilityLabel={`${label} (%)`}
            value={limits[index]}
            allowDecimal
            onChange={(next) => setLimits((old) => old.map((v, i) => (i === index ? next : v)))}
            style={styles.input}
          />
          <Text style={styles.labelUnit}>%</Text>
        </View>
      ))}
      {problem && (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {problem}
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
      <Text accessibilityLiveRegion="polite" style={styles.help}>
        {busy ? 'Guardando…' : dirty ? 'Cambios sin guardar' : 'Guardado'}
      </Text>
      {error && (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      )}
      <Button
        label={error ? 'Reintentar guardado' : 'Guardar colores y límites'}
        loading={busy}
        disabled={busy || !dirty || problem !== null}
        onPress={() => {
          setBusy(true);
          setError(null);
          onSave(draft)
            .catch((cause: unknown) =>
              setError(cause instanceof Error ? cause.message : 'No se pudo guardar.'),
            )
            .finally(() => setBusy(false));
        }}
      />
      <Button
        label="Restaurar límites 25 / 50 / 100"
        variant="ghost"
        disabled={busy}
        onPress={() => {
          setLimits([
            String(DEFAULT_SCORE_SCALE.lowMax),
            String(DEFAULT_SCORE_SCALE.mediumMax),
            String(DEFAULT_SCORE_SCALE.topMin),
          ]);
          setError(null);
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
  input: {
    minWidth: 65,
    minHeight: 44,
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
