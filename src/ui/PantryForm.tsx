import { useState } from 'react';
import { Text, View } from 'react-native';

import type { PantryKind, PantryState } from '../db/types.ts';
import type { NewPantryItem, PantryItem } from '../pantry/index.ts';
import { useAppData } from '../shell/AppData.tsx';

import { Button } from './Button.tsx';
import { Card } from './Card.tsx';
import { Chip } from './Chip.tsx';
import { NumericField } from './NumericField.tsx';
import { SearchField } from './SearchField.tsx';
import { TextField } from './TextField.tsx';
import { font, sheet, shape } from './theme.ts';

/**
 * Agregar o corregir algo de la despensa.
 *
 * La forma de tenerlo se elige primero porque decide todo lo demas: contado y pesado
 * piden cantidad, lo duradero pide un estado y una especia solo si la hay (spec 21.1).
 *
 * El alimento del catalogo es opcional y es lo que hace que una receta con esto pueda
 * calcular sus macros y dejar el lote al cocinarla. Sin el, la cosa existe y se cuenta,
 * pero no se puede pesar la olla.
 */
const KINDS: { id: PantryKind; label: string }[] = [
  { id: 'counted', label: 'contado' },
  { id: 'weighed', label: 'pesado' },
  { id: 'durable', label: 'dura' },
  { id: 'spice', label: 'especia' },
];

const STATES: PantryState[] = ['hay', 'poco', 'no hay'];

export function PantryForm({
  item,
  onSave,
  onCancel,
}: {
  item: PantryItem | null;
  onSave: (item: NewPantryItem) => void;
  onCancel: () => void;
}) {
  const { state } = useAppData();
  const [name, setName] = useState(item?.name ?? '');
  const [kind, setKind] = useState<PantryKind>(item?.kind ?? 'counted');
  const [quantity, setQuantity] = useState(String(item?.quantity ?? ''));
  const [unit, setUnit] = useState(item?.unit ?? '');
  const [store, setStore] = useState<PantryState>(item?.state ?? 'hay');
  const [hasIt, setHasIt] = useState(item?.hasIt ?? true);
  const [foodId, setFoodId] = useState<string | null>(item?.foodId ?? null);
  const [search, setSearch] = useState('');

  const foods = state.phase === 'ready' ? state.loaded.foods : [];
  const chosen = foods.find((food) => food.id === foodId) ?? null;
  // Sin escribir nada tambien salen: una casilla de busqueda vacia encima de una lista
  // vacia no dice que haya nada que tocar.
  const found = foods
    .filter((food) => food.name.toLowerCase().includes(search.trim().toLowerCase()))
    .slice(0, 8);

  const counted = kind === 'counted' || kind === 'weighed';

  const save = () => {
    if (name.trim() === '') return;
    onSave({
      id: item?.id,
      name: name.trim(),
      kind,
      quantity: counted ? Number(quantity) || 0 : null,
      unit: counted ? (unit.trim() === '' ? (chosen?.base_unit ?? 'unidad') : unit.trim()) : null,
      state: kind === 'durable' ? store : null,
      hasIt: kind === 'spice' ? hasIt : null,
      foodId,
    });
  };

  return (
    <Card title={item === null ? 'Algo nuevo' : item.name}>
      <Text style={styles.label}>Qué es</Text>
      <TextField
        value={name}
        onChange={setName}
        accessibilityLabel="Nombre"
        placeholder="Pechuga de pollo"
        style={styles.input}
        focusedStyle={styles.writing}
      />

      <Text style={styles.label}>Cómo lo tienes</Text>
      <View style={styles.row}>
        {KINDS.map((one) => (
          <Chip
            key={one.id}
            label={one.label}
            accessibilityLabel={one.label}
            selected={kind === one.id}
            onPress={() => setKind(one.id)}
          />
        ))}
      </View>

      {counted && (
        <>
          <Text style={styles.label}>Cuánto hay</Text>
          <View style={styles.row}>
            <NumericField
              value={quantity}
              onChange={setQuantity}
              allowDecimal={kind === 'weighed'}
              accessibilityLabel="Cuánto hay"
              placeholder="0"
              style={styles.short}
              focusedStyle={styles.writing}
            />
            <TextField
              value={unit}
              onChange={setUnit}
              accessibilityLabel="Unidad"
              placeholder={chosen?.base_unit ?? (kind === 'weighed' ? 'g' : 'unidad')}
              autoCapitalize="none"
              style={styles.short}
              focusedStyle={styles.writing}
            />
          </View>
        </>
      )}

      {kind === 'durable' && (
        <>
          <Text style={styles.label}>Cómo va</Text>
          <View style={styles.row}>
            {STATES.map((one) => (
              <Chip
                key={one}
                label={one}
                accessibilityLabel={one}
                selected={store === one}
                onPress={() => setStore(one)}
              />
            ))}
          </View>
        </>
      )}

      {kind === 'spice' && (
        <>
          <Text style={styles.label}>¿La tienes?</Text>
          <View style={styles.row}>
            <Chip
              label="sí"
              accessibilityLabel="Sí"
              selected={hasIt}
              onPress={() => setHasIt(true)}
            />
            <Chip
              label="no"
              accessibilityLabel="No"
              selected={!hasIt}
              onPress={() => setHasIt(false)}
            />
          </View>
        </>
      )}

      <Text style={styles.label}>Qué alimento es (opcional)</Text>
      <Text style={styles.note}>
        Toca el de tu catálogo que sea esto. Sirve para que una receta con esto sepa sus calorías y
        su proteína; sin él la cosa se cuenta igual, pero al cocinar no se puede pesar la olla.
      </Text>
      {chosen === null ? (
        <>
          <SearchField
            value={search}
            onChange={setSearch}
            accessibilityLabel="Buscar el alimento"
            note={`${foods.length} alimentos en tu catálogo`}
          />
          <View style={styles.row}>
            {found.map((food) => (
              <Chip
                key={food.id}
                label={food.name}
                accessibilityLabel={`Es ${food.name}`}
                onPress={() => {
                  setFoodId(food.id);
                  setSearch('');
                  if (unit.trim() === '') setUnit(food.base_unit);
                }}
              />
            ))}
          </View>
        </>
      ) : (
        <View style={styles.row}>
          <Chip
            label={chosen.name}
            accessibilityLabel={`Quitar ${chosen.name}`}
            selected
            onPress={() => setFoodId(null)}
          />
          <Text style={styles.note}>Tócalo para quitarlo</Text>
        </View>
      )}

      <View style={styles.actions}>
        <Button
          label="Guardar"
          accessibilityLabel="Guardar"
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
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  note: {
    fontSize: 12,
    fontFamily: font.regular,
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
    width: 110,
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
