import { useState } from 'react';
import { Text, View } from 'react-native';

import type { NutritionFoodRow } from '../db/types.ts';
import { matchesSearch } from '../nutrition/index.ts';
import {
  newId,
  type Ingredient,
  type NewRecipe,
  type PantryItem,
  type Recipe,
} from '../pantry/index.ts';

import { Button } from './Button.tsx';
import { Chip } from './Chip.tsx';
import { ConfirmButton } from './InfoBubble.tsx';
import { Plus, Trash } from './icons.ts';
import { NumericField } from './NumericField.tsx';
import { PopupSheet } from './PopupSheet.tsx';
import { SearchField } from './SearchField.tsx';
import { TextField } from './TextField.tsx';
import { font, sheet, shape } from './theme.ts';

/**
 * Escribir una receta: el nombre, en cuantas porciones sale, sus ingredientes y los
 * pasos.
 *
 * Los ingredientes salen de la despensa y no de una lista aparte, que es lo que permite
 * responder "esto se puede hacer ahora" (spec 21.3). Lo duradero y las especias entran
 * sin cantidad porque no se miden.
 *
 * Lo que no esta en la despensa se busca tambien en sus alimentos, y al guardar entra a
 * la despensa en cero, asi la receta lo nombra como faltante. Buscar "arroz" sin tenerlo
 * no encontraba nada y la receta no se podia escribir (2026-10-23).
 */
