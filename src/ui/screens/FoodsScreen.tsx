import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { NutritionFoodRow } from '../../db/types.ts';
import { matchesSearch, referenceAmount, roundAmount } from '../../nutrition/index.ts';
import { useAppData } from '../../shell/AppData.tsx';
import { FoodForm } from '../FoodForm.tsx';
import { mono, theme } from '../theme.ts';

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
      overlay={
        open ? (
          <FoodForm
            food={editing}
            onCancel={() => {
              setCreating(false);
              setEditing(null);
            }}
            onCreate={(food) => {
              createFood(food);
              setCreating(false);
            }}
            onEdit={(id, food) => {
              editFood(id, food);
              setEditing(null);
            }}
            onDelete={(id) => {
              const name = editing?.name ?? '';
              setEditing(null);
              deleteFood(id)
                .then((outcome) => {
                  setNotice(
                    outcome === 'borrado'
                      ? `${name} ya no está.`
                      : `${name} quedó archivado: lo comiste alguna vez y esos días no se tocan.`,
                  );
                  if (archived !== null) readArchived();
                })
                .catch((error: unknown) => console.error(error));
            }}
          />
        ) : null
      }
    >
      <Text style={styles.hint}>
        Lo que diga aquí es lo que cuenta en todos tus días, también en los ya anotados. Las
        palabras clave sirven para encontrarlo al anotar.
      </Text>

      <View style={styles.head}>
        <Pressable
          accessibilityLabel="Agregar un alimento nuevo"
          onPress={() => setCreating(true)}
          style={styles.new}
        >
          <Text style={styles.newText}>+ nuevo</Text>
        </Pressable>
        <Text style={styles.count}>{state.loaded.foods.length} alimentos</Text>
      </View>

      <SearchField value={search} onChange={setSearch} />

      {notice !== null && (
        <Pressable accessibilityLabel="Entendido" onPress={() => setNotice(null)}>
          <Text style={styles.notice}>{notice}</Text>
        </Pressable>
      )}

      {foods.map((food) => (
        <Pressable
          key={food.id}
          accessibilityLabel={`Corregir ${food.name}`}
          onPress={() => setEditing(food)}
          style={styles.row}
        >
          <Text style={styles.name}>{food.name}</Text>
          <Text style={styles.macros}>{macros(food).head}</Text>
          <Text style={styles.macros}>{macros(food).tail}</Text>
          {food.keywords !== null && <Text style={styles.keywords}>{food.keywords}</Text>}
        </Pressable>
      ))}
      <Pressable
        accessibilityLabel={archived === null ? 'Ver los archivados' : 'Esconder los archivados'}
        onPress={() => (archived === null ? readArchived() : setArchived(null))}
        style={styles.archivedLink}
      >
        <Text style={styles.archivedText}>
          {archived === null ? 'ver archivados' : '— archivados'}
        </Text>
      </Pressable>

      {archived !== null &&
        (archived.length === 0 ? (
          <Text style={styles.hint}>No hay ninguno archivado.</Text>
        ) : (
          archived.map((food) => (
            <View key={food.id} style={styles.archivedRow}>
              <Text style={styles.name}>{food.name}</Text>
              <Pressable
                accessibilityLabel={`Recuperar ${food.name}`}
                onPress={() => {
                  restoreFood(food.id);
                  setArchived(archived.filter((other) => other.id !== food.id));
                }}
              >
                <Text style={styles.restore}>recuperar</Text>
              </Pressable>
            </View>
          ))
        ))}
    </Screen>
  );
}

function SearchField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <View style={styles.searchRow}>
      <TextInput
        value={value}
        onChangeText={onChange}
        accessibilityLabel="Buscar un alimento"
        placeholder="buscar"
        placeholderTextColor={theme.textGhost}
        autoCorrect={false}
        style={styles.search}
      />
      {value.trim() !== '' && (
        <Pressable accessibilityLabel="Borrar la búsqueda" onPress={() => onChange('')}>
          <Text style={styles.clear}>borrar</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  hint: {
    fontSize: 11,
    color: theme.textGhost,
    fontFamily: mono,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  new: {
    borderWidth: 1,
    borderColor: theme.lineStrong,
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  newText: {
    fontSize: 13,
    fontFamily: mono,
    color: theme.text,
  },
  count: {
    fontSize: 11,
    fontFamily: mono,
    color: theme.textGhost,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  row: {
    borderTopWidth: 1,
    borderTopColor: theme.line,
    paddingVertical: 8,
    gap: 2,
  },
  notice: {
    fontSize: 11,
    color: theme.accent,
    fontFamily: mono,
  },
  archivedLink: {
    borderTopWidth: 1,
    borderTopColor: theme.line,
    paddingTop: 10,
    marginTop: 4,
  },
  archivedText: {
    fontSize: 11,
    color: theme.accent,
    fontFamily: mono,
  },
  archivedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  restore: {
    fontSize: 11,
    color: theme.accent,
    fontFamily: mono,
  },
  name: {
    fontSize: 13,
    fontFamily: mono,
    color: theme.text,
  },
  macros: {
    fontSize: 10,
    fontFamily: mono,
    color: theme.textFaint,
  },
  keywords: {
    fontSize: 10,
    fontFamily: mono,
    color: theme.accent,
  },
});
