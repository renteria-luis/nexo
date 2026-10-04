import { useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { shortDate } from '../core/dates.ts';
import { fatAgainstBand, kcalAgainstBand } from '../core/targets.ts';
import type { NutritionFoodRow } from '../db/types.ts';
import {
  MEAL_SLOTS,
  SODIUM_FLAG_MG,
  currentSlot,
  portionLabel,
  quickAmountsFor,
  repeatableMeal,
  roundAmount,
  unitLabel,
  type FoodHistory,
  type LastMeal,
  type LoggedPortion,
  type NewFoodEntry,
  type NutritionTotals,
} from '../nutrition/index.ts';

import { Button } from './Button.tsx';
import { Card } from './Card.tsx';
import { Chip } from './Chip.tsx';
import { FoodPicker } from './FoodPicker.tsx';
import { ConfirmButton, InfoDot } from './InfoBubble.tsx';
import { Pencil, Plus, RotateCcw, Trash, TriangleAlert } from './icons.ts';
import { IconButton } from './IconButton.tsx';
import { NumericField } from './NumericField.tsx';
import { PortionMacros } from './PortionMacros.tsx';
import { Star } from './Star.tsx';
import { font, sheet, shape, theme } from './theme.ts';

/** Un macro del dia en su cuadrito: el nombre arriba, el numero grande debajo. */
function Stat({
  label,
  value,
  note,
  alert = false,
}: {
  label: string;
  value: string;
  note?: string;
  alert?: boolean;
}) {
  return (
    <View style={[styles.stat, alert && styles.statAlert]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      {note ? <Text style={styles.statNote}>{note}</Text> : null}
    </View>
  );
}

export type FoodLogProps = {
  foods: NutritionFoodRow[];
  portions: LoggedPortion[];
  totals: NutritionTotals | null;
  proteinBand: { from: number; to: number } | null;
  /** La banda de calorias, que es contra lo que se dicen: no contra la meta pelada. */
  kcalBand: { from: number; to: number } | null;
  fatBand: { from: number; to: number; hardFloor: number } | null;
  onAdd: (entry: Omit<NewFoodEntry, 'date'>) => void;
  onRemove: (entryId: string) => void;
  /** Lleva al catalogo: crear y corregir viven aparte de anotar. */
  onOpenCatalogue: () => void;
  /** Lo que ya anoto, que es lo que decide el orden de la lista. */
  history: FoodHistory;
  /** Sin esto no se ofrece repetir: solo tiene sentido sobre el dia de hoy. */
  /** Devuelve cuantas porciones de olla no entraron porque la olla ya se acabo. */
  onRepeatMeal?: (meal: LastMeal, slot: string) => Promise<number>;
  /** "Comida de hoy" salvo cuando el dia no es hoy. */
  heading?: string;
  /**
   * Un dia que abrio desde Registros, que se mira mucho mas de lo que se corrige: una
   * sola cartilla, compacta, y los botones detras del lapiz. Hoy no, porque hoy lo
   * esta anotando todo el rato.
   */
  record?: boolean;
  /**
   * El espacio en el que se anota, cuando lo comparte con otra cartilla (las tandas de
   * Comida). Sin esto lleva el suyo, que sigue el reloj.
   */
  slot?: string;
  /** Lo que eligio a mano; null vuelve al del reloj, como despues de anotar. */
  onPickSlot?: (slot: string | null) => void;
};

/** Los que salen arriba con su total: son los unicos que pueden mostrar un hueco. */
const SHOWN_NUTRIENTS = ['kcal', 'protein_g', 'carbs_g', 'fat_g', 'sodium_mg'];

function totalMark(totals: NutritionTotals | null, nutrient: string): string {
  return totals?.missing.some((gap) => gap.nutrient === nutrient) ? ' +' : '';
}

function NutritionStats({
  totals,
  proteinBand,
  kcalBand,
  fatBand,
  record = false,
}: {
  totals: NutritionTotals;
} & Pick<FoodLogProps, 'proteinBand' | 'kcalBand' | 'fatBand' | 'record'>) {
  const mark = (nutrient: string) => totalMark(totals, nutrient);
  // Only warn about missing figures whose displayed total carries a +.
  const shownGaps = totals.missing.filter((gap) =>
    gap.nutrient === 'glycemic_index'
      ? totals.glycemicLoad !== null
      : SHOWN_NUTRIENTS.includes(gap.nutrient),
  );

  const kcal = Math.round(totals.kcal);
  const fat = fatBand === null ? null : fatAgainstBand(totals.fatG, fatBand, record);

  return (
    <>
      <View style={styles.stats}>
        {record && (
          <>
            <Stat
              label="Calorías"
              value={`${kcal}${mark('kcal')}`}
              note={kcalBand === null ? undefined : kcalAgainstBand(kcal, kcalBand)}
            />
            <Stat
              label="Proteína"
              value={`${Math.round(totals.proteinG)}${mark('protein_g')} g`}
              note={proteinBand ? `meta ${proteinBand.from} o más` : undefined}
            />
          </>
        )}
        <Stat
          label="Carbos"
          value={`${roundAmount(totals.carbsG)}${mark('carbs_g')} g`}
          note={totals.fibreG > 0 ? `fibra ${roundAmount(totals.fibreG)} g` : undefined}
        />
        <Stat
          label="Grasa"
          value={`${roundAmount(totals.fatG)}${mark('fat_g')} g`}
          note={fat?.note}
          alert={fat?.alert}
        />
        <Stat
          label="Sodio"
          value={`${roundAmount(totals.sodiumMg)}${mark('sodium_mg')} mg`}
          note={totals.sodiumOverLimit ? `sobre ${SODIUM_FLAG_MG}` : undefined}
          alert={totals.sodiumOverLimit}
        />
        {/* Spec 7.5: show dairy without subtracting it; glycemic load needs an index. */}
        {totals.dairy.portions > 0 && (
          <Stat
            label="Lácteos"
            value={
              totals.dairy.millilitresG > 0
                ? `${roundAmount(totals.dairy.millilitresG)} ml`
                : `${totals.dairy.portions}`
            }
            note={
              totals.dairy.millilitresG > 0
                ? `${roundAmount(totals.dairy.proteinG)} g de proteína`
                : 'porciones'
            }
          />
        )}
        {totals.glycemicLoad !== null && (
          <Stat
            label="Carga glucémica"
            value={`${roundAmount(totals.glycemicLoad)}${mark('glycemic_index')}`}
          />
        )}
      </View>
      {shownGaps.length > 0 && (
        <View style={styles.gap}>
          <TriangleAlert size={16} color={theme.text} strokeWidth={2.5} />
          <Text style={styles.gapText}>
            El signo + marca totales incompletos:{' '}
            {[...new Set(shownGaps.map((entry) => entry.foodName))].join(', ')} no trae todos los
            datos. Se arreglan en editar alimentos.
          </Text>
        </View>
      )}
    </>
  );
}

export function FoodLog({
  foods,
  portions,
  totals,
  proteinBand,
  kcalBand,
  fatBand,
  onAdd,
  onRemove,
  onOpenCatalogue,
  history,
  onRepeatMeal,
  heading = 'Comida de hoy',
  record = false,
  slot: sharedSlot,
  onPickSlot,
}: FoodLogProps) {
  const [foodId, setFoodId] = useState<string | null>(null);
  // Solo en un dia de Registros: ahi el lapiz decide si se ven los botones.
  const [writing, setWriting] = useState(false);
  const [quantity, setQuantity] = useState('1');
  // El espacio de comida en el que esta el reloj, salvo que elija otro: a las tres de la
  // tarde no esta anotando el desayuno.
  const [ownChosen, setOwnChosen] = useState<string | null>(null);
  const slot = sharedSlot ?? currentSlot(ownChosen, new Date());
  const pickSlot = onPickSlot ?? setOwnChosen;
  const repeatable = repeatableMeal(history, slot);
  // Mientras se anota no acepta otro toque: el segundo anotaba la comida entera otra vez.
  const [repeating, setRepeating] = useState(false);
  const [repeatNote, setRepeatNote] = useState<string | null>(null);
  // Una burbuja abierta a la vez: la de otra porcion se cierra sola.
  // La cantidad no sirve sin la unidad y el boton de al lado, asi que lo que se sube
  // por encima del teclado es la fila entera.
  const addRow = useRef<View>(null);

  const selected = foods.find((food) => food.id === foodId) ?? null;
  const parsed = Number(quantity);
  const canAdd = selected !== null && Number.isFinite(parsed) && parsed > 0;

  const mark = (nutrient: string) => totalMark(totals, nutrient);
  const kcal = totals === null ? null : Math.round(totals.kcal);

  // Lo mismo en las dos formas: la lista de lo anotado y lo que hace falta para anotar.
  const shown = !record || writing;

  const eaten = (
    <>
      {portions.length === 0 ? (
        <Text style={styles.empty}>Nada por ahora. Abajo eliges y anotas.</Text>
      ) : (
        portions.map((portion, index) => (
          <View key={portion.entryId} style={[styles.entry, index > 0 && styles.ruled]}>
            <View style={styles.entryRow}>
              <InfoDot accessibilityLabel={`Qué aporta ${portion.food.name}`}>
                <PortionMacros food={portion.food} quantity={portion.quantity} />
              </InfoDot>
              <View style={styles.entryText}>
                <Text style={styles.entryName}>{portionLabel(portion.food, portion.quantity)}</Text>
                <Text style={styles.entryMeta}>{portion.mealSlot}</Text>
              </View>
              {shown && (
                <ConfirmButton
                  icon={Trash}
                  question={`¿Quitar ${portion.food.name}?`}
                  accessibilityLabel={`Quitar ${portion.food.name}`}
                  onConfirm={() => onRemove(portion.entryId)}
                />
              )}
            </View>
          </View>
        ))
      )}
    </>
  );

  const picker = (
    <>
      <View style={styles.chips}>
        {MEAL_SLOTS.map((name) => (
          <Chip key={name} label={name} selected={name === slot} onPress={() => pickSlot(name)} />
        ))}
      </View>

      {repeatable && onRepeatMeal && (
        <Button
          label={`Repetir ${slot} del ${shortDate(repeatable.date)} · ${
            repeatable.entries.length
          } ${repeatable.entries.length === 1 ? 'cosa' : 'cosas'}`}
          accessibilityLabel={`Repetir ${slot} del ${shortDate(repeatable.date)}`}
          icon={RotateCcw}
          block
          loading={repeating}
          onPress={() => {
            if (repeating) return;
            setRepeating(true);
            setRepeatNote(null);
            onRepeatMeal(repeatable, slot)
              .then((skipped) => {
                pickSlot(null);
                if (skipped > 0) {
                  setRepeatNote(
                    skipped === 1
                      ? 'Una porción de olla no se anotó: esa olla ya se acabó.'
                      : `${skipped} porciones de olla no se anotaron: esas ollas ya se acabaron.`,
                  );
                }
              })
              .catch((error: unknown) => {
                console.error(error);
                setRepeatNote(
                  `No se repitió: ${error instanceof Error ? error.message : String(error)}`,
                );
              })
              .finally(() => setRepeating(false));
          }}
        />
      )}
      {repeatNote && <Text style={styles.repeatNote}>{repeatNote}</Text>}

      <FoodPicker
        foods={foods}
        history={history}
        slot={slot}
        selectedId={foodId}
        onOpenCatalogue={onOpenCatalogue}
        onSelect={(food) => {
          // El mismo otra vez lo suelta: es como se deshace un toque sin querer.
          if (food.id === foodId) {
            setFoodId(null);
            return;
          }
          setFoodId(food.id);
          // Con la cantidad de la ultima vez ya puesta, anotar son dos toques.
          setQuantity(roundAmount(history.lastQuantity.get(food.id) ?? 1));
        }}
      />

      {selected && (
        <View style={styles.chips}>
          {quickAmountsFor(selected).map((amount) => (
            <Chip
              key={amount}
              label={`${amount} ${unitLabel(selected, amount)}`}
              selected={quantity === String(amount)}
              onPress={() => setQuantity(String(amount))}
            />
          ))}
        </View>
      )}

      {/* Sin alimento elegido no hay nada que anotar, y un boton de agregar suelto
            es un toque sin querer. */}
      {selected && (
        <View ref={addRow} collapsable={false} style={styles.addRow}>
          <NumericField
            value={quantity}
            onChange={setQuantity}
            allowDecimal
            accessibilityLabel="Cantidad"
            reveals={addRow}
            style={styles.input}
            focusedStyle={styles.inputWriting}
          />
          <Text style={styles.unit}>{unitLabel(selected, parsed)}</Text>
          <Button
            label="Agregar"
            accessibilityLabel="Agregar comida"
            variant="primary"
            icon={Plus}
            disabled={!canAdd}
            style={styles.add}
            onPress={() => {
              if (!canAdd) return;
              onAdd({
                foodId: selected.id,
                quantity: parsed,
                unit: selected.base_unit,
                mealSlot: slot,
              });
              // Anotado es terminado: se suelta el alimento y vuelve la lista, que es lo
              // que hace falta para anotar lo siguiente, y el espacio vuelve al del reloj.
              setFoodId(null);
              pickSlot(null);
            }}
          />
        </View>
      )}
    </>
  );

  if (record) {
    return (
      <View
        style={styles.wrapper}
        onStartShouldSetResponder={foodId === null ? undefined : () => true}
        onResponderRelease={foodId === null ? undefined : () => setFoodId(null)}
      >
        <Card>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>Comida</Text>
            <IconButton
              icon={Pencil}
              selected={writing}
              accessibilityLabel={writing ? 'Dejar de anotar' : 'Anotar comida'}
              onPress={() => setWriting((open) => !open)}
            />
          </View>

          {totals && (
            <NutritionStats
              totals={totals}
              proteinBand={proteinBand}
              kcalBand={kcalBand}
              fatBand={fatBand}
              record={record}
            />
          )}
          {eaten}

          {writing && <View style={styles.writing}>{picker}</View>}
        </Card>
      </View>
    );
  }

  return (
    // Tocar donde no hay nada suelta el alimento elegido, igual que el teclado: un
    // boton o una fila se quedan con el toque antes de llegar aqui.
    <View
      style={styles.wrapper}
      onStartShouldSetResponder={foodId === null ? undefined : () => true}
      onResponderRelease={foodId === null ? undefined : () => setFoodId(null)}
    >
      {/* Las calorias son el numero grande y la proteina va en la estrella: la meta de
          proteina es la que decide si el dia de comida cuenta, y es la que tiene que
          verse sin leer nada. El titulo de la cartilla de metas tambien dice
          "Calorias" y "Proteina"; el rotulo de aqui es lo que separa lo comido de lo
          que toca comer. */}
      <Card tone="info">
        <View style={styles.heroRow}>
          <View style={styles.heroSide}>
            <Text style={styles.heroEyebrow}>{heading.toUpperCase()}</Text>
            <Text style={styles.heroValue}>
              {kcal === null ? '—' : kcal}
              {kcal === null ? '' : mark('kcal')}
            </Text>
            <Text style={styles.heroNote}>
              {kcal === null
                ? 'Todavía no anotaste nada'
                : kcalBand === null
                  ? 'kcal · sin metas todavía'
                  : `kcal · ${kcalAgainstBand(kcal, kcalBand)}`}
            </Text>
          </View>
          <View style={styles.heroStar}>
            <Star size={78} color={theme.surface} style={styles.star}>
              <Text style={styles.starValue}>
                {totals === null ? '—' : Math.round(totals.proteinG)}
              </Text>
            </Star>
            <Text style={styles.starLabel}>g de proteína{mark('protein_g')}</Text>
            {proteinBand && <Text style={styles.starLabel}>meta {proteinBand.from} o más</Text>}
          </View>
        </View>
      </Card>

      {totals && (
        <Card title="Lo que llevas">
          <NutritionStats
            totals={totals}
            proteinBand={proteinBand}
            kcalBand={kcalBand}
            fatBand={fatBand}
            record={record}
          />
        </Card>
      )}

      <Card title="Lo anotado">{eaten}</Card>

      <Card title="Anotar">{picker}</Card>
    </View>
  );
}

const styles = sheet((theme) => ({
  repeatNote: {
    fontSize: 13,
    fontFamily: font.bold,
    color: theme.text,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  cardTitle: {
    fontSize: 15,
    fontFamily: font.black,
    letterSpacing: 0.3,
    color: theme.text,
  },
  writing: {
    gap: 10,
    borderTopWidth: shape.border,
    borderTopColor: theme.line,
    paddingTop: 10,
    marginTop: 4,
  },
  wrapper: {
    alignSelf: 'stretch',
    gap: 12,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  heroSide: {
    flexShrink: 1,
  },
  heroEyebrow: {
    fontSize: 11,
    fontFamily: font.black,
    letterSpacing: 1.2,
    color: theme.accentInkSoft,
  },
  heroValue: {
    fontSize: 48,
    lineHeight: 54,
    fontFamily: font.display,
    color: theme.accentInk,
    fontVariant: ['tabular-nums'],
  },
  heroNote: {
    fontSize: 12,
    fontFamily: font.bold,
    color: theme.accentInk,
  },
  heroStar: {
    alignItems: 'center',
    gap: 2,
  },
  star: {
    // Pegada un poco torcida: es un sticker, no un icono alineado a la rejilla.
    transform: [{ rotate: '-8deg' }],
  },
  starValue: {
    fontSize: 26,
    fontFamily: font.black,
    color: theme.text,
    fontVariant: ['tabular-nums'],
  },
  starLabel: {
    fontSize: 11,
    fontFamily: font.bold,
    color: theme.accentInkSoft,
  },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  stat: {
    flexGrow: 1,
    flexBasis: '28%',
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.bg,
    paddingHorizontal: 8,
    paddingVertical: 7,
    gap: 1,
  },
  statAlert: {
    backgroundColor: theme.warnBg,
  },
  statLabel: {
    fontSize: 10,
    fontFamily: font.black,
    letterSpacing: 0.6,
    color: theme.textFaint,
    textTransform: 'uppercase',
  },
  statValue: {
    fontSize: 16,
    fontFamily: font.black,
    color: theme.text,
    fontVariant: ['tabular-nums'],
  },
  statNote: {
    fontSize: 10,
    fontFamily: font.regular,
    color: theme.textFaint,
    fontVariant: ['tabular-nums'],
  },
  gap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.warnBg,
    padding: 8,
  },
  gapText: {
    flex: 1,
    fontSize: 12,
    fontFamily: font.regular,
    color: theme.text,
  },
  empty: {
    fontSize: 13,
    fontFamily: font.regular,
    color: theme.textFaint,
  },
  entry: {
    gap: 6,
    paddingTop: 2,
  },
  ruled: {
    borderTopWidth: shape.border,
    borderTopColor: theme.line,
    paddingTop: 10,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  entryText: {
    flex: 1,
    gap: 1,
  },
  entryName: {
    fontSize: 15,
    fontFamily: font.black,
    color: theme.text,
  },
  entryMeta: {
    fontSize: 12,
    fontFamily: font.regular,
    color: theme.textFaint,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: shape.border,
    borderTopColor: theme.line,
    paddingTop: 10,
  },
  input: {
    width: 84,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.surface,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 17,
    fontFamily: font.black,
    color: theme.text,
    fontVariant: ['tabular-nums'],
  },
  inputWriting: {
    backgroundColor: theme.surfaceHigh,
  },
  unit: {
    flex: 1,
    fontSize: 13,
    fontFamily: font.bold,
    color: theme.textFaint,
  },
  add: {
    minWidth: 130,
  },
}));
