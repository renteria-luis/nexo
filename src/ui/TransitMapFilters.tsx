import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { layerState, toggleLayer, type LayerSelection } from '../transit/map-layers.ts';
import type { Route } from '../transit/schedule.ts';
import { Chip } from './Chip.tsx';
import { ChevronDown, ChevronRight } from './icons.ts';
import { routeColor } from './routeColors.ts';
import { font, sheet, theme } from './theme.ts';
import { Toggle } from './Toggle.tsx';

/**
 * A layer that turns on and off, as every on/off in the app: the iOS switch. Partly shown, it
 * reads off with the word saying so, and turning it on shows every one again.
 */
function Layer({
  label,
  state,
  onChange,
  note,
}: {
  label: string;
  state: boolean | 'mixed';
  onChange: (next: boolean) => void;
  note?: string;
}) {
  return (
    <View style={styles.layer}>
      <Text style={styles.label}>
        {label}
        {state === 'mixed' ? <Text style={styles.hint}> · algunas</Text> : null}
        {note ? <Text style={styles.hint}> · {note}</Text> : null}
      </Text>
      <Toggle value={state === true} onChange={onChange} accessibilityLabel={label} />
    </View>
  );
}

function Disclosure({
  label,
  open,
  onPress,
}: {
  label: string;
  open: boolean;
  onPress: () => void;
}) {
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${open ? 'Ocultar' : 'Mostrar'} ${label}`}
      accessibilityState={{ expanded: open }}
      aria-expanded={open}
      onPress={onPress}
      style={styles.disclosure}
      hitSlop={4}
    >
      <Icon size={18} color={theme.text} />
    </Pressable>
  );
}

/** Independent from the map's touch surface, so toggles never start a pan or a refresh. */
export function TransitMapFilters({
  routes,
  categories,
  selectedRoutes,
  selectedCategories,
  tripOnly,
  onRoutes,
  onCategories,
  onTripOnly,
}: {
  routes: Route[];
  categories: { id: string; label: string }[];
  selectedRoutes: LayerSelection;
  selectedCategories: LayerSelection;
  tripOnly: boolean;
  onRoutes: (selection: LayerSelection) => void;
  onCategories: (selection: LayerSelection) => void;
  onTripOnly: (value: boolean) => void;
}) {
  const [routesOpen, setRoutesOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const routeIds = routes.map((route) => route[0]);
  const categoryIds = categories.map((category) => category.id);
  const routeState = layerState(selectedRoutes, routeIds);
  const visibleCategories = tripOnly ? new Set<string>() : selectedCategories;
  const categoryState = layerState(visibleCategories, categoryIds);
  return (
    <View style={styles.filters}>
      <View style={styles.row}>
        <Disclosure label="rutas" open={routesOpen} onPress={() => setRoutesOpen(!routesOpen)} />
        <Layer
          label="Paraderos"
          state={routeState}
          onChange={(next) => onRoutes(next ? null : new Set())}
        />
      </View>
      {routesOpen && (
        <View style={styles.children}>
          {routes.map((route) => (
            <Chip
              key={route[0]}
              label={route[1] || route[2]}
              accessibilityLabel={`Paraderos de la ruta ${route[1] || route[2]}`}
              dot={routeColor(route[3])}
              selected={selectedRoutes === null || selectedRoutes.has(route[0])}
              onPress={() => onRoutes(toggleLayer(selectedRoutes, routeIds, route[0]))}
            />
          ))}
        </View>
      )}
      <View style={styles.row}>
        <Disclosure
          label="categorías"
          open={categoriesOpen}
          onPress={() => setCategoriesOpen(!categoriesOpen)}
        />
        <Layer
          label="Mis lugares"
          state={categoryState}
          onChange={(next) => {
            onTripOnly(false);
            onCategories(next ? null : new Set());
          }}
        />
      </View>
      {categoriesOpen && (
        <View style={styles.children}>
          {categories.map((category) => (
            <Chip
              key={category.id}
              label={category.label}
              accessibilityLabel={`Lugares de categoría ${category.label}`}
              selected={visibleCategories === null || visibleCategories.has(category.id)}
              onPress={() => {
                onTripOnly(false);
                onCategories(toggleLayer(visibleCategories, categoryIds, category.id));
              }}
            />
          ))}
        </View>
      )}
      <View style={styles.row}>
        <View style={styles.disclosure} />
        <Layer label="Viaje" note="solo Desde y Hasta" state={tripOnly} onChange={onTripOnly} />
      </View>
    </View>
  );
}

const styles = sheet((theme) => ({
  filters: { gap: 2, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center' },
  layer: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  label: { fontSize: 14, fontFamily: font.bold, color: theme.text, flexShrink: 1 },
  hint: { fontSize: 12, fontFamily: font.regular, color: theme.textFaint },
  disclosure: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  children: {
    paddingLeft: 36,
    paddingBottom: 6,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
}));
