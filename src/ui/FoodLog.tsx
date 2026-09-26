import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { NutritionFoodRow } from '../db/types.ts';
import {
  MEAL_SLOTS,
  mealSlotAtHour,
  portionLabel,
  quickAmountsFor,
  roundAmount,
  unitLabel,
  type FoodHistory,
  type LastMeal,
  type LoggedPortion,
  type NewFoodEntry,
  type NutritionTotals,
} from '../nutrition/index.ts';
import { shortDate } from '../core/dates.ts';

import { FoodPicker } from './FoodPicker.tsx';
import { PortionMacros } from './PortionMacros.tsx';
import { NumericField } from './NumericField.tsx';
import { mono, theme } from './theme.ts';

function Total({
  label,
  value,
  unit,
  band,
  missing,
}: {
  label: string;
  value: number;
  unit: string;
  band?: string;
  missing?: boolean;
}) {
  return (
    <View style={styles.total}>
      <Text style={styles.totalLabel}>{label}</Text>
      <Text style={styles.totalValue}>
        {roundAmount(value)}
        {unit}
        {/* Spec 16.3 rule 5: a gap is shown, never filled in. */}
        {missing ? ' +' : ''}
      </Text>
      {band ? <Text style={styles.totalBand}>{band}</Text> : null}
    </View>
  );
}

export type FoodLogProps = {
  foods: NutritionFoodRow[];
  portions: LoggedPortion[];
  totals: NutritionTotals | null;
  proteinBand: { from: number; to: number } | null;
  kcalTarget: number | null;
  onAdd: (entry: Omit<NewFoodEntry, 'date'>) => void;
  onRemove: (entryId: string) => void;
  /** Lleva al catalogo: crear y corregir viven aparte de anotar. */
  onOpenCatalogue: () => void;
  /** Lo que ya anoto, que es lo que decide el orden de la lista. */
  history: FoodHistory;
  /** Sin esto no se ofrece repetir: solo tiene sentido sobre el dia de hoy. */
  onRepeatMeal?: (meal: LastMeal, slot: string) => void;
  /** "Comida de hoy" salvo cuando el dia no es hoy. */
  heading?: string;
};

/** Los que salen arriba con su total: son los unicos que pueden mostrar un hueco. */
const SHOWN_NUTRIENTS = ['kcal', 'protein_g', 'carbs_g', 'fat_g', 'sodium_mg'];

