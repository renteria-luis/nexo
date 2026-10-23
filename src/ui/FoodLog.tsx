import { useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { fatAgainstBand, kcalAgainstBand, proteinAgainstBand } from '../core/targets.ts';
import type { NutritionFoodRow } from '../db/types.ts';
import {
  MEAL_SLOTS,
  SODIUM_FLAG_MG,
  chooseSlot,
  currentSlot,
  portionLabel,
  quickAmountsFor,
  roundAmount,
  unitLabel,
  type ChosenSlot,
  type FoodHistory,
  type LoggedPortion,
  type NewFoodEntry,
  type NutritionTotals,
} from '../nutrition/index.ts';

import { Button } from './Button.tsx';
import { Card } from './Card.tsx';
import { Chip } from './Chip.tsx';
import { FoodPicker } from './FoodPicker.tsx';
import { ConfirmButton, InfoDot } from './InfoBubble.tsx';
import {
  Coffee,
  Moon,
  Pencil,
  Plus,
  Sun,
  Sunrise,
  Sunset,
  Trash,
  TriangleAlert,
  type LucideIcon,
} from './icons.ts';
import { IconButton } from './IconButton.tsx';
import { NumericField } from './NumericField.tsx';
import { PortionMacros } from './PortionMacros.tsx';
import { font, sheet, shape, theme } from './theme.ts';

/** El espacio de comida por su hora del dia: amanecer, cafe, sol, atardecer y luna. */
const SLOT_ICONS: Record<string, LucideIcon> = {
  desayuno: Sunrise,
  'media mañana': Coffee,
  mediodía: Sun,
  tarde: Sunset,
  cena: Moon,
};

/** Un macro del dia en su cuadrito: el nombre arriba, el numero grande debajo. */
function Stat({
  label,
  value,
  note,
  alert = false,
  tint,
  wide = false,
}: {
  label: string;
  value: string;
  note?: string;
  alert?: boolean;
  /** Las dos metas del dia, calorias y proteina, van grandes y con su color. */
  tint?: string;
  /** Sola en su linea. */
  wide?: boolean;
}) {
  // Un solo cuadrito para todos: las dos metas llevan su color con tinta oscura encima,
  // y lo que se pasa de su limite lo dice en la nota y no con otro fondo (2026-10-23).
  const filled = tint !== undefined;
  return (
    <View style={[styles.stat, wide && styles.statWide, filled && { backgroundColor: tint }]}>
      <Text style={[styles.statLabel, filled && styles.onTintSoft]}>{label}</Text>
      <Text style={[styles.statValue, filled && styles.statValueBig, filled && styles.onTint]}>
        {value}
      </Text>
      {note ? (
        <Text style={[styles.statNote, filled && styles.onTintSoft, alert && styles.statAlert]}>
          {note}
        </Text>
      ) : null}
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
  /** Lo que eligio a mano. */
  onPickSlot?: (slot: string) => void;
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
  const protein = Math.round(totals.proteinG);
  const fat = fatBand === null ? null : fatAgainstBand(totals.fatG, fatBand, record);

  return (
    <>
      {/* Las calorias solas en la primera linea y la proteina al frente de la segunda,
          grandes y con su color: son las dos metas del dia (2026-10-10). */}
      <View style={styles.stats}>
        <Stat
          label="Calorías"
          value={`${kcal}${mark('kcal')}`}
          note={kcalBand === null ? undefined : kcalAgainstBand(kcal, kcalBand)}
          tint={theme.info}
          wide
        />
        <Stat
          label="Proteína"
          value={`${protein}${mark('protein_g')} g`}
          note={proteinBand === null ? undefined : proteinAgainstBand(protein, proteinBand)}
          tint={theme.protein}
        />
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
        {/* Spec 7.5: glycemic load needs an index. */}
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
  const [ownChosen, setOwnChosen] = useState<ChosenSlot | null>(null);
  const slot = sharedSlot ?? currentSlot(ownChosen, new Date());
  const pickSlot = onPickSlot ?? ((name: string) => setOwnChosen(chooseSlot(name, new Date())));
  // Una burbuja abierta a la vez: la de otra porcion se cierra sola.
  // La cantidad no sirve sin la unidad y el boton de al lado, asi que lo que se sube
  // por encima del teclado es la fila entera.
  const addRow = useRef<View>(null);

  const selected = foods.find((food) => food.id === foodId) ?? null;
  const parsed = Number(quantity);
  const canAdd = selected !== null && Number.isFinite(parsed) && parsed > 0;

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
      <View style={[styles.chips, styles.slots]}>
        {/* Iconos que siguen el dia y el nombre solo en el elegido: con los cinco nombres
            escritos, "cena" bajaba a otra fila (decision 2026-10-10). */}
        {MEAL_SLOTS.map((name) => (
          <Chip
            key={name}
            label={name === slot ? name : ''}
            icon={SLOT_ICONS[name]}
            accessibilityLabel={name}
            selected={name === slot}
            onPress={() => pickSlot(name)}
            style={styles.slot}
          />
        ))}
      </View>

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
              // que hace falta para anotar lo siguiente. El espacio se queda.
              setFoodId(null);
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
      {/* Anotar primero: es a lo que entra dos o tres veces al dia, y los totales y la
          lista, que crecen con el dia, lo empujaban hacia abajo. Sin nada anotado no hay
          totales ni lista que mostrar (2026-10-23). */}
      <Card title="Anotar">{picker}</Card>

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

      {portions.length > 0 && <Card title="Lo anotado">{eaten}</Card>}
    </View>
  );
}

const styles = sheet((theme) => ({
  // Mas juntos que los demas chips: los cinco caben en una fila desde 375 puntos de ancho,
  // tambien con "media mañana" escrito.
  slots: {
    gap: 4,
  },
  slot: {
    paddingHorizontal: 9,
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
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  stat: {
    flexGrow: 1,
    // Dos por linea: proteina y carbos, grasa y sodio.
    flexBasis: '40%',
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.surface,
    paddingHorizontal: 8,
    paddingVertical: 7,
    gap: 1,
  },
  statWide: {
    flexBasis: '100%',
  },
  statAlert: {
    fontFamily: font.bold,
    color: theme.warn,
  },
  onTint: {
    color: theme.accentInk,
  },
  onTintSoft: {
    color: theme.accentInkSoft,
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
  statValueBig: {
    fontSize: 28,
    lineHeight: 34,
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
