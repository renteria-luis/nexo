import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { longDate, todayIso } from '../core/dates.ts';

import { Check, Menu, Settings } from './icons.ts';
import { IconButton } from './IconButton.tsx';
import { font, hardShadow, pressed as pressedInto, sheet, shape, theme } from './theme.ts';

/**
 * La barra de arriba, la misma en toda la app: el nombre y lo unico que se puede
 * tocar desde ahi.
 *
 * Reemplaza al encabezado nativo, que solo dejaba cambiarle el color: no acepta el
 * borde de tinta ni un boton con relieve, y ponia su propio fondo redondo debajo del
 * nuestro. La pone el navegador como encabezado de cada pantalla apilada, y en la
 * principal se queda encima del carrusel, asi que no se mueve mientras las paginas se
 * deslizan por debajo.
 *
 * Donde estaba el nombre de la app va la fecha de hoy (2026-09-30): el nombre lo sabe,
 * y que dia es lo mira. En un dia suelto no va nada, porque ahi la fecha que importa es
 * la del dia que esta mirando y esa la dice la pantalla.
 *
 * A la izquierda, las tres rayas que abren el menu lateral, que es donde vive todo lo
 * que no cabe en la barra de abajo y donde si se queda el nombre de la app. El boton de
 * la derecha es lo unico con relieve ademas de ese: entrar a Ajustes desde la pantalla
 * principal, o cerrar la pantalla apilada y volver. No lleva titulo a proposito, porque
 * el titulo grande ya esta dentro de la pantalla y decirlo dos veces es ruido.
 *
 * La raya de abajo la dibuja la barra y no el contenido: en el borde de una lista que
 * se desplaza, la raya se va con ella en cuanto se desliza, y lo que separa la barra
 * del papel desaparecia a mitad de la pantalla.
 */
/** Fuera del render: leer el reloj dentro de un componente lo hace impuro. */
function todayLabel(): string {
  return longDate(todayIso());
}

export function TopBar({
  action,
  onPress,
  onMenu,
  showDate = true,
}: {
  action: 'settings' | 'done';
  onPress: () => void;
  onMenu: () => void;
  showDate?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [today] = useState(todayLabel);

  return (
    <View style={[styles.bar, { paddingTop: insets.top + 6 }]}>
      <View style={styles.left}>
        <IconButton icon={Menu} accessibilityLabel="Abrir el menu" onPress={onMenu} />
        {showDate && <Text style={styles.today}>{today}</Text>}
      </View>

      {action === 'done' ? (
        <IconButton icon={Check} tone="accent" accessibilityLabel="Listo" onPress={onPress} />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ajustes"
          onPress={onPress}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Settings size={17} color={theme.text} strokeWidth={2.5} />
          <Text style={styles.actionText}>Ajustes</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = sheet((theme) => ({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 8,
    backgroundColor: theme.bg,
    borderBottomWidth: shape.border,
    borderBottomColor: theme.line,
  },
  left: {
    flex: 1,
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
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minHeight: 38,
    paddingHorizontal: 12,
    backgroundColor: theme.surface,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    ...hardShadow(theme, 3),
  },
  actionText: {
    fontSize: 14,
    fontFamily: font.black,
    color: theme.text,
  },
  pressed: pressedInto(3),
}));
