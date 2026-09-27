import { Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { IconButton } from './IconButton.tsx';
import { Search, X } from './icons.ts';
import { TextField } from './TextField.tsx';
import { font, sheet, shape, theme } from './theme.ts';

/**
 * El campo de buscar: la lupa en su sitio y el boton de borrar solo cuando hay algo
 * escrito.
 *
 * Lo comparten el selector de alimentos y el catalogo, que es la misma busqueda vista
 * desde dos pantallas. Escrito dos veces se quedaria una de las dos vieja.
 */
export type SearchFieldProps = {
  value: string;
  onChange: (next: string) => void;
  accessibilityLabel: string;
  placeholder?: string;
  /** Lo que sale a la derecha cuando no hay nada escrito: cuantos hay, por ejemplo. */
  note?: string;
  style?: StyleProp<ViewStyle>;
};

export function SearchField({
  value,
  onChange,
  accessibilityLabel,
  placeholder = 'buscar',
  note,
  style,
}: SearchFieldProps) {
  const written = value.trim() !== '';

  return (
    <View style={[styles.row, style]}>
      <View style={styles.field}>
        <Search size={16} color={theme.textFaint} strokeWidth={2.5} />
        <TextField
          value={value}
          onChange={onChange}
          accessibilityLabel={accessibilityLabel}
          placeholder={placeholder}
          autoCapitalize="none"
          style={styles.input}
        />
        {!written && note ? <Text style={styles.note}>{note}</Text> : null}
      </View>
      {written && (
        <IconButton icon={X} accessibilityLabel="Borrar la búsqueda" onPress={() => onChange('')} />
      )}
    </View>
  );
}

const styles = sheet((theme) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.surface,
    paddingHorizontal: 10,
  },
  input: {
    flex: 1,
    paddingVertical: 9,
    fontSize: 15,
    fontFamily: font.bold,
    color: theme.text,
  },
  note: {
    fontSize: 11,
    fontFamily: font.bold,
    color: theme.textGhost,
    fontVariant: ['tabular-nums'],
  },
}));
