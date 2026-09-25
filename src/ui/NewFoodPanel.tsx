import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { NewFood } from '../nutrition/index.ts';

import { NumericField } from './NumericField.tsx';
import { mono, theme } from './theme.ts';

/**
 * Un alimento nuevo copiado de su envase, sin pasar por el catálogo del repositorio.
 *
 * Las tres medidas son las tres formas en que vienen las etiquetas que lee: un wrap
 * de Starbucks habla de una unidad, un paquete de arroz de 100 g y una bebida de
 * 100 ml. Lo que elija aquí es la unidad en la que va a anotarlo después.
 */
const MEASURES = [
  { id: 'unidad', label: '1 unidad', amount: 1, unit: 'unidad', kind: 'count' },
  { id: 'gramos', label: '100 g', amount: 100, unit: 'g', kind: 'mass' },
  { id: 'mililitros', label: '100 ml', amount: 100, unit: 'ml', kind: 'volume' },
] as const;

type MeasureId = (typeof MEASURES)[number]['id'];

export type NewFoodPanelProps = {
  onSave: (food: NewFood) => void;
  onCancel: () => void;
};

export function NewFoodPanel({ onSave, onCancel }: NewFoodPanelProps) {
  const [name, setName] = useState('');
  const [measureId, setMeasureId] = useState<MeasureId>('unidad');
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [fat, setFat] = useState('');
  const [carbs, setCarbs] = useState('');
  const [sugar, setSugar] = useState('');
  const [sodium, setSodium] = useState('');

  const measure = MEASURES.find((option) => option.id === measureId) ?? MEASURES[0];
  const figure = (value: string): number | null => {
    const parsed = Number(value);
    return value.trim() !== '' && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };

  const kcalValue = figure(kcal);
  const proteinValue = figure(protein);
  const fatValue = figure(fat);
  const canSave =
    name.trim() !== '' && kcalValue !== null && proteinValue !== null && fatValue !== null;

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Alimento nuevo</Text>

      <TextInput
        value={name}
        onChangeText={setName}
        accessibilityLabel="Nombre del alimento"
        placeholder="Nombre, como lo vas a buscar"
        placeholderTextColor={theme.textGhost}
        style={styles.name}
      />

      <View style={styles.chips}>
        {MEASURES.map((option) => (
          <Pressable
            key={option.id}
            accessibilityLabel={`Los datos son de ${option.label}`}
            onPress={() => setMeasureId(option.id)}
            style={[styles.chip, option.id === measureId && styles.chipSelected]}
          >
            <Text style={styles.chipText}>{option.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.hint}>Lo que dice la etiqueta para {measure.label}.</Text>

      <View style={styles.grid}>
        <Field label="kcal" value={kcal} onChange={setKcal} />
        <Field label="proteína g" value={protein} onChange={setProtein} />
        <Field label="grasa g" value={fat} onChange={setFat} />
        <Field label="carbos g" value={carbs} onChange={setCarbs} />
        <Field label="azúcar g" value={sugar} onChange={setSugar} />
        <Field label="sodio mg" value={sodium} onChange={setSodium} />
      </View>

      {/* Spec 16.3 regla 5: un hueco se muestra, no se rellena. */}
      <Text style={styles.hint}>
        Los tres últimos son opcionales. Lo que la etiqueta no diga, déjalo vacío: el total del día
        lo marcará con un + en vez de inventarlo.
      </Text>

      <View style={styles.buttons}>
        <Pressable accessibilityLabel="Cancelar el alimento nuevo" onPress={onCancel}>
          <Text style={styles.cancel}>Cancelar</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Guardar el alimento nuevo"
          disabled={!canSave}
          onPress={() => {
            if (!canSave) return;
            onSave({
              name: name.trim(),
              amount: measure.amount,
              unit: measure.unit,
              kind: measure.kind,
              kcal: kcalValue,
              proteinG: proteinValue,
              fatG: fatValue,
              carbsG: figure(carbs),
              sugarG: figure(sugar),
              sodiumMg: figure(sodium),
            });
          }}
          style={[styles.save, !canSave && styles.saveDisabled]}
        >
          <Text style={styles.saveText}>Guardar</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <NumericField
        value={value}
        onChange={onChange}
        allowDecimal
        accessibilityLabel={label}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: 8,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 8,
    padding: 10,
  },
  title: {
    fontSize: 13,
    fontFamily: mono,
    color: theme.text,
  },
  name: {
    borderWidth: 1,
    borderColor: theme.lineSoft,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    fontFamily: mono,
    color: theme.text,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  chip: {
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
    minHeight: 38,
    justifyContent: 'center',
  },
  chipSelected: {
    borderColor: theme.lineStrong,
    backgroundColor: theme.surfaceHigh,
  },
  chipText: {
    fontSize: 12,
    fontFamily: mono,
    color: theme.text,
  },
  hint: {
    fontSize: 10,
    color: theme.textGhost,
    fontFamily: mono,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  field: {
    gap: 2,
  },
  fieldLabel: {
    fontSize: 10,
    color: theme.textGhost,
    fontFamily: mono,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.lineSoft,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 14,
    width: 84,
    fontFamily: mono,
    color: theme.text,
  },
  buttons: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 14,
  },
  cancel: {
    fontSize: 12,
    fontFamily: mono,
    color: theme.textFaint,
  },
  save: {
    borderWidth: 1,
    borderColor: theme.lineStrong,
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  saveDisabled: {
    borderColor: theme.lineSoft,
  },
  saveText: {
    fontSize: 12,
    fontFamily: mono,
    color: theme.text,
  },
});
