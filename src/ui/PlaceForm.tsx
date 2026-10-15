import { Text, View } from 'react-native';

import { PLACE_ICONS, type PlaceIcon } from '../transit/store.ts';
import { categoryKey } from '../transit/place-categories.ts';

import { Button } from './Button.tsx';
import { Chip } from './Chip.tsx';
import { MapPin, Navigation } from './icons.ts';
import { NumericField } from './NumericField.tsx';
import { PLACE_ICON_VIEWS } from './placeIcons.ts';
import { TextField } from './TextField.tsx';
import { PopupSheet } from './PopupSheet.tsx';
import { font, sheet, shape } from './theme.ts';

/** A place as he writes it, before it is saved. */
export type PlaceDraft = {
  id?: string;
  name: string;
  address: string;
  lat: string;
  lng: string;
  icon: PlaceIcon;
  tags: string;
  category: string;
  importance: string;
};

/**
 * The sheet for a new place or one he corrects, over the screen like a new food. The point stays
 * with the screen: choosing it on the map hides the sheet until he comes back with it.
 */
export function PlaceForm({
  draft,
  categories,
  onChange,
  busy,
  problem,
  onLocate,
  onPickOnMap,
  onCancel,
  onSave,
}: {
  draft: PlaceDraft;
  categories: { id: string; label: string }[];
  onChange: (change: Partial<PlaceDraft>) => void;
  busy: boolean;
  problem: string | null;
  onLocate: () => void;
  onPickOnMap: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <PopupSheet
      footer={
        <>
          <Button label="Cancelar" variant="ghost" disabled={busy} onPress={onCancel} />
          <Button label="Guardar lugar" variant="primary" loading={busy} onPress={onSave} />
        </>
      }
    >
      <Text style={styles.title}>{draft.id ? 'Editar lugar' : 'Nuevo lugar'}</Text>
      <TextField
        accessibilityLabel="Nombre del lugar"
        value={draft.name}
        onChange={(name) => onChange({ name })}
        placeholder="Nombre"
        style={styles.text}
        focusedStyle={styles.writing}
      />
      <TextField
        accessibilityLabel="Dirección o puerta del lugar"
        value={draft.address}
        onChange={(address) => onChange({ address })}
        placeholder="Dirección o puerta"
        style={styles.text}
        focusedStyle={styles.writing}
      />
      <View style={styles.row}>
        <TextField
          accessibilityLabel="Latitud del lugar"
          value={draft.lat}
          onChange={(lat) => onChange({ lat })}
          placeholder="Latitud"
          style={[styles.text, styles.grow]}
          focusedStyle={styles.writing}
        />
        <TextField
          accessibilityLabel="Longitud del lugar"
          value={draft.lng}
          onChange={(lng) => onChange({ lng })}
          placeholder="Longitud"
          style={[styles.text, styles.grow]}
          focusedStyle={styles.writing}
        />
      </View>
      <View style={styles.wrap}>
        <Button label="Usar mi ubicación" icon={Navigation} loading={busy} onPress={onLocate} />
        <Button label="Elegir en el mapa" icon={MapPin} disabled={busy} onPress={onPickOnMap} />
      </View>
      <Text style={styles.hint}>Ícono en el mapa: {PLACE_ICON_VIEWS[draft.icon].label}</Text>
      <View style={styles.wrap}>
        {PLACE_ICONS.map((icon) => (
          <Chip
            key={icon}
            label=""
            icon={PLACE_ICON_VIEWS[icon].icon}
            accessibilityLabel={`Ícono ${PLACE_ICON_VIEWS[icon].label}`}
            selected={draft.icon === icon}
            onPress={() => onChange({ icon })}
          />
        ))}
      </View>
      <TextField
        accessibilityLabel="Categoría del lugar"
        value={draft.category}
        onChange={(category) => onChange({ category })}
        placeholder="Categoría, por ejemplo: gym"
        autoCapitalize="none"
        style={styles.text}
        focusedStyle={styles.writing}
      />
      <View style={styles.wrap}>
        {categories
          .filter((category) => category.id.includes(categoryKey(draft.category)))
          .map((category) => (
            <Chip
              key={category.id}
              label={category.label}
              accessibilityLabel={`Usar categoría ${category.label}`}
              selected={category.id === categoryKey(draft.category)}
              onPress={() => onChange({ category: category.label })}
            />
          ))}
      </View>
      <Text style={styles.hint}>
        Elige una existente o escribe una nueva. Agrupa tus lugares en el mapa.
      </Text>
      <TextField
        accessibilityLabel="Etiquetas del lugar"
        value={draft.tags}
        onChange={(tags) => onChange({ tags })}
        placeholder="gym, fit, gimnasio"
        autoCapitalize="none"
        style={styles.text}
        focusedStyle={styles.writing}
      />
      <Text style={styles.hint}>Separadas por comas: lo encuentran al buscar.</Text>
      <View style={styles.row}>
        <Text style={[styles.label, styles.grow]}>Importancia</Text>
        <NumericField
          accessibilityLabel="Importancia del lugar, de 1 a 10"
          value={draft.importance}
          onChange={(importance) => onChange({ importance })}
          placeholder="1 a 10"
          style={[styles.text, styles.number]}
          focusedStyle={styles.writing}
        />
      </View>
      <Text style={styles.hint}>
        Las listas de lugares empiezan por el 1. Sin número va al final, por nombre.
      </Text>
      {problem && (
        <Text accessibilityRole="alert" style={styles.problem}>
          {problem}
        </Text>
      )}
    </PopupSheet>
  );
}

const styles = sheet((theme) => ({
  title: { fontSize: 18, fontFamily: font.black, color: theme.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  grow: { flex: 1, minWidth: 0 },
  text: {
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.bg,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 15,
    fontFamily: font.bold,
    color: theme.text,
  },
  writing: { backgroundColor: theme.surfaceHigh },
  number: { minWidth: 90, textAlign: 'center' },
  label: { fontSize: 14, fontFamily: font.bold, color: theme.text },
  hint: { fontSize: 12, fontFamily: font.regular, color: theme.textFaint },
  problem: { fontSize: 13, fontFamily: font.bold, color: theme.danger },
}));
