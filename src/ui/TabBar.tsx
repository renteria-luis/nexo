import type { MaterialTopTabBarProps } from '@react-navigation/material-top-tabs';
import SegmentedControl from '@react-native-segmented-control/segmented-control';
import { createContext, useContext, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PagerPosition } from './Backdrop.tsx';
import { Glass } from './Glass.tsx';
import { useTouchLock } from './SwipeLock.tsx';
import { font, sheet, theme } from './theme.ts';

/**
 * La barra de abajo: una isla de vidrio transparente con el selector de opciones de iOS
 * dentro (2026-10-18, a peticion suya).
 *
 * El selector es el que pone la burbuja: en iOS 26 la suya es de vidrio, se desliza sola
 * a la opcion tocada y se vuelve una lupa cuando se arrastra el dedo por encima, que es
 * lo que hacen las barras de Reloj o Music. Va invisible, con sus palabras transparentes
 * (siguen ahi para VoiceOver), y los iconos y palabras de la app van encima sin recibir
 * toques, que caen al selector. Es el mismo truco de UnionTabView. Una barra nativa
 * entera haria lo mismo, pero quitaria el deslizar entre pestanas con el dedo.
 *
 * Al deslizar las paginas, la burbuja salta a la nueva al terminar: el selector solo
 * sabe de opciones elegidas, no de medio camino.
 *
 * Y la barra flota: no toca ningun borde, es una isla de vidrio y el contenido pasa por
 * debajo. Por eso va colocada encima de las paginas en vez de debajo de ellas, y por eso
 * reparte `FloatingBarSpace`: la pantalla que esta debajo tiene que dejar libre ese hueco
 * al final o su ultima cartilla se queda tapada.
 */
const ROW_HEIGHT = 48;
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

const ISLAND_HEIGHT = ROW_HEIGHT + ISLAND_PADDING * 2;

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

const CLEAR_TEXT = { color: 'transparent' };

export function TabBar({
  state,
  descriptors,
  navigation,
  position,
  jumpTo,
}: MaterialTopTabBarProps) {
  const insets = useSafeAreaInsets();
  // El fondo de cada pestana se funde con el de la siguiente mientras se desliza.
  const { setPosition } = useContext(PagerPosition);
  useEffect(() => setPosition(position), [position, setPosition]);
  // Arrastrar el dedo por la barra es elegir pestana, no abrir el menu lateral.
  const { lock, unlock } = useTouchLock();

  const select = (index: number) => {
    const route = state.routes[index];
    if (!route) return;
    const event = navigation.emit({
      type: 'tabPress',
      target: route.key,
      canPreventDefault: true,
    });
    if (!event.defaultPrevented) jumpTo(route.key);
  };

  return (
    // El envoltorio no recibe toques (box-none): ocupa todo el ancho para colocar la
    // isla, y lo que cae fuera de ella es de la pantalla que hay debajo.
    <View pointerEvents="box-none" style={[styles.bar, { paddingBottom: floor(insets.bottom) }]}>
      <Glass style={styles.island}>
        <View style={styles.row} onTouchStart={lock} onTouchEnd={unlock} onTouchCancel={unlock}>
          <SegmentedControl
            values={state.routes.map((route) => route.name)}
            selectedIndex={state.index}
            onChange={(event) => select(event.nativeEvent.selectedSegmentIndex)}
            backgroundColor="transparent"
            tintColor="rgba(255, 255, 255, 0.16)"
            appearance="dark"
            fontStyle={CLEAR_TEXT}
            activeFontStyle={CLEAR_TEXT}
            // El selector trae 32 de alto fijo: sin esto la burbuja solo cubria los iconos.
            style={[StyleSheet.absoluteFill, styles.selector]}
          />
          <View pointerEvents="none" style={styles.items}>
            {state.routes.map((route, index) => {
              const focused = state.index === index;
              // Dentro de la burbuja, blanco entero; fuera, apagado. La burbuja dice
              // donde esta parado, y la claridad solo la acompana.
              const tint = focused ? theme.text : theme.textFaint;
              return (
                <View key={route.key} style={styles.item}>
                  {descriptors[route.key].options.tabBarIcon?.({ focused, color: tint })}
                  <Text numberOfLines={1} style={[styles.label, { color: tint }]}>
                    {route.name}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      </Glass>
    </View>
  );
}

const styles = sheet(() => ({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: SIDE_GAP,
  },
  island: {
    alignSelf: 'center',
    width: ISLAND_WIDTH,
    borderRadius: ISLAND_HEIGHT / 2,
    padding: ISLAND_PADDING,
  },
  row: {
    height: ROW_HEIGHT,
  },
  selector: {
    height: ROW_HEIGHT,
  },
  items: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  label: {
    fontSize: 11,
    fontFamily: font.bold,
  },
}));
