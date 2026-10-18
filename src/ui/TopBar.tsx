import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { longDate } from '../core/dates.ts';
import { useAppData } from '../shell/AppData.tsx';

import { Backdrop } from './Backdrop.tsx';
import { Glass } from './Glass.tsx';
import { Check, Menu, Settings, type LucideIcon } from './icons.ts';
import { font, sheet, shape, theme } from './theme.ts';

/** Lo que mide la barra por debajo de la zona segura. Fijo: el fondo se corta con esto. */
const BAR = 60;

/** El alto entero de la barra, que es donde termina el trozo de fondo que lleva detras. */
export function topBarHeight(safeTop: number): number {
  return safeTop + BAR;
}

/**
 * La barra de arriba, la misma en toda la app: las tres rayas del menu lateral, la
 * fecha y lo unico que se puede tocar desde ahi.
 *
 * Reemplaza al encabezado nativo, que solo dejaba cambiarle el color. La pone el
 * navegador como encabezado de cada pantalla apilada, y en la principal se queda encima
 * del carrusel, asi que no se mueve mientras las paginas se deslizan por debajo. Lleva
 * detras su trozo del fondo de la app, y sus botones son de vidrio porque flotan.
 *
 * Donde estaba el nombre de la app va la fecha de hoy (2026-09-30): el nombre lo sabe,
 * y que dia es lo mira. En un dia suelto no va nada, porque ahi la fecha que importa es
 * la del dia que esta mirando y esa la dice la pantalla.
 *
 * El boton de la derecha entra a Ajustes desde la pantalla principal, o cierra la
 * pantalla apilada y vuelve. No lleva titulo a proposito, porque el titulo grande ya
 * esta dentro de la pantalla y decirlo dos veces es ruido.
 *
 * La raya de abajo la dibuja la barra y no el contenido: en el borde de una lista que
 * se desplaza, la raya se va con ella en cuanto se desliza.
 *
 * La fecha es la del dia cargado y no la del reloj al montar la barra: leida una vez, al
 * volver a la app al dia siguiente seguia diciendo ayer hasta que iOS la mataba.
 */
export function TopBar({
  action,
  onPress,
  onMenu,
  showDate = true,
  actions,
  dock,
  screens,
}: {
  action: 'settings' | 'done';
  onPress: () => void;
  onMenu: () => void;
  showDate?: boolean;
  actions?: ReactNode;
  /** El hueco donde se guarda la bola del asistente, a la izquierda del boton. */
  dock?: ReactNode;
  /** De que pantalla es el fondo que lleva detras; varias si son las pestanas. */
  screens: readonly string[];
}) {
  const insets = useSafeAreaInsets();
  const { state } = useAppData();
  const today = state.phase === 'ready' ? longDate(state.loaded.today.date) : null;

  return (
    <View style={[styles.bar, { height: topBarHeight(insets.top), paddingTop: insets.top }]}>
      <Backdrop screens={screens} />
      <View style={styles.left}>
        <GlassButton icon={Menu} accessibilityLabel="Abrir el menu" onPress={onMenu} />
        {showDate && today !== null && <Text style={styles.today}>{today}</Text>}
      </View>

      <View style={styles.right}>
        {dock}
        {/* Junto al boton y no en su lugar: Transit apaga el gesto de volver por su
            mapa, y sin el boton no habia como salir de ahi. */}
        {actions}
        {action === 'done' ? (
          <GlassButton
            icon={Check}
            tint={theme.accent}
            accessibilityLabel="Listo"
            onPress={onPress}
          />
        ) : (
          <GlassButton
            icon={Settings}
            label="Ajustes"
            accessibilityLabel="Ajustes"
            onPress={onPress}
          />
        )}
      </View>
    </View>
  );
}

/**
 * Un boton de vidrio de la barra. Al presionarlo solo se encoge: Apple pide no bajarle
 * la opacidad al vidrio ni a lo que lo contiene, porque deja de dibujarse.
 */
function GlassButton({
  icon: Icon,
  label,
  tint = theme.text,
  accessibilityLabel,
  onPress,
}: {
  icon: LucideIcon;
  label?: string;
  tint?: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <Glass interactive style={[styles.glass, label ? styles.withLabel : styles.round]}>
        <Icon size={19} color={tint} strokeWidth={2.25} />
        {label && <Text style={styles.label}>{label}</Text>}
      </Glass>
    </Pressable>
  );
}

const styles = sheet((theme) => ({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    borderBottomWidth: shape.border,
    borderBottomColor: theme.lineSoft,
  },
  left: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  today: {
    flex: 1,
    fontSize: 15,
    fontFamily: font.black,
    color: theme.text,
  },
  glass: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 22,
  },
  round: {
    width: 44,
  },
  withLabel: {
    paddingHorizontal: 16,
  },
  label: {
    fontSize: 14,
    fontFamily: font.black,
    color: theme.text,
  },
  pressed: {
    transform: [{ scale: 0.95 }],
  },
}));