export function RecipeForm({
  recipe,
  pantry,
  foods,
  onSave,
  onCancel,
}: {
  recipe: Recipe | null;
  pantry: readonly PantryItem[];
  foods: readonly NutritionFoodRow[];
  /** `stocked` es lo que entra a la despensa con la receta, antes que ella. */
  onSave: (recipe: NewRecipe, stocked: PantryItem[]) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(recipe?.name ?? '');
  // Vacio en una receta nueva: con 4 puesto de entrada, la proteina por porcion salia de
  // un numero que el no eligio (2026-10-24).
  const [portions, setPortions] = useState(recipe === null ? '' : String(recipe.portions));
  const [steps, setSteps] = useState(recipe?.steps ?? '');
  const [ingredients, setIngredients] = useState<Ingredient[]>(recipe?.ingredients ?? []);
  const [search, setSearch] = useState('');
  const [stocked, setStocked] = useState<PantryItem[]>([]);

  const byId = new Map([...pantry, ...stocked].map((item) => [item.id, item]));
  const measured = (item: PantryItem) => item.kind === 'counted' || item.kind === 'weighed';

  const unmeasured = ingredients.some((one) => {
    const item = byId.get(one.itemId);
    return item !== undefined && measured(item) && one.amount === null;
  });

  const searching = search.trim() !== '';
  const found = !searching
    ? []
    : pantry
        .filter(
          (item) =>
            matchesSearch([item.name], search) &&
            !ingredients.some((one) => one.itemId === item.id),
        )
        .slice(0, 6);
  const elsewhere = !searching
    ? []
    : foods
        .filter(
          (food) =>
            matchesSearch([food.name, food.brand, food.store, food.keywords], search) &&
            ![...pantry, ...stocked].some((item) => item.foodId === food.id),
        )
        .slice(0, 4);

  const add = (item: PantryItem) => {
    // Contado arranca en uno; pesado, vacio: un 1 g puesto se guardaba sin que lo viera.
    setIngredients((before) => [
      ...before,
      { itemId: item.id, amount: item.kind === 'counted' ? 1 : null },
    ]);
    setSearch('');
  };

  // En la unidad de su alimento, como pide la despensa (spec 21.1).
  const stock = (food: NutritionFoodRow) => {
    const item: PantryItem = {
      id: newId('pantry'),
      name: food.name,
      kind: food.unit_kind === 'count' ? 'counted' : 'weighed',
      quantity: 0,
      unit: food.base_unit,
      state: null,
      hasIt: null,
      foodId: food.id,
    };
    setStocked((before) => [...before, item]);
    add(item);
  };

  const count = Number(portions);
  const ready = name.trim() !== '' && !unmeasured && Number.isInteger(count) && count >= 1;
  const save = () => {
    if (!ready) return;
    onSave(
      {
        id: recipe?.id,
        name: name.trim(),
        steps: steps.trim(),
        portions: count,
        ingredients,
      },
      stocked.filter((item) => ingredients.some((one) => one.itemId === item.id)),
    );
  };

  return (
    <PopupSheet>
      <Text style={styles.title}>{recipe === null ? 'Receta nueva' : recipe.name}</Text>
      <Text style={styles.label}>Cómo se llama</Text>
      <TextField
        value={name}
        onChange={setName}
        accessibilityLabel="Nombre de la receta"
        placeholder="Pollo con arroz"
        style={styles.input}
        focusedStyle={styles.writing}
      />

      <Text style={styles.label}>En cuántas porciones sale</Text>
      <NumericField
        value={portions}
        onChange={setPortions}
        accessibilityLabel="Porciones"
        style={styles.short}
        focusedStyle={styles.writing}
      />

      <Text style={styles.label}>Con qué</Text>
      {ingredients.length === 0 ? (
        <Text style={styles.empty}>Nada todavía. Búscalo abajo.</Text>
      ) : (
        ingredients.map((ingredient) => {
          const item = byId.get(ingredient.itemId);
          if (item === undefined) return null;
          return (
            <View key={ingredient.itemId} style={styles.row}>
              <Text style={styles.name}>{item.name}</Text>
              {measured(item) ? (
                <>
                  <NumericField
                    value={String(ingredient.amount ?? '')}
                    allowDecimal={item.kind === 'weighed'}
                    accessibilityLabel={`Cuánto ${item.name}`}
                    onChange={(next) =>
                      setIngredients((before) =>
                        before.map((one) =>
                          one.itemId === ingredient.itemId
                            ? { ...one, amount: Number(next) || null }
                            : one,
                        ),
                      )
                    }
                    style={styles.short}
                    focusedStyle={styles.writing}
                  />
                  <Text style={styles.unit}>{item.unit}</Text>
                </>
              ) : (
                <Text style={styles.unit}>al gusto</Text>
              )}
              <ConfirmButton
                icon={Trash}
                question={`¿Quitar ${item.name} de la receta?`}
                accessibilityLabel={`Quitar ${item.name}`}
                onConfirm={() =>
                  setIngredients((before) =>
                    before.filter((one) => one.itemId !== ingredient.itemId),
                  )
                }
              />
            </View>
          );
        })
      )}

      <SearchField
        value={search}
        onChange={setSearch}
        accessibilityLabel="Buscar un ingrediente"
        note={`${pantry.length} cosas en la despensa`}
      />
      {found.length > 0 && (
        <View style={styles.chips}>
          {found.map((item) => (
            <Chip
              key={item.id}
              label={item.name}
              accessibilityLabel={`Agregar ${item.name}`}
              onPress={() => add(item)}
            />
          ))}
        </View>
      )}
      {elsewhere.length > 0 && (
        <>
          <Text style={styles.label}>Fuera de la despensa</Text>
          <View style={styles.chips}>
            {elsewhere.map((food) => (
              <Chip
                key={food.id}
                label={food.name}
                icon={Plus}
                accessibilityLabel={`Agregar ${food.name}, que no está en la despensa`}
                onPress={() => stock(food)}
              />
            ))}
          </View>
        </>
      )}
      {searching && found.length === 0 && elsewhere.length === 0 && (
        <Text style={styles.empty}>
          Nada con «{search.trim()}» en la despensa ni en tus alimentos.
        </Text>
      )}

      <Text style={styles.label}>Cómo se hace</Text>
      <TextField
        value={steps}
        onChange={setSteps}
        multiline
        accessibilityLabel="Pasos"
        placeholder="Un paso por línea"
        style={styles.steps}
        focusedStyle={styles.writing}
      />

      <View style={styles.actions}>
        <Button
          label="Guardar"
          accessibilityLabel="Guardar la receta"
          variant="primary"
          disabled={!ready}
          onPress={save}
        />
        <Button label="Cancelar" accessibilityLabel="Cancelar" variant="ghost" onPress={onCancel} />
      </View>
    </PopupSheet>
  );
}

const styles = sheet((theme) => ({
  title: { fontSize: 18, fontFamily: font.black, color: theme.text },
  label: {
    fontSize: 11,
    fontFamily: font.black,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: theme.textFaint,
    marginTop: 6,
  },
  empty: {
    fontSize: 13,
    fontFamily: font.regular,
    color: theme.textFaint,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  name: {
    flex: 1,
    fontSize: 14,
    fontFamily: font.bold,
    color: theme.text,
  },
  unit: {
    fontSize: 12,
    fontFamily: font.bold,
    color: theme.textDim,
  },
  input: {
    fontSize: 15,
    fontFamily: font.bold,
    color: theme.text,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.surface,
  },
  short: {
    width: 84,
    fontSize: 15,
    fontFamily: font.bold,
    color: theme.text,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.surface,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  steps: {
    minHeight: 96,
    fontSize: 14,
    fontFamily: font.regular,
    color: theme.text,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.surface,
    textAlignVertical: 'top',
  },
  writing: {
    backgroundColor: theme.surfaceHigh,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
}));
