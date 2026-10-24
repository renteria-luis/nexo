import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { NutritionFoodRow } from '../db/types.ts';
import {
  matchesSearch,
  referenceAmount,
  roundAmount,
  unitLabel,
  type FoodHistory,
} from '../nutrition/index.ts';

import { Button } from './Button.tsx';
import { IconButton } from './IconButton.tsx';
import { ChevronDown, ChevronUp, Pencil } from './icons.ts';
import { SearchField } from './SearchField.tsx';
import { font, pressed as pressedInto, sheet, shape } from './theme.ts';

/**
 * De donde elige el alimento que va a anotar.
 *
 * Una pared de botones sueltos deja de servir en cuanto hay veinte: no se puede
 * buscar y no se puede barrer con la vista. Aqui se escribe para encontrar, y sin
 * escribir nada arriba esta lo que suele comer en ese espacio de comida, que es lo
 * que va a anotar nueve de cada diez veces.
 */
export type FoodPickerProps = {
  foods: NutritionFoodRow[];
  history: FoodHistory;
  /** El espacio de comida elegido, que es el que manda en las sugerencias. */
  slot: string;
  selectedId: string | null;
  /** Lo que lleva escrito para el elegido: su fila dice lo que trae esa porcion. */
  quantity: number;
  onSelect: (food: NutritionFoodRow) => void;
  /** Lleva al catalogo, que es donde se crean y se corrigen. */
  onOpenCatalogue: () => void;
};

/** Cuantos salen arriba sin que la pantalla se vuelva otra lista larga (decision 2026-10-10). */
const USUAL_SHOWN = 2;
const RECENT_SHOWN = 3;

/**
 * Los macros por unidad contable, o por cien gramos o mililitros. Con una porcion escrita,
 * los de esa porcion: con 200 g de pechuga elegidos decia lo de 100 g, y lo que iba a
 * anotar habia que sacarlo de cabeza.
 */
function macros(food: NutritionFoodRow, quantity = 0): string {
  const portion = Number.isFinite(quantity) && quantity > 0;
  const per = portion ? quantity : referenceAmount(food);
  const unit = portion
    ? `${roundAmount(quantity)} ${unitLabel(food, quantity)}`
    : food.unit_kind === 'count'
      ? food.base_unit
      : `100 ${food.base_unit}`;
  const round = (value: number) => roundAmount(Math.round(value * 10) / 10);
  return `${unit} · ${round(food.kcal * per)} kcal · ${round(food.protein_g * per)} g P`;
}

function Row({
  food,
  selected,
  quantity,
  onSelect,
}: {
  food: NutritionFoodRow;
  selected: boolean;
  quantity?: number;
  onSelect: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={food.name}
      onPress={onSelect}
      style={({ pressed }) => [
        styles.row,
        selected ? styles.rowOn : styles.rowOff,
        pressed && (selected ? styles.pressed : styles.pressedFlat),
      ]}
    >
      {/* Sobre el ambar, tinta oscura como todo lo relleno: en claro no se leia. */}
      <Text style={[styles.rowName, selected && styles.inkOn]} numberOfLines={1}>
        {food.name}
      </Text>
      <Text style={[styles.rowMacros, selected && styles.inkSoftOn]}>{macros(food, quantity)}</Text>
    </Pressable>
  );
}

