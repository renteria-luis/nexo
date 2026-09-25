import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { NutritionFoodRow } from '../db/types.ts';
import { referenceAmount, roundAmount, type FoodEdit, type NewFood } from '../nutrition/index.ts';

import { NumericField } from './NumericField.tsx';
import { mono, theme } from './theme.ts';

/**
 * La ficha de un alimento: la misma para crear uno nuevo y para corregir uno que ya
 * existe.
 *
 * Va en dos pasos. Primero los numeros, y despues un resumen de lo que va a quedar
 * guardado antes de confirmar: un alimento mal copiado no se nota el dia que lo
 * escribe sino semanas despues, cuando la proteina de todos esos dias ya salio mal.
 */
const MEASURES = [
  { id: 'unidad', label: '1 unidad', amount: 1, unit: 'unidad', kind: 'count' },
  { id: 'gramos', label: '100 g', amount: 100, unit: 'g', kind: 'mass' },
  { id: 'mililitros', label: '100 ml', amount: 100, unit: 'ml', kind: 'volume' },
] as const;

type MeasureId = (typeof MEASURES)[number]['id'];

export type FoodFormProps = {
  /** La ficha que corrige, o null cuando es uno nuevo. */
  food: NutritionFoodRow | null;
  onCancel: () => void;
  onCreate: (food: NewFood) => void;
  onEdit: (id: string, food: FoodEdit) => void;
};

function measureOf(food: NutritionFoodRow): MeasureId {
  if (food.unit_kind === 'count') return 'unidad';
  return food.base_unit === 'ml' ? 'mililitros' : 'gramos';
}

/** Lo guardado esta por unidad base; en pantalla se ve por la medida de la etiqueta. */
function shown(value: number | null, per: number): string {
  return value === null ? '' : roundAmount(Math.round(value * per * 100) / 100);
}

