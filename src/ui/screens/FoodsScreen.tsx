import { useNavigation, useRoute } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { NutritionFoodRow } from '../../db/types.ts';
import { matchesSearch, referenceAmount, roundAmount } from '../../nutrition/index.ts';
import { useAppData } from '../../shell/AppData.tsx';

import { Button } from '../Button.tsx';
import { Card } from '../Card.tsx';
import { FoodForm } from '../FoodForm.tsx';
import { ChevronDown, ChevronRight, ChevronUp, Plus, RotateCcw } from '../icons.ts';
import { SearchField } from '../SearchField.tsx';
import { font, sheet, shape, theme } from '../theme.ts';

import { Screen } from './Screen.tsx';

/**
 * El catalogo, para corregirlo.
 *
 * Aparte de la pantalla de anotar a proposito: ahi solo elige lo que comio, y aqui
 * se cambia lo que significa cada cosa. Mezclarlos era lo que llenaba la pantalla de
 * registro de botones que no usa mientras come.
 */
/** Todo lo que dice la ficha, para no tener que abrirla solo para mirarla. */
function macros(food: NutritionFoodRow): { head: string; tail: string } {
  const per = referenceAmount(food);
  const unit = food.unit_kind === 'count' ? food.base_unit : `100 ${food.base_unit}`;
  const of = (value: number | null, suffix: string) =>
    value === null ? '—' : `${roundAmount(Math.round(value * per * 100) / 100)}${suffix}`;

  return {
    head: `${unit} · ${of(food.kcal, '')} kcal · ${of(food.protein_g, ' g')} P · ${of(food.carbs_g, ' g')} C`,
    tail: `grasa ${of(food.fat_g, ' g')} · azúcar ${of(food.sugar_g, ' g')} · sodio ${of(food.sodium_mg, ' mg')}`,
  };
}

