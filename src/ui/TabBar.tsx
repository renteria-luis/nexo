import type { MaterialTopTabBarProps } from '@react-navigation/material-top-tabs';
import { createContext, useMemo, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { font, hardShadow, sheet, shape, theme } from './theme.ts';

/**
 * La barra de abajo, con el bloque amarillo que se desliza a la pestana abierta.
 *
 * La barra que trae React Navigation pinta el icono y la palabra del color de acento,
 * que aqui es amarillo: amarillo sobre papel casi no se ve, y la unica senal de donde
 * estaba parado era una rayita de cuatro puntos. En este estilo lo que dice "estas
 * aqui" es un objeto: un rectangulo de color con su borde de tinta y su sombra dura,
 * y la tinta negra encima se lee igual de bien sobre el amarillo que sobre el papel.
 *
 * El bloque va pegado al carrusel, no al cambio de pestana: `position` es el mismo
 * valor animado que mueve las paginas, asi que al arrastrar de una pestana a otra el
 * bloque acompana al dedo. Va por el hilo nativo porque solo se desplaza, y desplazar
 * es lo unico que el hilo nativo sabe hacer solo.
 *
 * Y la barra flota: no toca ningun borde, es una isla de papel con su contorno entero y
 * su sombra, y el contenido pasa por debajo. Por eso va colocada encima de las paginas
 * en vez de debajo de ellas, y por eso reparte `FloatingBarSpace`: la pantalla que esta
 * debajo tiene que dejar libre ese hueco al final o su ultima cartilla se queda tapada.
 */
const ROW_HEIGHT = 48;
/** El aire a cada lado del bloque, para que dos vecinos no se toquen. */
const BLOCK_INSET = 4;
/** El aire de la isla por dentro, entre su contorno y las pestanas. */
const ISLAND_PADDING = 6;
/**
 * Lo que la isla se separa de los lados. Veinte y no diez porque la pantalla del iPhone
 * es redonda por las esquinas, y una isla mas abajo y mas ancha se comeria la curva.
 */
const SIDE_GAP = 20;
/**
 * Lo ancha que es de lo que le cabe. Tres pestanas no necesitan la pantalla entera, y
 * una isla corta se lee como un objeto puesto encima en vez de como otra barra pegada.
 */
const ISLAND_WIDTH = '70%';
/** Lo bajo que va cuando el telefono no tiene raya de gestos: pegada no, pero casi. */
const FLOOR_GAP = 8;
/** Lo que se mete dentro del area segura de abajo, para no quedar flotando tan arriba. */
const INTO_SAFE = 14;

const ISLAND_HEIGHT = ROW_HEIGHT + ISLAND_PADDING * 2 + shape.border * 2;

/** Lo que la isla deja por debajo de si misma, ya contando la raya del gestor. */
function floor(bottomInset: number): number {
  return Math.max(bottomInset - INTO_SAFE, FLOOR_GAP);
}

/**
 * Lo que la barra tapa contando desde el borde de abajo: la isla entera, lo que deja por
 * debajo y un respiro mas para que lo ultimo del contenido no le quede pegado.
 */
export function tabBarSpace(bottomInset: number): number {
  return floor(bottomInset) + ISLAND_HEIGHT + 8;
}

/** Cuanto hay que dejar libre abajo. Cero fuera de las pestanas, que es donde no hay barra. */
export const FloatingBarSpace = createContext(0);

export function TabBar({
  state,
  descriptors,
  navigation,
  position,
  jumpTo,
}: MaterialTopTabBarProps) {
  const insets = useSafeAreaInsets();
  // El ancho se mide aqui y no se calcula: asi el bloque cae en su sitio en cualquier
  // telefono sin repetir las cuentas del relleno de la barra.
  const [width, setWidth] = useState(0);
  const count = state.routes.length;
  const item = count > 0 ? width / count : 0;

  const offset = useMemo(() => {
    const stops = state.routes.map((_, index) => index * item + BLOCK_INSET);
    // Con una sola pestana no hay recorrido que interpolar, y con dos puntos iguales
    // Animated se queja.
    if (count < 2) return stops[state.index] ?? BLOCK_INSET;
    return position.interpolate({
      inputRange: state.routes.map((_, index) => index),
      outputRange: stops,
      extrapolate: 'clamp',
    });
  }, [count, item, position, state.index, state.routes]);

  return (
    // El envoltorio no recibe toques (box-none): ocupa todo el ancho para colocar la
    // isla, y lo que cae fuera de ella es de la pantalla que hay debajo.
    <View pointerEvents="box-none" style={[styles.bar, { paddingBottom: floor(insets.bottom) }]}>
      <View style={styles.island}>
        <View style={styles.row} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
          {item > 0 && (
            <Animated.View
              style={[
                styles.block,
                { width: item - BLOCK_INSET * 2, transform: [{ translateX: offset }] },
              ]}
            />
          )}

          {state.routes.map((route, index) => {
            const focused = state.index === index;
            const { options } = descriptors[route.key];
            // Sobre el bloque amarillo la tinta es negra; fuera de el, apagada. El
            // relieve dice donde esta parado, y el color solo lo acompana.
            const tint = focused ? theme.accentInk : theme.textFaint;

            return (
              <Pressable
                key={route.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={options.tabBarAccessibilityLabel ?? route.name}
                onPress={() => {
                  const event = navigation.emit({
                    type: 'tabPress',
                    target: route.key,
                    canPreventDefault: true,
                  });
                  if (!event.defaultPrevented) jumpTo(route.key);
                }}
                style={({ pressed }) => [styles.item, pressed && styles.pressed]}
              >
                {options.tabBarIcon?.({ focused, color: tint })}
                <Text numberOfLines={1} style={[styles.label, { color: tint }]}>
                  {route.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = sheet((theme) => ({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: SIDE_GAP,
  },
  // Sin esquinas: el radio es casi la mitad de su alto, que es lo que la deja a un pelo
  // de ser una pastilla sin llegar a serlo.
  island: {
    alignSelf: 'center',
    width: ISLAND_WIDTH,
    backgroundColor: theme.surface,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: ISLAND_HEIGHT / 2 - 2,
    padding: ISLAND_PADDING,
    ...hardShadow(theme),
  },
  row: {
    flexDirection: 'row',
    height: ROW_HEIGHT,
  },
  block: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: theme.accent,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: ROW_HEIGHT / 2 - 2,
    ...hardShadow(theme, 3, 'button'),
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  pressed: {
    opacity: 0.55,
  },
  label: {
    fontSize: 10,
    fontFamily: font.black,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
}));
