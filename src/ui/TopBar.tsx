import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Check, Settings } from './icons.ts';
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
 * El nombre va en una pegatina amarilla plana, porque no se toca. El boton de la
 * derecha es lo unico con sombra: entrar a Ajustes desde la pantalla principal, o
 * cerrar la pantalla apilada y volver. No lleva titulo a proposito, porque el titulo
 * grande ya esta dentro de la pantalla y decirlo dos veces es ruido. La raya de abajo
 * tampoco la dibuja la barra: la pone el borde de arriba de cada pantalla, que es lo
 * que mantiene una sola raya de dos puntos y no dos pegadas.
 */
export function TopBar({ action, onPress }: { action: 'settings' | 'done'; onPress: () => void }) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingTop: insets.top + 6 }]}>
      <View style={styles.brand}>
        <Text style={styles.brandText}>nexo</Text>
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
  },
  brand: {
    backgroundColor: theme.accent,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  brandText: {
    fontSize: 20,
    lineHeight: 26,
    fontFamily: font.display,
    letterSpacing: -0.5,
    color: theme.accentInk,
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