export function FoodPicker({
  foods,
  history,
  slot,
  selectedId,
  quantity,
  onSelect,
  onOpenCatalogue,
}: FoodPickerProps) {
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);

  const byId = new Map(foods.map((food) => [food.id, food]));
  const searching = search.trim() !== '';

  const found = foods.filter((food) =>
    matchesSearch([food.name, food.brand, food.store, food.keywords], search),
  );

  const pick = (
    ids: readonly string[],
    already: Set<string>,
    limit: number,
  ): NutritionFoodRow[] => {
    const rows: NutritionFoodRow[] = [];
    for (const id of ids) {
      const food = byId.get(id);
      if (!food || already.has(id)) continue;
      already.add(id);
      rows.push(food);
      if (rows.length === limit) break;
    }
    return rows;
  };

  const taken = new Set<string>();
  const usual = pick(history.usualBySlot.get(slot) ?? [], taken, USUAL_SHOWN);
  const recent = pick(history.recent, taken, RECENT_SHOWN);
  const rest = foods.filter((food) => !taken.has(food.id));

  // Por tienda cuando se abre la lista entera: es como estan en su cabeza cuando
  // recuerda de donde salio algo, y deja "otros" para lo que no tiene tienda.
  const stores = new Map<string, NutritionFoodRow[]>();
  for (const food of rest) {
    const store = food.store ?? 'otros';
    stores.set(store, [...(stores.get(store) ?? []), food]);
  }

  const row = (food: NutritionFoodRow) => (
    <Row
      key={food.id}
      food={food}
      selected={food.id === selectedId}
      onSelect={() => onSelect(food)}
    />
  );

  // Con algo elegido, la lista entera sobra: lo que sigue es la cantidad, que esta
  // justo debajo. Y volver a tocarlo lo suelta, que es como se deshace un toque.
  const chosen = selectedId === null ? null : foods.find((food) => food.id === selectedId);
  if (chosen) {
    return (
      <View style={styles.picker}>
        <Row food={chosen} selected quantity={quantity} onSelect={() => onSelect(chosen)} />
      </View>
    );
  }

  return (
    <View style={styles.picker}>
      <View style={styles.searchRow}>
        <SearchField
          value={search}
          onChange={setSearch}
          accessibilityLabel="Buscar un alimento"
          style={styles.grow}
        />
        <IconButton
          icon={Pencil}
          accessibilityLabel="Editar los alimentos"
          onPress={onOpenCatalogue}
        />
      </View>

      {searching ? (
        found.length === 0 ? (
          <Text style={styles.empty}>
            Nada con ese nombre. Con el lápiz lo agregas o le pones palabras clave.
          </Text>
        ) : (
          found.map(row)
        )
      ) : (
        <>
          {usual.length > 0 && (
            <>
              <Text style={styles.section}>de siempre en {slot}</Text>
              {usual.map(row)}
            </>
          )}

          {recent.length > 0 && (
            <>
              <Text style={styles.section}>recientes</Text>
              {recent.map(row)}
            </>
          )}

          {rest.length > 0 && (
            <>
              <Button
                label={showAll ? 'Esconder el resto' : `Ver los otros ${rest.length}`}
                accessibilityLabel={showAll ? 'Esconder el resto' : 'Ver todos los alimentos'}
                variant="ghost"
                icon={showAll ? ChevronUp : ChevronDown}
                style={styles.more}
                onPress={() => setShowAll((open) => !open)}
              />
              {showAll &&
                [...stores.entries()].map(([store, items]) => (
                  <View key={store} style={styles.store}>
                    <Text style={styles.section}>{store}</Text>
                    {items.map(row)}
                  </View>
                ))}
            </>
          )}
        </>
      )}
    </View>
  );
}

const styles = sheet((theme) => ({
  picker: {
    gap: 6,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  grow: {
    flex: 1,
  },
  section: {
    fontSize: 11,
    fontFamily: font.black,
    letterSpacing: 0.8,
    color: theme.textFaint,
    textTransform: 'uppercase',
    marginTop: 4,
  },
  store: {
    gap: 6,
  },
  more: {
    alignSelf: 'flex-start',
  },
  row: {
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 1,
  },
  rowOn: {
    backgroundColor: theme.accent,
  },
  rowOff: {
    backgroundColor: theme.surface,
  },
  pressed: pressedInto(),
  pressedFlat: {
    opacity: 0.6,
  },
  rowName: {
    fontSize: 14,
    fontFamily: font.black,
    color: theme.text,
  },
  inkOn: {
    color: theme.accentInk,
  },
  inkSoftOn: {
    color: theme.accentInkSoft,
  },
  rowMacros: {
    fontSize: 11,
    fontFamily: font.regular,
    color: theme.textFaint,
    fontVariant: ['tabular-nums'],
  },
  empty: {
    fontSize: 13,
    fontFamily: font.regular,
    color: theme.textFaint,
  },
}));