export function FoodsScreen() {
  const { state, createFood, editFood, deleteFood, restoreFood, loadArchivedFoods } = useAppData();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<NutritionFoodRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [archived, setArchived] = useState<NutritionFoodRow[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Desde una olla que no pudo dejar lote: abre la ficha a la que le falta el peso.
  const route = useRoute<{ key: string; name: string; params?: { edit?: string } }>();
  const navigation = useNavigation<{ setParams: (params: { edit?: string }) => void }>();
  const asked = route.params?.edit;
  const catalogue = state.phase === 'ready' ? state.loaded.foods : null;
  const [handled, setHandled] = useState<string | undefined>(undefined);
  if (asked !== handled && catalogue !== null) {
    setHandled(asked);
    if (asked !== undefined) {
      const food = catalogue.find((one) => one.id === asked);
      if (food) setEditing(food);
      else setNotice('Ese alimento ya no está en el catálogo: búscalo en archivados.');
    }
  }
  // Atendido, se borra: volver a pedir la misma ficha despues tiene que abrirla otra vez.
  useEffect(() => {
    if (asked !== undefined) navigation.setParams({ edit: undefined });
  }, [asked, navigation]);

  const readArchived = useCallback(() => {
    loadArchivedFoods()
      .then(setArchived)
      .catch((error: unknown) => console.error(error));
  }, [loadArchivedFoods]);

  if (state.phase !== 'ready') return null;
  const foods = state.loaded.foods.filter((food) =>
    matchesSearch([food.name, food.brand, food.store, food.keywords], search),
  );

  const open = creating || editing !== null;

  return (
    <Screen
      title="Alimentos"
      onOverlayDismiss={
        open
          ? () => {
              setCreating(false);
              setEditing(null);
            }
          : undefined
      }
      overlay={
        open ? (
          <FoodForm
            food={editing}
            onCancel={() => {
              setCreating(false);
              setEditing(null);
            }}
            // La ficha se cierra cuando la base acepto lo escrito; si no, se queda abierta
            // y dice por que.
            onCreate={(food) => createFood(food).then(() => setCreating(false))}
            onEdit={(id, food) => editFood(id, food).then(() => setEditing(null))}
            onDelete={(id) => {
              const name = editing?.name ?? '';
              return deleteFood(id).then((outcome) => {
                setEditing(null);
                setNotice(
                  outcome === 'borrado'
                    ? `${name} ya no está.`
                    : `${name} quedó archivado: lo comiste alguna vez o la despensa lo usa, y esos días no se tocan.`,
                );
                if (archived !== null) readArchived();
              });
            }}
          />
        ) : null
      }
    >
      <Text style={styles.intro}>
        Lo que diga aquí es lo que cuenta en todos tus días, también en los ya anotados. Las
        palabras clave sirven para encontrarlo al anotar.
      </Text>

      <Button
        label="Alimento nuevo"
        accessibilityLabel="Agregar un alimento nuevo"
        variant="primary"
        icon={Plus}
        block
        onPress={() => setCreating(true)}
      />

      <SearchField
        value={search}
        onChange={setSearch}
        accessibilityLabel="Buscar un alimento"
        note={`${state.loaded.foods.length} alimentos`}
      />

      {notice !== null && (
        <Card tone="warn">
          <Text style={styles.notice}>{notice}</Text>
          <Button
            label="Entendido"
            accessibilityLabel="Entendido"
            onPress={() => setNotice(null)}
          />
        </Card>
      )}

      {foods.length === 0 ? (
        <Card>
          <Text style={styles.intro}>Nada con ese nombre.</Text>
        </Card>
      ) : (
        <Card>
          {foods.map((food, index) => (
            <Pressable
              key={food.id}
              accessibilityRole="button"
              accessibilityLabel={`Corregir ${food.name}`}
              onPress={() => setEditing(food)}
              style={({ pressed }) => [
                styles.row,
                index > 0 && styles.ruled,
                pressed && styles.rowPressed,
              ]}
            >
              <View style={styles.rowText}>
                <Text style={styles.name}>{food.name}</Text>
                <Text style={styles.macros}>{macros(food).head}</Text>
                <Text style={styles.macros}>{macros(food).tail}</Text>
                {food.keywords !== null && <Text style={styles.keywords}>{food.keywords}</Text>}
              </View>
              <ChevronRight size={18} color={theme.textFaint} strokeWidth={2.5} />
            </Pressable>
          ))}
        </Card>
      )}

      <Button
        label={archived === null ? 'Ver archivados' : 'Esconder archivados'}
        accessibilityLabel={archived === null ? 'Ver los archivados' : 'Esconder los archivados'}
        variant="ghost"
        icon={archived === null ? ChevronDown : ChevronUp}
        style={styles.archivedLink}
        onPress={() => (archived === null ? readArchived() : setArchived(null))}
      />

      {archived !== null &&
        (archived.length === 0 ? (
          <Card>
            <Text style={styles.intro}>No hay ninguno archivado.</Text>
          </Card>
        ) : (
          <Card title="Archivados">
            {archived.map((food, index) => (
              <View key={food.id} style={[styles.archivedRow, index > 0 && styles.ruled]}>
                <Text style={styles.name}>{food.name}</Text>
                <Button
                  label="Recuperar"
                  accessibilityLabel={`Recuperar ${food.name}`}
                  icon={RotateCcw}
                  onPress={() => {
                    restoreFood(food.id);
                    setArchived(archived.filter((other) => other.id !== food.id));
                  }}
                />
              </View>
            ))}
          </Card>
        ))}
    </Screen>
  );
}

const styles = sheet((theme) => ({
  intro: {
    fontSize: 13,
    fontFamily: font.regular,
    color: theme.textFaint,
  },
  notice: {
    fontSize: 14,
    fontFamily: font.bold,
    color: theme.accentInk,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
  },
  ruled: {
    borderTopWidth: shape.border,
    borderTopColor: theme.line,
  },
  rowPressed: {
    opacity: 0.55,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 15,
    fontFamily: font.black,
    color: theme.text,
  },
  macros: {
    fontSize: 11,
    fontFamily: font.regular,
    color: theme.textFaint,
    fontVariant: ['tabular-nums'],
  },
  keywords: {
    fontSize: 11,
    fontFamily: font.bold,
    color: theme.textFaint,
  },
  archivedLink: {
    alignSelf: 'flex-start',
  },
  archivedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 8,
  },
}));
