import { useState } from 'react';
import { Text, View } from 'react-native';

import type { Ingredient, NewRecipe, PantryItem, Recipe } from '../pantry/index.ts';

import { Button } from './Button.tsx';
import { Card } from './Card.tsx';
import { Chip } from './Chip.tsx';
import { ConfirmButton } from './InfoBubble.tsx';
import { Trash } from './icons.ts';
import { NumericField } from './NumericField.tsx';
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
 */
export function RecipeForm({
  recipe,
  pantry,
  onSave,
  onCancel,
}: {
  recipe: Recipe | null;
  pantry: readonly PantryItem[];
  onSave: (recipe: NewRecipe) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(recipe?.name ?? '');
  const [portions, setPortions] = useState(String(recipe?.portions ?? 4));
  const [steps, setSteps] = useState(recipe?.steps ?? '');
  const [ingredients, setIngredients] = useState<Ingredient[]>(recipe?.ingredients ?? []);
  const [search, setSearch] = useState('');

  const byId = new Map(pantry.map((item) => [item.id, item]));
  const measured = (item: PantryItem) => item.kind === 'counted' || item.kind === 'weighed';

  const found =
    search.trim() === ''
      ? []
      : pantry
          .filter(
            (item) =>
              item.name.toLowerCase().includes(search.trim().toLowerCase()) &&
              !ingredients.some((one) => one.itemId === item.id),
          )
          .slice(0, 6);

  const save = () => {
    const count = Number(portions);
    if (name.trim() === '' || !Number.isInteger(count) || count < 1) return;
    onSave({
      id: recipe?.id,
      name: name.trim(),
      steps: steps.trim(),
      portions: count,
      ingredients,
    });
  };

  return (
    <Card title={recipe === null ? 'Receta nueva' : recipe.name}>
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
        <Text style={styles.empty}>Nada todavía. Búscalo abajo, sale de tu despensa.</Text>
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
                <Text style={styles.unit}>sin medir</Text>
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
        accessibilityLabel="Buscar en la despensa"
        note={`${pantry.length} cosas en la despensa`}
      />
      <View style={styles.chips}>
        {found.map((item) => (
          <Chip
            key={item.id}
            label={item.name}
            accessibilityLabel={`Agregar ${item.name}`}
            onPress={() => {
              setIngredients((before) => [
                ...before,
                { itemId: item.id, amount: measured(item) ? 1 : null },
              ]);
              setSearch('');
            }}
          />
        ))}
      </View>

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
          disabled={name.trim() === ''}
          onPress={save}
        />
        <Button label="Cancelar" accessibilityLabel="Cancelar" variant="ghost" onPress={onCancel} />
      </View>
    </Card>
  );
}

const styles = sheet((theme) => ({
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
    backgroundColor: theme.accent,
    color: theme.accentInk,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
}));
