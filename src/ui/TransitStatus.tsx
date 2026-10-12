import { useEffect, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';

import type { LiveDeparture } from '../transit/realtime.ts';
import type { Route } from '../transit/schedule.ts';
import { Ban, Bus, ChevronDown, ChevronUp, CircleSlash, Info } from './icons.ts';
import { routeColor, routeInk } from './routeColors.ts';
import { font, shape, sheet, theme } from './theme.ts';

// A live marker has to read as "on air" at a glance, which the pastel palette cannot do.
const LIVE = '#E0262B';

export function RouteBadge({ route, size = 26 }: { route: Route; size?: number }) {
  const background = routeColor(route[3]);
  return (
    <View
      accessibilityLabel={`Línea ${route[1]}`}
      style={[
        styles.badge,
        { minWidth: size, height: size, borderRadius: size / 2, backgroundColor: background },
      ]}
    >
      <Text style={[styles.badgeText, { color: routeInk(background), fontSize: size * 0.46 }]}>
        {route[1]}
      </Text>
    </View>
  );
}

export function LiveDot({ size = 10 }: { size?: number }) {
  const [pulse] = useState(() => new Animated.Value(0.5));
  useEffect(() => {
    const beat = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    beat.start();
    return () => beat.stop();
  }, [pulse]);
  return (
    <View accessibilityLabel="En vivo" style={[styles.slot, { width: size * 2, height: size * 2 }]}>
      <Animated.View
        style={[
          styles.halo,
          { width: size * 2, height: size * 2, borderRadius: size, opacity: pulse },
        ]}
      />
      <View style={[styles.dot, { width: size, height: size, borderRadius: size / 2 }]} />
    </View>
  );
}

function Slash({ size }: { size: number }) {
  return <View style={[styles.slash, { width: size * 1.5 }]} />;
}

export function NotLiveDot({ size = 10 }: { size?: number }) {
  return (
    <View
      accessibilityLabel="Sin datos en vivo"
      style={[styles.slot, { width: size * 2, height: size * 2 }]}
    >
      <View style={[styles.dotOff, { width: size, height: size, borderRadius: size / 2 }]} />
      <Slash size={size * 1.4} />
    </View>
  );
}

export function BusOff({ size = 16 }: { size?: number }) {
  return (
    <View
      accessibilityLabel="Sin bus asignado"
      style={[styles.slot, { width: size + 4, height: size + 4 }]}
    >
      <Bus size={size} color={theme.text} strokeWidth={2.5} />
      <Slash size={size} />
    </View>
  );
}

/** What is known about a departure, drawn as icons; the words live in the legend. */
export function StatusIcons({ live }: { live: LiveDeparture }) {
  switch (live.status) {
    case 'live':
      return <LiveDot />;
    case 'unassigned':
      return (
        <View style={styles.icons}>
          <LiveDot />
          <BusOff />
        </View>
      );
    case 'canceled':
      return (
        <View accessibilityLabel="Cancelado">
          <Ban size={18} color={LIVE} strokeWidth={2.5} />
        </View>
      );
    case 'skipped':
      return (
        <View accessibilityLabel="No para aquí">
          <CircleSlash size={18} color={theme.text} strokeWidth={2.5} />
        </View>
      );
    default:
      return <NotLiveDot />;
  }
}

export function TransitLegend() {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronUp : ChevronDown;
  return (
    <View style={styles.legend}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="Qué significan los íconos"
        onPress={() => setOpen(!open)}
        style={styles.legendHead}
      >
        <Info size={16} color={theme.text} strokeWidth={2.5} />
        <Text style={[styles.legendTitle, styles.grow]}>Qué significan los íconos</Text>
        <Chevron size={16} color={theme.text} strokeWidth={2.5} />
      </Pressable>
      {open && (
        <View style={styles.legendRows}>
          <View style={styles.legendRow}>
            <LiveDot />
            <Text style={styles.legendText}>En vivo: LTC sigue al bus que hace ese viaje.</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={styles.icons}>
              <LiveDot />
              <BusOff />
            </View>
            <Text style={styles.legendText}>
              En vivo, pero todavía sin bus asignado: vale el horario.
            </Text>
          </View>
          <View style={styles.legendRow}>
            <NotLiveDot />
            <Text style={styles.legendText}>
              Sin datos en vivo: solo horario, o el último reporte ya está viejo.
            </Text>
          </View>
          <View style={styles.legendRow}>
            <Ban size={18} color={LIVE} strokeWidth={2.5} />
            <Text style={styles.legendText}>LTC canceló ese viaje.</Text>
          </View>
          <View style={styles.legendRow}>
            <CircleSlash size={18} color={theme.text} strokeWidth={2.5} />
            <Text style={styles.legendText}>Ese viaje no para en esta parada.</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={styles.busMark}>
              <Bus size={12} color={theme.text} strokeWidth={2.5} />
            </View>
            <Text style={styles.legendText}>
              El bus, donde lo reportó su GPS; en blanco si solo lo ubican las predicciones.
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = sheet((theme) => ({
  badge: {
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: shape.border,
    borderColor: theme.line,
  },
  badgeText: { fontFamily: font.black },
  slot: { alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', backgroundColor: LIVE },
  dot: { backgroundColor: LIVE },
  dotOff: { backgroundColor: theme.textGhost },
  slash: {
    position: 'absolute',
    height: 2,
    backgroundColor: theme.text,
    transform: [{ rotate: '-45deg' }],
  },
  icons: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  legend: { gap: 8, borderTopWidth: 1, borderTopColor: theme.lineSoft, paddingTop: 10 },
  legendHead: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36 },
  legendTitle: { fontFamily: font.bold, fontSize: 14, color: theme.text },
  grow: { flex: 1 },
  legendRows: { gap: 10 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  legendText: { flex: 1, fontFamily: font.regular, fontSize: 13, color: theme.textDim },
  busMark: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: shape.border,
    borderColor: theme.line,
    backgroundColor: theme.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
