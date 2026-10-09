import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { proteinBand } from '../../core/targets.ts';
import { roundAmount } from '../../nutrition/index.ts';
import {
  cookableNow,
  portionOf,
  type Cookable,
  type NeedsWeight,
  type PantryItem,
  type PotOutcome,
  type Recipe,
} from '../../pantry/index.ts';
import { useAppData } from '../../shell/AppData.tsx';

import { Button } from '../Button.tsx';
import { Card } from '../Card.tsx';
import { IconButton } from '../IconButton.tsx';
import { ConfirmButton } from '../InfoBubble.tsx';
import { ChefHat, Pencil, Plus, Trash } from '../icons.ts';
import { RecipeForm } from '../RecipeForm.tsx';
import { font, sheet, shape } from '../theme.ts';

import { Screen } from './Screen.tsx';

/**
 * El recetario. Spec 21.3.
 *
 * Ordenado por lo que se puede hacer ahora mismo con lo que hay, porque la pregunta que
 * trae aqui es "que como", no "que recetas tengo". Lo que falta se dice por su nombre:
 * una receta que no se puede hacer sin decir por que obliga a ir a mirar la despensa.
 *
 * Cocinar descuenta lo que se midio y deja la olla como un lote en Comida, de donde sale
 * cada porcion con un toque (spec 7.3). Lo duradero y las especias no se descuentan ni
 * entran en las cuentas de la olla: no se midieron.
 */