export function FoodLog({
  foods,
  portions,
  totals,
  proteinBand,
  kcalTarget,
  onAdd,
  onRemove,
  onOpenCatalogue,
  history,
  onRepeatMeal,
  heading = 'Comida de hoy',
}: FoodLogProps) {
  const [foodId, setFoodId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('1');
  // Abre en el espacio de comida en el que esta el reloj: a las tres de la tarde no
  // esta anotando el desayuno.
  const [slot, setSlot] = useState(() => {
    const now = new Date();
    return mealSlotAtHour(now.getHours(), now.getMinutes());
  });
  const repeatable = history.lastMealBySlot.get(slot) ?? null;
  // Una burbuja abierta a la vez: la de otra porcion se cierra sola.
  const [openPortion, setOpenPortion] = useState<string | null>(null);

  const selected = foods.find((food) => food.id === foodId) ?? null;
  const parsed = Number(quantity);
  const canAdd = selected !== null && Number.isFinite(parsed) && parsed > 0;

  const missingFor = (nutrient: string) =>
    totals?.missing.some((gap) => gap.nutrient === nutrient) ?? false;

  // El aviso solo puede hablar de los huecos que se ven con un + arriba. La fibra y
  // el indice glucemico no se muestran, asi que nombrar un alimento por no traerlos
  // decia "faltan datos" de un alimento que los tiene todos.
  const shownGaps = (totals?.missing ?? []).filter((gap) =>
    gap.nutrient === 'glycemic_index'
      ? totals?.glycemicLoad !== null && totals?.glycemicLoad !== undefined
      : SHOWN_NUTRIENTS.includes(gap.nutrient),
  );

  return (
    // Tocar donde no hay nada suelta el alimento elegido, igual que el teclado: un
    // boton o una fila se quedan con el toque antes de llegar aqui.
    <View
      style={styles.wrapper}
      onStartShouldSetResponder={foodId === null && openPortion === null ? undefined : () => true}
      onResponderRelease={
        foodId === null && openPortion === null
          ? undefined
          : () => {
              setFoodId(null);
              setOpenPortion(null);
            }
      }
    >
      {/* The targets card above also says "Calorías" and "Proteína"; this heading is
          what keeps the eaten figures from being read as the target ones. */}
      <Text style={styles.heading}>{heading}</Text>

      {totals && (
        <View style={styles.totals}>
          <Total
            label="Calorías"
            value={totals.kcal}
            unit=""
            band={kcalTarget === null ? undefined : `de ${kcalTarget}`}
            missing={missingFor('kcal')}
          />
          <Total
            label="Proteína"
            value={totals.proteinG}
            unit=" g"
            band={proteinBand === null ? undefined : `${proteinBand.from} a ${proteinBand.to}`}
            missing={missingFor('protein_g')}
          />
          <Total label="Carbos" value={totals.carbsG} unit=" g" missing={missingFor('carbs_g')} />
          {/* Spec 7.5: dairy is shown and never subtracted, and the glycemic load
              only appears once something eaten carries an index. */}
          {totals.dairy.portions > 0 && (
            <Total
              label="Lácteos"
              value={
                totals.dairy.millilitresG > 0 ? totals.dairy.millilitresG : totals.dairy.portions
              }
              unit={totals.dairy.millilitresG > 0 ? ' ml' : ' porciones'}
            />
          )}
          {totals.glycemicLoad !== null && (
            <Total
              label="Carga glucémica"
              value={totals.glycemicLoad}
              unit=""
              missing={missingFor('glycemic_index')}
            />
          )}
          <Total label="Grasa" value={totals.fatG} unit=" g" missing={missingFor('fat_g')} />
          <Total
            label="Sodio"
            value={totals.sodiumMg}
            unit=" mg"
            band={totals.sodiumOverLimit ? 'sobre 2300' : undefined}
            missing={missingFor('sodium_mg')}
          />
        </View>
      )}

      {totals && shownGaps.length > 0 && (
        <Text style={styles.gap}>
          El signo + marca totales incompletos:{' '}
          {[...new Set(shownGaps.map((entry) => entry.foodName))].join(', ')} no trae todos los
          datos. Se arreglan en editar alimentos.
        </Text>
      )}

      {portions.map((portion) => (
        <View key={portion.entryId}>
          <View style={styles.entry}>
            <Pressable
              accessibilityLabel={`Qué aporta ${portion.food.name}`}
              onPress={() =>
                setOpenPortion(openPortion === portion.entryId ? null : portion.entryId)
              }
              style={[styles.info, openPortion === portion.entryId && styles.infoOn]}
            >
              <Text style={styles.infoText}>i</Text>
            </Pressable>
            <View style={styles.entryText}>
              <Text style={styles.entryName}>{portionLabel(portion.food, portion.quantity)}</Text>
              <Text style={styles.entryMeta}>{portion.mealSlot}</Text>
            </View>
            <Pressable
              accessibilityLabel={`Quitar ${portion.food.name}`}
              onPress={() => onRemove(portion.entryId)}
              style={styles.remove}
            >
              <Text style={styles.removeText}>quitar</Text>
            </Pressable>
          </View>
          {openPortion === portion.entryId && (
            <PortionMacros food={portion.food} quantity={portion.quantity} />
          )}
        </View>
      ))}

      <View style={styles.picker}>
        <View style={styles.chips}>
          {MEAL_SLOTS.map((name) => (
            <Pressable
              key={name}
              onPress={() => setSlot(name)}
              style={[styles.chip, name === slot && styles.chipSelected]}
            >
              <Text style={styles.chipText}>{name}</Text>
            </Pressable>
          ))}
        </View>

        {repeatable && onRepeatMeal && (
          <Pressable
            accessibilityLabel={`Repetir ${slot} del ${shortDate(repeatable.date)}`}
            onPress={() => onRepeatMeal(repeatable, slot)}
            style={styles.repeat}
          >
            <Text style={styles.repeatText}>
              repetir {slot} del {shortDate(repeatable.date)} · {repeatable.entries.length}{' '}
              {repeatable.entries.length === 1 ? 'cosa' : 'cosas'}
            </Text>
          </Pressable>
        )}

        <FoodPicker
          foods={foods}
          history={history}
          slot={slot}
          selectedId={foodId}
          onOpenCatalogue={onOpenCatalogue}
          onSelect={(food) => {
            setFoodId(food.id);
            // Con la cantidad de la ultima vez ya puesta, anotar son dos toques.
            setQuantity(roundAmount(history.lastQuantity.get(food.id) ?? 1));
          }}
        />

        {selected && (
          <View style={styles.chips}>
            {quickAmountsFor(selected).map((amount) => (
              <Pressable
                key={amount}
                onPress={() => setQuantity(String(amount))}
                style={[styles.chip, quantity === String(amount) && styles.chipSelected]}
              >
                <Text style={styles.chipText}>
                  {amount} {unitLabel(selected, amount)}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* Sin alimento elegido no hay nada que anotar, y un boton de agregar suelto
            es un toque sin querer. */}
        {selected && (
          <View style={styles.addRow}>
            <NumericField
              value={quantity}
              onChange={setQuantity}
              allowDecimal
              accessibilityLabel="Cantidad"
              style={styles.input}
            />
            <Text style={styles.unit}>{unitLabel(selected, parsed)}</Text>
            <Pressable
              accessibilityLabel="Agregar comida"
              disabled={!canAdd}
              onPress={() => {
                if (!canAdd) return;
                onAdd({
                  foodId: selected.id,
                  quantity: parsed,
                  unit: selected.base_unit,
                  mealSlot: slot,
                });
              }}
              style={[styles.add, !canAdd && styles.addDisabled]}
            >
              <Text style={styles.addText}>Agregar</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignSelf: 'stretch',
    gap: 10,
  },
  heading: {
    fontSize: 14,
    fontFamily: mono,
    color: theme.text,
  },
  totals: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  total: {
    minWidth: 72,
  },
  totalLabel: {
    fontSize: 11,
    color: theme.textGhost,
    fontFamily: mono,
  },
  totalValue: {
    fontSize: 15,
    fontFamily: mono,
    color: theme.text,
  },
  totalBand: {
    fontSize: 10,
    color: theme.textGhost,
    fontFamily: mono,
  },
  gap: {
    fontSize: 11,
    color: theme.warn,
    fontFamily: mono,
  },
  entry: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: theme.line,
    paddingTop: 6,
  },
  info: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: theme.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoOn: {
    borderColor: theme.accent,
    backgroundColor: theme.surfaceHigh,
  },
  infoText: {
    fontSize: 12,
    color: theme.textFaint,
    fontFamily: mono,
  },
  entryText: {
    flexShrink: 1,
  },
  entryName: {
    fontSize: 13,
    fontFamily: mono,
    color: theme.text,
  },
  entryMeta: {
    fontSize: 10,
    color: theme.textGhost,
    fontFamily: mono,
  },
  remove: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  removeText: {
    fontSize: 11,
    color: theme.danger,
    fontFamily: mono,
  },
  picker: {
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: theme.line,
    paddingTop: 8,
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
  repeat: {
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  repeatText: {
    fontSize: 11,
    fontFamily: mono,
    color: theme.accent,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.lineSoft,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 14,
    width: 70,
    fontFamily: mono,
    color: theme.text,
  },
  unit: {
    fontSize: 11,
    color: theme.textGhost,
    flexShrink: 1,
    fontFamily: mono,
  },
  add: {
    borderWidth: 1,
    borderColor: theme.lineStrong,
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  addDisabled: {
    borderColor: theme.lineSoft,
  },
  addText: {
    fontSize: 12,
    fontFamily: mono,
    color: theme.text,
  },
});
