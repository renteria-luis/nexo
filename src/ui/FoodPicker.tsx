import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { NutritionFoodRow } from '../db/types.ts';
import { matchesSearch, roundAmount, type FoodHistory } from '../nutrition/index.ts';

import { mono, theme } from './theme.ts';

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
  onSelect: (food: NutritionFoodRow) => void;
  /** Lleva al catalogo, que es donde se crean y se corrigen. */
  onOpenCatalogue: () => void;
};

/** Cuantos caben arriba sin que la pantalla se vuelva otra lista larga. */
const SUGGESTIONS = 5;

/** Los macros por unidad contable, o por cien gramos o mililitros. */
function macros(food: NutritionFoodRow): string {
  const per = food.unit_kind === 'count' ? 1 : 100;
  const unit = food.unit_kind === 'count' ? food.base_unit : `100 ${food.base_unit}`;
  return `${unit} · ${roundAmount(food.kcal * per)} kcal · ${roundAmount(food.protein_g * per)} g P`;
}

function Row({
  food,
  selected,
  onSelect,
}: {
  food: NutritionFoodRow;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={food.name}
      onPress={onSelect}
      style={[styles.row, selected && styles.rowSelected]}
    >
      <Text style={styles.rowName} numberOfLines={1}>
        {food.name}
      </Text>
      <Text style={styles.rowMacros}>{macros(food)}</Text>
    </Pressable>
  );
}

export function FoodPicker({
  foods,
  history,
  slot,
  selectedId,
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

  const pick = (ids: readonly string[], already: Set<string>): NutritionFoodRow[] => {
    const rows: NutritionFoodRow[] = [];
    for (const id of ids) {
      const food = byId.get(id);
      if (!food || already.has(id)) continue;
      already.add(id);
      rows.push(food);
      if (rows.length === SUGGESTIONS) break;
    }
    return rows;
  };

  const taken = new Set<string>();
  const usual = pick(history.usualBySlot.get(slot) ?? [], taken);
  const recent = pick(history.recent, taken);
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

  return (
    <View style={styles.picker}>
      <View style={styles.searchRow}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          accessibilityLabel="Buscar un alimento"
          placeholder="buscar"
          placeholderTextColor={theme.textGhost}
          autoCorrect={false}
          style={styles.search}
        />
        {searching && (
          <Pressable accessibilityLabel="Borrar la búsqueda" onPress={() => setSearch('')}>
            <Text style={styles.clear}>borrar</Text>
          </Pressable>
        )}
        <Pressable
          accessibilityLabel="Editar los alimentos"
          onPress={onOpenCatalogue}
          style={styles.new}
        >
          <Text style={styles.newText}>editar ›</Text>
        </Pressable>
      </View>

      {searching ? (
        found.length === 0 ? (
          <Text style={styles.empty}>
            Nada con ese nombre. En &quot;editar&quot; lo agregas o le pones palabras clave.
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
              <Pressable
                accessibilityLabel={showAll ? 'Esconder el resto' : 'Ver todos los alimentos'}
                onPress={() => setShowAll((open) => !open)}
              >
                <Text style={styles.section}>
                  {showAll ? '— todos' : `+ los otros ${rest.length}`}
                </Text>
              </Pressable>
              {showAll &&
                [...stores.entries()].map(([store, items]) => (
                  <View key={store}>
                    <Text style={styles.store}>{store}</Text>
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

const styles = StyleSheet.create({
  picker: {
    gap: 2,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  search: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.lineSoft,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    fontFamily: mono,
    color: theme.text,
  },
  clear: {
    fontSize: 11,
    fontFamily: mono,
    color: theme.textFaint,
  },
  new: {
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  newText: {
    fontSize: 12,
    fontFamily: mono,
    color: theme.text,
  },
  section: {
    fontSize: 10,
    fontFamily: mono,
    color: theme.accent,
    marginTop: 8,
    marginBottom: 2,
  },
  store: {
    fontSize: 10,
    fontFamily: mono,
    color: theme.textGhost,
    marginTop: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowSelected: {
    borderColor: theme.lineStrong,
    backgroundColor: theme.surfaceHigh,
  },
  rowName: {
    flexShrink: 1,
    fontSize: 13,
    fontFamily: mono,
    color: theme.text,
  },
  rowMacros: {
    fontSize: 10,
    fontFamily: mono,
    color: theme.textGhost,
  },
  empty: {
    fontSize: 11,
    fontFamily: mono,
    color: theme.textGhost,
    paddingVertical: 8,
  },
});
