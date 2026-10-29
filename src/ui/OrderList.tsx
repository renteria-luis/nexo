import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, Text, View } from 'react-native';

import { ArrowLeftRight, GripLines } from './icons.ts';
import { useScrollIntoView } from './screens/Screen.tsx';
import { font, sheet, shape, theme } from './theme.ts';

/** Una fila de la lista: lo que se lee y si todavia se le puede quitar una serie. */
export type OrderItem = {
  id: string;
  name: string;
  detail: string;
  canRemove?: boolean;
  /** Con esto la fila trae el boton de cambiar el ejercicio. */
  canSwap?: boolean;
};

/**
 * Lo que mide una fila del orden.
 *
 * Fija a proposito: con una sola medida, saber donde caeria la fila es una division, y
 * sin ella habria que medir las siete y guardarse sus alturas para lo mismo.
 */
const ROW = 86;

/** Lo que tarda una fila en correrse para abrir el hueco, o en caer en su sitio al soltar. */
const SLIDE_MS = 150;

/** Donde esta una fila del orden, de arriba abajo, y a donde va. */
type Place = { y: Animated.Value; to: number };

/** Lo que se corre una fila que no es la que se arrastra, para abrirle el hueco. */
function shiftFor(index: number, from: number | null, to: number | null): number {
  // from menor que cero es "lo que se arrastraba ya no esta en la lista": sin esta
  // linea, las filas se quedaban corridas y montadas unas encima de otras.
  if (from === null || from < 0 || to === null || index === from) return 0;
  if (from < to && index > from && index <= to) return -ROW;
  if (from > to && index < from && index >= to) return ROW;
  return 0;
}

/**
 * Una fila del orden, con su propio gesto.
 *
 * El gesto vive en cada asa y no en la lista entera, y reclama el toque **al apoyar el
 * dedo** (`onStartShouldSetPanResponderCapture`), no al moverlo. Esa es la diferencia
 * entre arrastrar y no: el desplazamiento de la pantalla es nativo y empieza con el
 * primer milimetro, asi que pedirlo despues llegaba tarde y se iba la pantalla en vez de
 * la fila.
 *
 * Y con el toque tomado desde el principio no hace falta apagar nada alrededor: el
 * desplazamiento de la pantalla y el de las pestanas preguntan antes de llevarselo y
 * aqui se les dice que no (`onPanResponderTerminationRequest`). Apagarlos por estado era
 * ademas lo que dejaba filas colgadas: cambiar esas propiedades con el dedo encima hace
 * que iOS cancele el toque, y entonces no llegaba ni el soltar ni el aviso de cancelado.
 *
 * Recibe textos sueltos y no el objeto de la fila: asi una fila que no cambio se salta
 * su redibujo aunque la lista se haya armado de nuevo.
 */
