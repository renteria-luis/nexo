import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import type { NutritionFoodRow } from '../db/types.ts';
import { MEAL_SLOTS, roundAmount } from '../nutrition/index.ts';
import type { BatchStart, OpenBatch } from '../shell/AppData.tsx';

import { Button } from './Button.tsx';
import { Card } from './Card.tsx';
import { Chip } from './Chip.tsx';
import { Plus, TriangleAlert, Utensils } from './icons.ts';
import { NumericField } from './NumericField.tsx';
import { Toggle } from './Toggle.tsx';
import { font, sheet, shape, theme } from './theme.ts';

function parse(value: string): number {
  return value.trim() === '' ? Number.NaN : Number(value);
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  text = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** El nombre se escribe con letras, asi que ese si lleva el teclado del sistema. */
  text?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {text ? (
        <TextInput
          value={value}
          onChangeText={onChange}
          accessibilityLabel={label}
          placeholder={placeholder}
          placeholderTextColor={theme.textGhost}
          style={styles.input}
        />
      ) : (
        <NumericField
          value={value}
          onChange={onChange}
          allowDecimal
          accessibilityLabel={label}
          placeholder={placeholder}
          style={styles.input}
          focusedStyle={styles.inputWriting}
        />
      )}
    </View>
  );
}

function BatchCard({ item, onEat }: { item: OpenBatch; onEat: () => void }) {
  const { batch, food, macros, spoilage } = item;
  const kcal =
    macros.kcal !== null
      ? `${Math.round(macros.kcal)} kcal`
      : macros.kcalRange
        ? `entre ${Math.round(macros.kcalRange.from)} y ${Math.round(macros.kcalRange.to)} kcal, grasa escurrida`
        : macros.fatDrained
          ? 'calorías sin rango: faltan los carbohidratos del alimento'
          : 'calorías sin dato';

  return (
    <View style={styles.batch}>
      <View style={styles.batchHead}>
        <Text style={styles.batchName}>{food.name}</Text>
        <Text style={styles.batchLeft}>
          {batch.portions_remaining} de {batch.portions_count}
        </Text>
      </View>
      <Text style={styles.batchDetail}>
        {roundAmount(macros.proteinG)} g de proteína por porción · {kcal}
      </Text>
      {spoilage && (
        // Spec 7.3 wording.
        <View style={styles.warnRow}>
          <TriangleAlert size={15} color={theme.text} strokeWidth={2.5} />
          <Text style={styles.warnText}>
            Quedan {spoilage.portionsRemaining} porciones de {food.name} de hace{' '}
            {spoilage.ageDays} días
          </Text>
        </View>
      )}
      <Button
        label="Comer una porción"
        accessibilityLabel={`Comer una porción de ${food.name}`}
        variant="primary"
        icon={Utensils}
        block
        onPress={onEat}
      />
    </View>
  );
}

export type BatchPanelProps = {
  batches: OpenBatch[];
  foods: NutritionFoodRow[];
  onStart: (start: BatchStart) => Promise<void>;
  onEat: (batchId: string, mealSlot: string) => void;
};

/**
 * Spec 7.3: weigh the raw pack once, divide it by eye, and every tap after that is
 * one portion. The foods the pattern is really for, chicken breast, ground beef and
 * rice, are not in the seeded catalogue, so a batch can start from a package label.
 */
