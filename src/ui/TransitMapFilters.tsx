import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { layerState, toggleLayer, type LayerSelection } from '../transit/map-layers.ts';
import type { Route } from '../transit/schedule.ts';
import { Check, ChevronDown, ChevronRight, Minus } from './icons.ts';
import { routeColor } from './routeColors.ts';
import { font, sheet, shape, theme } from './theme.ts';

function Checkbox({
  label,
  checked,
  onPress,
  accessibilityLabel = label,
  color,
}: {
  label: string;
  checked: boolean | 'mixed';
  onPress: () => void;
  accessibilityLabel?: string;
  color?: string;
}) {
  const Icon = checked === 'mixed' ? Minus : Check;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked }}
      aria-checked={checked}
      onPress={onPress}
      style={({ pressed }) => [styles.check, pressed && styles.pressed]}
    >
      <View style={[styles.box, !!checked && styles.checked]}>
        {!!checked && <Icon size={13} color={theme.accentInk} strokeWidth={3} />}
      </View>
      {color && <View style={[styles.routeColor, { backgroundColor: color }]} />}
      <Text style={styles.label}>{label}</Text>
    </Pressable>
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
        <Checkbox
          label="Paraderos"
          checked={routeState}
          onPress={() => onRoutes(routeState === true ? new Set() : null)}
        />
        <Disclosure label="rutas" open={routesOpen} onPress={() => setRoutesOpen(!routesOpen)} />
      </View>
      {routesOpen && (
        <View style={styles.children}>
          {routes.map((route) => (
            <Checkbox
              key={route[0]}
              label={route[1] || route[2]}
              accessibilityLabel={`Paraderos de la ruta ${route[1] || route[2]}`}
              color={routeColor(route[3])}
              checked={selectedRoutes === null || selectedRoutes.has(route[0])}
              onPress={() => onRoutes(toggleLayer(selectedRoutes, routeIds, route[0]))}
            />
          ))}
        </View>
      )}
      <View style={styles.row}>
        <Checkbox
          label="Mis lugares"
          checked={categoryState}
          onPress={() => {
            onTripOnly(false);
            onCategories(categoryState === true ? new Set() : null);
          }}
        />
        <Disclosure
          label="categorías"
          open={categoriesOpen}
          onPress={() => setCategoriesOpen(!categoriesOpen)}
        />
      </View>
      {categoriesOpen && (
        <View style={styles.children}>
          {categories.map((category) => (
            <Checkbox
              key={category.id}
              label={category.label}
              accessibilityLabel={`Lugares de categoría ${category.label}`}
              checked={visibleCategories === null || visibleCategories.has(category.id)}
              onPress={() => {
                onTripOnly(false);
                onCategories(toggleLayer(visibleCategories, categoryIds, category.id));
              }}
            />
          ))}
        </View>
      )}
      <View style={styles.row}>
        <Checkbox label="Viaje" checked={tripOnly} onPress={() => onTripOnly(!tripOnly)} />
        <Text style={styles.hint}>Solo Desde y Hasta</Text>
      </View>
    </View>
  );
}

const styles = sheet((theme) => ({
  filters: { gap: 2, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  check: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingRight: 8,
    flexShrink: 1,
  },
  box: {
    width: 19,
    height: 19,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surface,
  },
  checked: { backgroundColor: theme.accent },
  label: { fontSize: 13, fontFamily: font.bold, color: theme.text, flexShrink: 1 },
  hint: { fontSize: 11, fontFamily: font.regular, color: theme.textFaint },
  disclosure: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  children: {
    marginLeft: 9,
    paddingLeft: 16,
    borderLeftWidth: 1,
    borderLeftColor: theme.lineSoft,
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 12,
  },
  routeColor: { width: 6, height: 15, borderRadius: 3 },
  pressed: { opacity: 0.65 },
}));