export function FoodForm({ food, onCancel, onCreate, onEdit }: FoodFormProps) {
  const per = food ? referenceAmount(food) : 1;
  const [step, setStep] = useState<'datos' | 'resumen'>('datos');
  const [name, setName] = useState(food?.name ?? '');
  const [measureId, setMeasureId] = useState<MeasureId>(food ? measureOf(food) : 'unidad');
  const [kcal, setKcal] = useState(food ? shown(food.kcal, per) : '');
  const [protein, setProtein] = useState(food ? shown(food.protein_g, per) : '');
  const [fat, setFat] = useState(food ? shown(food.fat_g, per) : '');
  const [carbs, setCarbs] = useState(food ? shown(food.carbs_g, per) : '');
  const [sugar, setSugar] = useState(food ? shown(food.sugar_g, per) : '');
  const [sodium, setSodium] = useState(food ? shown(food.sodium_mg, per) : '');
  const [keywords, setKeywords] = useState(food?.keywords ?? '');

  const measure = MEASURES.find((option) => option.id === measureId) ?? MEASURES[0];
  const figure = (value: string): number | null => {
    const parsed = Number(value);
    return value.trim() !== '' && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };

  const kcalValue = figure(kcal);
  const proteinValue = figure(protein);
  const fatValue = figure(fat);
  const ready =
    name.trim() !== '' && kcalValue !== null && proteinValue !== null && fatValue !== null;

  const save = () => {
    if (!ready) return;
    if (food) {
      onEdit(food.id, {
        name: name.trim(),
        kcal: kcalValue,
        proteinG: proteinValue,
        fatG: fatValue,
        carbsG: figure(carbs),
        sugarG: figure(sugar),
        sodiumMg: figure(sodium),
        keywords: keywords.trim() === '' ? null : keywords,
      });
      return;
    }
    onCreate({
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
      keywords: keywords.trim() === '' ? null : keywords,
    });
  };

  const line = (label: string, value: string, unit: string) => (
    <View style={styles.summaryRow} key={label}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={value === '' ? styles.summaryMissing : styles.summaryValue}>
        {value === '' ? 'sin dato' : `${value} ${unit}`}
      </Text>
    </View>
  );

  return (
    <View style={styles.sheet}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        <Text style={styles.title}>
          {step === 'resumen' ? 'Así va a quedar' : food ? 'Corregir alimento' : 'Alimento nuevo'}
        </Text>

        {step === 'datos' ? (
          <>
            <TextInput
              value={name}
              onChangeText={setName}
              accessibilityLabel="Nombre del alimento"
              placeholder="Nombre"
              placeholderTextColor={theme.textGhost}
              style={styles.text}
            />

            {food ? (
              <Text style={styles.hint}>
                Los datos son de {measure.label}. La medida no se cambia: todo lo que ya comiste
                está anotado en ella.
              </Text>
            ) : (
              <>
                <View style={styles.chips}>
                  {MEASURES.map((option) => (
                    <Pressable
                      key={option.id}
                      accessibilityLabel={`Los datos son de ${option.label}`}
                      onPress={() => setMeasureId(option.id)}
                      style={[styles.chip, option.id === measureId && styles.chipOn]}
                    >
                      <Text style={styles.chipText}>{option.label}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.hint}>Lo que dice la etiqueta para {measure.label}.</Text>
              </>
            )}

            <View style={styles.grid}>
              <Field label="kcal" value={kcal} onChange={setKcal} />
              <Field label="proteína g" value={protein} onChange={setProtein} />
              <Field label="grasa g" value={fat} onChange={setFat} />
              <Field label="carbos g" value={carbs} onChange={setCarbs} />
              <Field label="azúcar g" value={sugar} onChange={setSugar} />
              <Field label="sodio mg" value={sodium} onChange={setSodium} />
            </View>

            <TextInput
              value={keywords}
              onChangeText={setKeywords}
              accessibilityLabel="Palabras clave"
              placeholder="egg, costco, desayuno"
              placeholderTextColor={theme.textGhost}
              autoCapitalize="none"
              style={styles.text}
            />
            <Text style={styles.hint}>
              Palabras clave separadas por coma. Buscando cualquiera de ellas sale este alimento.
            </Text>

            {/* Spec 16.3 regla 5: un hueco se muestra, no se rellena. */}
            <Text style={styles.hint}>
              Lo que la etiqueta no diga, déjalo vacío: el total del día lo marca con un + en vez
              de inventarlo.
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.summaryName}>{name.trim()}</Text>
            <Text style={styles.hint}>por {measure.label}</Text>
            {line('kcal', kcal, '')}
            {line('proteína', protein, 'g')}
            {line('grasa', fat, 'g')}
            {line('carbos', carbs, 'g')}
            {line('azúcar', sugar, 'g')}
            {line('sodio', sodium, 'mg')}
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>palabras</Text>
              <Text style={keywords.trim() === '' ? styles.summaryMissing : styles.summaryValue}>
                {keywords.trim() === '' ? 'ninguna' : keywords.trim()}
              </Text>
            </View>
            {food !== null && (
              <Text style={styles.warn}>
                Se recalculan todos los días en los que comiste esto.
              </Text>
            )}
          </>
        )}
      </ScrollView>

      <View style={styles.buttons}>
        <Pressable
          accessibilityLabel={step === 'resumen' ? 'Atrás' : 'Cancelar'}
          onPress={() => (step === 'resumen' ? setStep('datos') : onCancel())}
        >
          <Text style={styles.back}>{step === 'resumen' ? 'Atrás' : 'Cancelar'}</Text>
        </Pressable>
        <Pressable
          accessibilityLabel={step === 'resumen' ? 'Confirmar' : 'Guardar'}
          disabled={!ready}
          onPress={() => (step === 'resumen' ? save() : setStep('resumen'))}
          style={[styles.save, !ready && styles.saveOff]}
        >
          <Text style={styles.saveText}>{step === 'resumen' ? 'Confirmar' : 'Guardar'}</Text>
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
  sheet: {
    flex: 1,
    backgroundColor: theme.bg,
    borderWidth: 1,
    borderColor: theme.lineStrong,
    borderRadius: 10,
  },
  body: {
    gap: 8,
    padding: 12,
  },
  title: {
    fontSize: 14,
    fontFamily: mono,
    color: theme.text,
  },
  text: {
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
  chipOn: {
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
  warn: {
    fontSize: 11,
    color: theme.warn,
    fontFamily: mono,
    marginTop: 6,
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
  summaryName: {
    fontSize: 15,
    fontFamily: mono,
    color: theme.text,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: theme.line,
    paddingTop: 5,
  },
  summaryLabel: {
    fontSize: 12,
    fontFamily: mono,
    color: theme.textFaint,
  },
  summaryValue: {
    fontSize: 12,
    fontFamily: mono,
    color: theme.text,
  },
  summaryMissing: {
    fontSize: 12,
    fontFamily: mono,
    color: theme.textGhost,
  },
  buttons: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 16,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: theme.line,
  },
  back: {
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
  saveOff: {
    borderColor: theme.lineSoft,
  },
  saveText: {
    fontSize: 12,
    fontFamily: mono,
    color: theme.text,
  },
});