const OrderRow = memo(function OrderRow({
  id,
  name,
  detail,
  canRemove,
  canSwap,
  swapping,
  reveal,
  index,
  lifted,
  onPlace,
  onLift,
  onMove,
  onDrop,
  onNudge,
  onSwap,
}: {
  id: string;
  name: string;
  detail: string;
  canRemove: boolean;
  canSwap: boolean;
  /** Amarillo mientras abajo se elige por cual cambiarlo. */
  swapping: boolean;
  reveal: boolean;
  index: number;
  lifted: boolean;
  /** Le da al orden el sitio de la fila, para moverlo con el dedo o con una animacion. */
  onPlace: (id: string, place: Place) => () => void;
  onLift: (id: string, index: number) => void;
  onMove: (dy: number) => void;
  onDrop: () => void;
  onNudge: (id: string, direction: 1 | -1) => void;
  onSwap?: (id: string) => void;
}) {
  const [place] = useState<Place>(() => ({ y: new Animated.Value(index * ROW), to: index * ROW }));
  const row = useRef<View>(null);
  const scrollIntoView = useScrollIntoView();
  useEffect(() => {
    if (!reveal) return;
    const timer = setTimeout(() => scrollIntoView(row.current), SLIDE_MS + 32);
    return () => clearTimeout(timer);
  }, [reveal, index, scrollIntoView]);
  useEffect(() => onPlace(id, place), [id, place, onPlace]);
  const drag = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        // Que nadie se lo quite a medias: el carrusel de pestanas lo pedia en cuanto el
        // dedo se iba un poco a un lado.
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderGrant: () => onLift(id, index),
        onPanResponderMove: (_event, gesture) => onMove(gesture.dy),
        onPanResponderRelease: onDrop,
        onPanResponderTerminate: onDrop,
        // Y por si acaso: este llega tanto al soltar como al cancelar, y soltar dos
        // veces no hace nada.
        onPanResponderEnd: onDrop,
      }),
    [id, index, onLift, onMove, onDrop],
  );

  return (
    <Animated.View
      ref={row}
      // Mientras se mueve, la fila se dibuja una vez y se desplaza esa imagen: la sombra
      // dura, que iOS recalcula en cada cuadro, es lo que hacia que el arrastre se
      // sintiera pesado.
      shouldRasterizeIOS={lifted}
      style={[styles.row, lifted && styles.rowLifted, { transform: [{ translateY: place.y }] }]}
    >
      {/* El asa, y lo unico que arrastra: el resto de la fila queda libre para leer,
          desplazar la pantalla y tocar los botones de series. */}
      <View
        accessibilityLabel={`Mover ${name} de sitio`}
        style={styles.handle}
        {...drag.panHandlers}
      >
        <GripLines size={20} color={theme.textFaint} strokeWidth={2.5} />
      </View>

      <View style={styles.rowText}>
        <Text style={styles.exercise} numberOfLines={2}>
          {name}
        </Text>
        <Text style={styles.detail} numberOfLines={1}>
          {detail}
        </Text>
      </View>

      {onSwap && canSwap && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Cambiar ejercicio ${name}`}
          hitSlop={4}
          accessibilityState={{ selected: swapping }}
          onPress={() => onSwap(id)}
          style={({ pressed }) => [styles.nudge, (pressed || swapping) && styles.nudgePressed]}
        >
          <ArrowLeftRight
            size={17}
            color={swapping ? theme.accentInk : theme.text}
            strokeWidth={2.5}
          />
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Una serie menos de ${name}`}
        hitSlop={4}
        accessibilityState={{ disabled: !canRemove }}
        disabled={!canRemove}
        onPress={() => onNudge(id, -1)}
        style={({ pressed }) => [
          styles.nudge,
          !canRemove && styles.nudgeOff,
          pressed && styles.nudgePressed,
        ]}
      >
        <Text style={[styles.nudgeText, !canRemove && styles.nudgeTextOff]}>−</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Una serie más de ${name}`}
        hitSlop={4}
        onPress={() => onNudge(id, 1)}
        style={({ pressed }) => [styles.nudge, pressed && styles.nudgePressed]}
      >
        <Text style={styles.nudgeText}>+</Text>
      </Pressable>
    </Animated.View>
  );
});

/**
 * Una lista de ejercicios en orden, que se reordena arrastrando y cambia sus series con
 * − y +. La usan el plan antes de empezar y el plan a mitad de entreno, que antes tenia
 * su propio editor de seis botones por ejercicio para lo mismo.
 *
 * Se arrastra desde el asa de las tres rayas, y solo desde ahi: apoyar el dedo en ella
 * despega la fila en el acto, sin esperas, y de ahi sigue al dedo mientras las otras se
 * abren para hacerle sitio. Todo lo demas de la fila queda libre para leer, desplazar la
 * pantalla y tocar los botones de series. Hecho con el PanResponder de siempre y no con
 * una libreria de arrastre: todas piden Reanimated, y Reanimated es lo que tumbo la app
 * en septiembre (ver docs/sliders.md).
 *
 * Mientras una fila esta despegada, la pantalla deja de desplazarse: un arrastre
 * vertical dentro de un scroll es ambiguo y el scroll gana siempre.
 */
export function OrderList({
  items,
  onReorder,
  onNudge,
  onDragging,
  onSwap,
  swapping = null,
  revealId = null,
}: {
  items: readonly OrderItem[];
  onReorder: (from: number, to: number) => void;
  onNudge: (id: string, direction: 1 | -1) => void;
  onDragging: (dragging: boolean) => void;
  onSwap?: (id: string) => void;
  /** La fila que se esta cambiando, si hay una. */
  swapping?: string | null;
  /** Bring the changed exercise back into view after closing its picker. */
  revealId?: string | null;
}) {
  const count = items.length;
  // Despegado se guarda por fila y no por sitio. Por sitio, si el orden nuevo llegaba un
  // cuadro antes de apagar lo amarillo, lo amarillo le caia encima al que acababa de
  // ocupar ese sitio: el parpadeo que se veia al soltar.
  const [held, setHeld] = useState<string | null>(null);
  // Donde esta cada fila, por id, y a donde va. Las filas no se acomodan por el orden de
  // la lista sino por este valor, asi que la que se corre para abrir el hueco se desliza
  // en vez de saltar (2026-10-10), y el orden nuevo al soltar no mueve nada: cada una ya
  // esta donde le toca.
  const places = useRef(new Map<string, Place>());
  const keep = useCallback((id: string, place: Place) => {
    places.current.set(id, place);
    return () => {
      places.current.delete(id);
    };
  }, []);
  // Lo mismo en referencias: el gesto las lee fuera del render.
  const order = useRef<string[]>([]);
  const holding = useRef<string | null>(null);
  const started = useRef<number | null>(null);
  const landing = useRef<number | null>(null);
  // Y lo que pide la pantalla, leido al momento: despegar una fila la redibuja, y si con
  // eso cambiaran las funciones del gesto, el gesto nuevo contaria desde cero a medio
  // arrastre.
  const parent = useRef({ onReorder, onDragging });
  useEffect(() => {
    parent.current = { onReorder, onDragging };
  });

  const slide = useCallback((id: string, to: number, then?: () => void) => {
    const found = places.current.get(id);
    if (!found || found.to === to) {
      then?.();
      return;
    }
    found.to = to;
    Animated.timing(found.y, { toValue: to, duration: SLIDE_MS, useNativeDriver: true }).start(
      then,
    );
  }, []);

  // Lo que cambie la lista por fuera (el tiempo que tiene, un ejercicio que sale) tambien
  // se desliza. Mientras arrastra no: ahi manda el dedo.
  useEffect(() => {
    order.current = items.map((item) => item.id);
    if (holding.current !== null) return;
    order.current.forEach((id, index) => slide(id, index * ROW));
  }, [items, slide]);

  const lift = useCallback((id: string, index: number) => {
    const found = places.current.get(id);
    // Desde su sitio, aunque todavia venga deslizandose de un arrastre anterior.
    found?.y.setValue(index * ROW);
    if (found) found.to = index * ROW;
    holding.current = id;
    started.current = index;
    landing.current = index;
    setHeld(id);
    parent.current.onDragging(true);
  }, []);

  const stop = useCallback(
    (commit = true) => {
      const id = holding.current;
      const from = started.current;
      const to = landing.current;
      holding.current = null;
      started.current = null;
      landing.current = null;
      // Un segundo aviso de soltar no hace nada: la fila ya va camino de su sitio.
      if (id === null || from === null || to === null) return;

      parent.current.onDragging(false);
      const moved = commit && to !== from;
      const ids = order.current.slice();
      if (moved) ids.splice(to, 0, ...ids.splice(from, 1));
      // Cada fila a su sitio del orden que queda: la que estaba en el dedo cae en el suyo
      // desde donde la solto, y sigue amarilla y por encima hasta llegar; las corridas ya
      // estan donde les toca, o vuelven si no hubo cambio.
      ids.forEach((other, index) =>
        slide(
          other,
          index * ROW,
          other === id ? () => setHeld((current) => (current === id ? null : current)) : undefined,
        ),
      );
      if (moved) parent.current.onReorder(from, to);
    },
    [slide],
  );

  const move = useCallback(
    (dy: number) => {
      const id = holding.current;
      const from = started.current;
      if (id === null || from === null) return;

      // Fuera de la lista se suelta solo y vuelve a su sitio, sin mover nada: sacar una
      // fila a la cartilla de arriba no significa nada, y dejarla ahi colgada menos.
      if (dy < -(from + 1) * ROW || dy > (count - from) * ROW) {
        stop(false);
        return;
      }

      const lifted = places.current.get(id);
      if (lifted) {
        lifted.y.setValue(from * ROW + dy);
        lifted.to = from * ROW + dy;
      }
      // Medio renglon es el cambio: a partir de ahi la fila tapa mas de la mitad de la
      // de al lado, y soltarla ahi es cambiarlas de sitio.
      const to = Math.max(0, Math.min(count - 1, from + Math.round(dy / ROW)));
      if (to === landing.current) return;
      landing.current = to;
      order.current.forEach((other, index) => {
        if (other !== id) slide(other, index * ROW + shiftFor(index, from, to));
      });
    },
    [count, slide, stop],
  );

  return (
    <View style={{ height: count * ROW }}>
      {/* Las rayas entre filas no se mueven: lo que se corre es el ejercicio, no el
          renglon. Pegadas a cada fila se deslizaban con ella, y se veia feo (2026-10-10). */}
      {Array.from({ length: Math.max(0, count - 1) }, (_, line) => (
        <View key={line} style={[styles.divider, { top: (line + 1) * ROW }]} />
      ))}
      {items.map((item, index) => (
        <OrderRow
          key={item.id}
          id={item.id}
          name={item.name}
          detail={item.detail}
          canRemove={item.canRemove ?? true}
          canSwap={item.canSwap ?? false}
          swapping={item.id === swapping}
          reveal={item.id === revealId}
          index={index}
          lifted={item.id === held}
          onPlace={keep}
          onLift={lift}
          onMove={move}
          onDrop={stop}
          onNudge={onNudge}
          onSwap={onSwap}
        />
      ))}
    </View>
  );
}

const styles = sheet((theme) => ({
  row: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: ROW,
  },
  divider: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: shape.border,
    backgroundColor: theme.line,
  },
  // Despegada: amarilla, con mas sombra y por encima de las otras.
  rowLifted: {
    zIndex: 2,
    backgroundColor: theme.accent,
    borderRadius: shape.radiusSmall,
    paddingHorizontal: 6,
  },
  // Columna estrecha y de todo el alto: facil de agarrar y no le quita sitio al nombre.
  handle: {
    width: 36,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    gap: 1,
  },
  exercise: {
    fontSize: 15,
    fontFamily: font.black,
    color: theme.text,
  },
  detail: {
    fontSize: 12,
    fontFamily: font.regular,
    color: theme.textFaint,
    fontVariant: ['tabular-nums'],
  },
  nudge: {
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.surface,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nudgeOff: {
    borderColor: theme.lineSoft,
    backgroundColor: 'transparent',
  },
  nudgePressed: {
    backgroundColor: theme.accent,
  },
  nudgeText: {
    fontSize: 17,
    fontFamily: font.black,
    color: theme.text,
  },
  nudgeTextOff: {
    color: theme.textGhost,
  },
}));