export function BatchPanel({ batches, foods, onStart, onEat }: BatchPanelProps) {
  const [slot, setSlot] = useState(MEAL_SLOTS[2]);
  const [creating, setCreating] = useState(false);
  const [source, setSource] = useState<'catalog' | 'label'>('label');
  const [foodId, setFoodId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [servingG, setServingG] = useState('100');
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [fat, setFat] = useState('');
  const [carbs, setCarbs] = useState('');
  const [rawWeight, setRawWeight] = useState('');
  const [portions, setPortions] = useState('');
  const [drained, setDrained] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const batchable = foods.filter((food) => food.base_unit_g !== null);

  // The low end of a drained range is protein and carbs alone (spec 7.3), so a
  // blank carbs figure would leave the range with nothing to stand on.
  const required = drained ? [servingG, kcal, protein, fat, carbs] : [servingG, kcal, protein, fat];
  const labelReady = name.trim() !== '' && required.every((value) => Number.isFinite(parse(value)));
  const batchReady =
    parse(rawWeight) > 0 && Number.isInteger(parse(portions)) && parse(portions) >= 1;
  const canSave = batchReady && (source === 'catalog' ? foodId !== null : labelReady);

  const reset = () => {
    setCreating(false);
    setFoodId(null);
    setName('');
    setServingG('100');
    setKcal('');
    setProtein('');
    setFat('');
    setCarbs('');
    setRawWeight('');
    setPortions('');
    setDrained(false);
    setProblem(null);
  };

  const save = () => {
    if (!canSave) return;
    const food: BatchStart['food'] =
      source === 'catalog' && foodId
        ? { foodId }
        : {
            label: {
              name,
              servingG: parse(servingG),
              kcal: parse(kcal),
              proteinG: parse(protein),
              fatG: parse(fat),
              carbsG: carbs.trim() === '' ? null : parse(carbs),
            },
          };
    onStart({
      food,
      rawWeightG: parse(rawWeight),
      portionsCount: parse(portions),
      fatDrained: drained,
    })
      .then(reset)
      .catch((error: unknown) => {
        console.error(error);
        setProblem(error instanceof Error ? error.message : String(error));
      });
  };

  return (
    <Card title="Tandas">
      <Text style={styles.hint}>
        Una tanda es lo que cocinas de una vez y vas comiendo por porciones: metes el total una sola
        vez y despues cada plato se descuenta solo.
      </Text>

      {batches.length > 0 && (
        <>
          <Text style={styles.label}>La porción se anota en</Text>
          <View style={styles.chips}>
            {MEAL_SLOTS.map((name) => (
              <Chip
                key={name}
                label={name}
                selected={name === slot}
                onPress={() => setSlot(name)}
              />
            ))}
          </View>
        </>
      )}

      {batches.map((item) => (
        <BatchCard key={item.batch.id} item={item} onEat={() => onEat(item.batch.id, slot)} />
      ))}

      {!creating ? (
        <Button
          label="Nueva tanda"
          accessibilityLabel="Nueva tanda"
          icon={Plus}
          block
          onPress={() => setCreating(true)}
        />
      ) : (
        <View style={styles.form}>
          <View style={styles.chips}>
            {(['label', 'catalog'] as const).map((option) => (
              <Chip
                key={option}
                label={option === 'label' ? 'Desde la etiqueta' : 'Del catálogo'}
                selected={source === option}
                onPress={() => setSource(option)}
              />
            ))}
          </View>

          {source === 'catalog' ? (
            <View style={styles.chips}>
              {batchable.map((food) => (
                <Chip
                  key={food.id}
                  label={food.name}
                  selected={food.id === foodId}
                  onPress={() => setFoodId(food.id)}
                />
              ))}
            </View>
          ) : (
            <>
              <Field
                label="Nombre"
                value={name}
                onChange={setName}
                placeholder="Pechuga de pollo"
                text
              />
              <Text style={styles.hint}>Tal como dice el paquete, crudo.</Text>
              <View style={styles.row}>
                <Field label="Por cada (g)" value={servingG} onChange={setServingG} />
                <Field label="Calorías" value={kcal} onChange={setKcal} />
              </View>
              <View style={styles.row}>
                <Field label="Proteína (g)" value={protein} onChange={setProtein} />
                <Field label="Grasa (g)" value={fat} onChange={setFat} />
                <Field
                  label="Carbos (g)"
                  value={carbs}
                  onChange={setCarbs}
                  placeholder={drained ? '0 si no trae' : 'opcional'}
                />
              </View>
            </>
          )}

          <View style={styles.row}>
            <Field
              label="Peso crudo total (g)"
              value={rawWeight}
              onChange={setRawWeight}
              placeholder="1600"
            />
            <Field label="Porciones" value={portions} onChange={setPortions} placeholder="8" />
          </View>

          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.switchLabel}>Grasa escurrida</Text>
              <Text style={styles.hint}>
                La proteína sigue siendo fiable; las calorías salen como un rango.
              </Text>
            </View>
            <Toggle
              value={drained}
              onChange={setDrained}
              accessibilityLabel="La grasa se escurre"
            />
          </View>

          {problem && <Text style={styles.problem}>{problem}</Text>}

          <View style={styles.buttons}>
            <Button
              label="Guardar tanda"
              accessibilityLabel="Guardar tanda"
              variant="primary"
              disabled={!canSave}
              style={styles.grow}
              onPress={save}
            />
            <Button
              label="Cancelar"
              accessibilityLabel="Cancelar tanda"
              variant="ghost"
              onPress={reset}
            />
          </View>
        </View>
      )}
    </Card>
  );
}

const styles = sheet((theme) => ({
  hint: {
    fontSize: 12,
    fontFamily: font.regular,
    color: theme.textFaint,
  },
  label: {
    fontSize: 11,
    fontFamily: font.black,
    letterSpacing: 0.6,
    color: theme.textFaint,
    textTransform: 'uppercase',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  batch: {
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.bg,
    padding: 10,
    gap: 6,
  },
  batchHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
  },
  batchName: {
    flexShrink: 1,
    fontSize: 15,
    fontFamily: font.black,
    color: theme.text,
  },
  batchLeft: {
    fontSize: 15,
    fontFamily: font.black,
    color: theme.text,
    fontVariant: ['tabular-nums'],
  },
  batchDetail: {
    fontSize: 12,
    fontFamily: font.regular,
    color: theme.textFaint,
    fontVariant: ['tabular-nums'],
  },
  warnRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.warnBg,
    padding: 8,
  },
  warnText: {
    flex: 1,
    fontSize: 12,
    fontFamily: font.regular,
    color: theme.text,
  },
  form: {
    gap: 10,
    borderTopWidth: shape.border,
    borderTopColor: theme.line,
    paddingTop: 10,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  field: {
    flexGrow: 1,
    flexBasis: '28%',
    gap: 4,
  },
  input: {
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.surface,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 15,
    fontFamily: font.bold,
    color: theme.text,
    fontVariant: ['tabular-nums'],
  },
  inputWriting: {
    backgroundColor: theme.surfaceHigh,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 44,
  },
  switchText: {
    flex: 1,
    gap: 2,
  },
  switchLabel: {
    fontSize: 15,
    fontFamily: font.bold,
    color: theme.text,
  },
  problem: {
    fontSize: 13,
    fontFamily: font.bold,
    color: theme.danger,
  },
  buttons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  grow: {
    flex: 1,
  },
}));
