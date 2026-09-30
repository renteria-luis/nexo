import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Check, ChevronDown } from './icons.ts';
import { useInfo } from './InfoBubble.tsx';
import { SearchField } from './SearchField.tsx';
import { font, hardShadow, pressed as pressedInto, sheet, shape, theme } from './theme.ts';

/**
 * Elegir uno de una lista larga: el boton dice cual esta puesto y al tocarlo se abre la
 * lista con su buscador, encima de todo lo demas.
 *
 * Con ocho chips en fila ya no cabia nada, y con treinta ejercicios en el catalogo la
 * fila de chips era media pantalla de cosas que no esta mirando. Es el combobox de la
 * referencia: un boton, un buscador y una lista con la marca en el que esta puesto.
 *
 * La lista sale en el mismo globo que usa la (i) (`InfoBubble`), asi que se cierra
 * tocando fuera y no la recorta la cartilla donde vive el boton.
 */
export type Option = { id: string; label: string };

export function Combobox({
  options,
  value,
  onChange,
  placeholder,
  accessibilityLabel,
}: {
  options: readonly Option[];
  value: string | null;
  onChange: (id: string) => void;
  placeholder: string;
  accessibilityLabel: string;
}) {
  const spot = useRef<View>(null);
  const { show, hide } = useInfo();
  const chosen = options.find((option) => option.id === value) ?? null;

  return (
    <View ref={spot} collapsable={false}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={() =>
          spot.current?.measureInWindow((x, y, width, height) =>
            show(
              <List
                options={options}
                value={value}
                onPick={(id) => {
                  onChange(id);
                  hide();
                }}
              />,
              { x, y, width, height },
            ),
          )
        }
        style={({ pressed }) => [styles.trigger, pressed && styles.triggerPressed]}
      >
        <Text style={chosen === null ? styles.placeholder : styles.value} numberOfLines={1}>
          {chosen?.label ?? placeholder}
        </Text>
        <ChevronDown size={17} color={theme.text} strokeWidth={2.5} />
      </Pressable>
    </View>
  );
}

function List({
  options,
  value,
  onPick,
}: {
  options: readonly Option[];
  value: string | null;
  onPick: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const found = options.filter((option) =>
    option.label.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <View style={styles.list}>
      <SearchField value={search} onChange={setSearch} accessibilityLabel="Buscar" />
      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
        {found.length === 0 && <Text style={styles.empty}>Nada con ese nombre.</Text>}
        {found.map((option) => (
          <Pressable
            key={option.id}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            onPress={() => onPick(option.id)}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <Text style={styles.rowText} numberOfLines={1}>
              {option.label}
            </Text>
            {option.id === value && <Check size={16} color={theme.text} strokeWidth={3} />}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = sheet((theme) => ({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 42,
    paddingHorizontal: 12,
    backgroundColor: theme.surface,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    ...hardShadow(theme, 3, 'button'),
  },
  triggerPressed: pressedInto(3),
  value: {
    flex: 1,
    fontSize: 15,
    fontFamily: font.black,
    color: theme.text,
  },
  placeholder: {
    flex: 1,
    fontSize: 15,
    fontFamily: font.bold,
    color: theme.textFaint,
  },
  list: {
    gap: 8,
  },
  scroll: {
    maxHeight: 260,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 6,
    borderRadius: shape.radiusSmall,
  },
  rowPressed: {
    backgroundColor: theme.surfaceHigh,
  },
  rowText: {
    flex: 1,
    fontSize: 15,
    fontFamily: font.bold,
    color: theme.text,
  },
  empty: {
    fontSize: 13,
    fontFamily: font.regular,
    color: theme.textFaint,
    paddingVertical: 8,
  },
}));