export function RecipesScreen() {
  const { state, loadPantry, loadRecipes, loadRecipePots, saveRecipe, removeRecipe, cookRecipe } =
    useAppData();
  const [pantry, setPantry] = useState<PantryItem[]>([]);
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  const [pots, setPots] = useState<Map<string, PotOutcome>>(new Map());
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<Recipe | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Decision 2026-10-02: el aviso de la olla sin lote lleva a la ficha que le falta el peso.
  const [needsWeight, setNeedsWeight] = useState<NeedsWeight[]>([]);
  const navigation = useNavigation<{ navigate: (name: string, params?: object) => void }>();
  // La receta que se esta cocinando: dos toques en "Cocinar" eran dos ollas.
  const [cooking, setCooking] = useState<string | null>(null);

  const reload = useCallback(() => {
    Promise.all([loadPantry(), loadRecipes(), loadRecipePots()])
      .then(([items, saved, previews]) => {
        setPantry(items);
        setRecipes(saved);
        setPots(previews);
      })
      .catch((error: unknown) => console.error(error));
  }, [loadPantry, loadRecipes, loadRecipePots]);

  // Spec 21.3: lo que hace una porcion al dia, contra el piso de proteina, que es la meta.
  const today = state.phase === 'ready' ? state.loaded.today : null;
  const eatenProtein = today?.nutrition?.proteinG ?? 0;
  const proteinGoal = today?.targets ? proteinBand(today.targets).from : null;
  const dayAfter = (proteinG: number): string => {
    const after = Math.round(eatenProtein + proteinG);
    if (proteinGoal === null) return `Una porción te deja en ${after} g de proteína hoy.`;
    const short = proteinGoal - after;
    return short > 0
      ? `Una porción te deja en ${after} g de proteína hoy, ${short} bajo la meta.`
      : `Una porción te deja en ${after} g de proteína hoy, ya en la meta.`;
  };

  useEffect(reload, [reload]);

  const cook = (entry: Cookable) => {
    setNotice(null);
    setNeedsWeight([]);
    setCooking(entry.recipe.id);
    cookRecipe(entry.recipe.id)
      .then((cooked) => {
        reload();
        if (cooked.batchId === null) {
          setNotice(`Descontado, pero no pude dejar el lote: ${cooked.blocked.join('; ')}.`);
          setNeedsWeight(cooked.needsWeight);
          return;
        }
        setNotice(
          `${entry.recipe.name}: ${entry.recipe.portions} porciones esperándote en Comida.`,
        );
      })
      .catch((error: unknown) => {
        console.error(error);
        setNotice(`No se pudo cocinar: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => setCooking(null));
  };

  const editor = creating || editing !== null;
  const list = recipes === null ? [] : cookableNow(recipes, pantry);

  return (
    <Screen
      title="Recetas"
      onOverlayDismiss={
        editor
          ? () => {
              setCreating(false);
              setEditing(null);
            }
          : undefined
      }
      overlay={
        editor ? (
          <RecipeForm
            recipe={editing}
            pantry={pantry}
            onCancel={() => {
              setCreating(false);
              setEditing(null);
            }}
            onSave={(recipe) => {
              setCreating(false);
              setEditing(null);
              saveRecipe(recipe)
                .then(reload)
                .catch((error: unknown) => console.error(error));
            }}
          />
        ) : null
      }
    >
      <Button
        label="Receta nueva"
        accessibilityLabel="Escribir una receta nueva"
        variant="primary"
        icon={Plus}
        block
        onPress={() => setCreating(true)}
      />

      {notice !== null && (
        <Card tone="ok">
          <Text style={styles.notice}>{notice}</Text>
          {needsWeight.map((food) => (
            <Button
              key={food.foodId}
              label={`Ponerle peso a ${food.name}`}
              accessibilityLabel={`Abrir la ficha de ${food.name} para ponerle lo que pesa`}
              onPress={() => navigation.navigate('Alimentos', { edit: food.foodId })}
            />
          ))}
          <Button
            label="Entendido"
            accessibilityLabel="Entendido"
            onPress={() => setNotice(null)}
          />
        </Card>
      )}

      {recipes !== null && recipes.length === 0 && (
        <Card>
          <Text style={styles.empty}>
            Ninguna todavía. Lo que escribas aquí se ordena solo: primero lo que puedes hacer con lo
            que hay en la despensa.
          </Text>
        </Card>
      )}

      {list.map((entry) => {
        const ready = entry.short.length === 0;
        const shown = open === entry.recipe.id;
        const pot = pots.get(entry.recipe.id);
        const portion = pot?.ok ? portionOf(pot.pot, entry.recipe.portions) : null;
        // El aceite de la sarten y la sal no se midieron (spec 21.1): no estan en la cuenta,
        // y se dice cuales para que el numero diga de donde sale.
        const unmeasured = entry.recipe.ingredients
          .map((ingredient) => pantry.find((one) => one.id === ingredient.itemId))
          .filter(
            (item) => item !== undefined && (item.kind === 'durable' || item.kind === 'spice'),
          )
          .map((item) => item!.name);
        return (
          <Card key={entry.recipe.id} tone={ready ? 'accent' : 'paper'}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={entry.recipe.name}
              onPress={() => setOpen(shown ? null : entry.recipe.id)}
            >
              <View style={styles.head}>
                <Text style={styles.name}>{entry.recipe.name}</Text>
                <View style={[styles.tag, ready ? styles.tagReady : styles.tagShort]}>
                  <Text style={styles.tagText}>
                    {ready ? 'se puede' : `faltan ${entry.short.length}`}
                  </Text>
                </View>
              </View>
              <Text style={styles.meta}>
                {entry.recipe.portions} porciones
                {portion !== null &&
                  ` · ${roundAmount(portion.proteinG)} g de proteína y ${Math.round(portion.kcal)} kcal cada una`}
                {entry.missing.length > 0 &&
                  ` · ${entry.missing.map((one) => `${one.name}${one.why === 'poco' ? ' (poco)' : ''}`).join(', ')}`}
              </Text>
            </Pressable>

            {shown && (
              <View style={styles.body}>
                {entry.recipe.ingredients.map((ingredient) => {
                  const item = pantry.find((one) => one.id === ingredient.itemId);
                  if (item === undefined) return null;
                  return (
                    <View key={ingredient.itemId} style={styles.line}>
                      <Text style={styles.lineName}>{item.name}</Text>
                      <Text style={styles.lineAmount}>
                        {ingredient.amount === null
                          ? 'al gusto'
                          : `${ingredient.amount} ${item.unit ?? ''}`}
                      </Text>
                    </View>
                  );
                })}

                {portion !== null ? (
                  <Text style={styles.day}>
                    {dayAfter(portion.proteinG)}
                    {unmeasured.length > 0 && ` No cuenta ${unmeasured.join(', ')}: no se miden.`}
                  </Text>
                ) : (
                  pot !== undefined &&
                  !pot.ok && (
                    <Text style={styles.day}>
                      Sin cifras por porción: {pot.blocked.join('; ')}.
                    </Text>
                  )
                )}

                {entry.recipe.steps !== '' &&
                  entry.recipe.steps.split('\n').map((step) => (
                    <Text key={step} style={styles.step}>
                      {step}
                    </Text>
                  ))}

                <View style={styles.actions}>
                  <Button
                    label="Cocinar"
                    accessibilityLabel={`Cocinar ${entry.recipe.name}`}
                    variant="primary"
                    icon={ChefHat}
                    disabled={!ready}
                    loading={cooking === entry.recipe.id}
                    onPress={() => cook(entry)}
                  />
                  <IconButton
                    icon={Pencil}
                    accessibilityLabel={`Corregir ${entry.recipe.name}`}
                    onPress={() => setEditing(entry.recipe)}
                  />
                  <ConfirmButton
                    icon={Trash}
                    question={`¿Borrar ${entry.recipe.name}?`}
                    accessibilityLabel={`Borrar ${entry.recipe.name}`}
                    onConfirm={() => {
                      setOpen(null);
                      removeRecipe(entry.recipe.id)
                        .then(reload)
                        .catch((error: unknown) => console.error(error));
                    }}
                  />
                </View>
              </View>
            )}
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = sheet((theme) => ({
  empty: {
    fontSize: 13,
    fontFamily: font.regular,
    color: theme.textDim,
  },
  notice: {
    fontSize: 13,
    fontFamily: font.bold,
    color: theme.text,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  name: {
    flex: 1,
    fontSize: 17,
    fontFamily: font.black,
    color: theme.text,
  },
  tag: {
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  tagReady: {
    backgroundColor: theme.ok,
  },
  tagShort: {
    backgroundColor: theme.surface,
  },
  tagText: {
    fontSize: 11,
    fontFamily: font.black,
    color: theme.text,
  },
  meta: {
    fontSize: 12,
    fontFamily: font.regular,
    color: theme.textDim,
    marginTop: 3,
  },
  body: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: shape.border,
    borderTopColor: theme.line,
    gap: 4,
  },
  line: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  lineName: {
    fontSize: 14,
    fontFamily: font.bold,
    color: theme.text,
  },
  lineAmount: {
    fontSize: 14,
    fontFamily: font.black,
    color: theme.text,
    fontVariant: ['tabular-nums'],
  },
  day: {
    fontSize: 13,
    fontFamily: font.bold,
    color: theme.text,
    marginTop: 6,
  },
  step: {
    fontSize: 13,
    fontFamily: font.regular,
    color: theme.textDim,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
}));
