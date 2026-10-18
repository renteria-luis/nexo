import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Keyboard,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { assistantDocked } from '../core/settings.ts';
import { useAppData } from '../shell/AppData.tsx';
import { useAssistantDock } from './assistant-dock.tsx';
import { Chat } from './Chat.tsx';
import { Ball, PET_SIZE } from './Pet.tsx';
import { tabBarSpace } from './TabBar.tsx';
import { font, sheet, shape } from './theme.ts';

/**
 * El asistente: una bola que flota sobre toda la app y la ventana que cuelga de ella.
 *
 * La bola y la ventana son una sola cosa que se mueve junta. Con el chat cerrado la
 * bola descansa en un costado y se arrastra sola; al abrirlo se va a la esquina de
 * arriba mas cercana de la ventana, y a partir de ahi arrastrarla mueve las dos, porque
 * la ventana se dibuja desplazada exactamente lo que la bola se haya apartado de su
 * esquina. Al cerrar, la bola se va al lateral mas cercano desde donde haya quedado.
 *
 * Todo el movimiento es un solo `Animated.spring` por el hilo nativo sobre la posicion
 * de la bola, y la ventana lo sigue con una resta del mismo valor. No hay dos
 * animaciones que puedan discutir, que es lo que hacia que arrastrarla con el chat
 * abierto se trabara: antes la ventana estaba quieta y la bola tiraba de vuelta a su
 * sitio mientras el dedo tiraba de ella.
 *
 * `Animated.decay` seria lo obvio para el impulso y es lo que no sirve aqui: frena
 * donde quiera, y un valor que corre por el hilo nativo no se puede leer desde
 * JavaScript sin escucharlo cuadro a cuadro. Se calcula a donde llegaria con esa
 * velocidad, se lleva ese punto al costado y se salta ahi con la velocidad del dedo.
 *
 * Se puede guardar (2026-10-18, a peticion suya): al tocarla o arrastrarla con el chat
 * cerrado aparece un circulo punteado junto a Ajustes, y soltarla encima la deja ahi,
 * chica, sin aparecer en ninguna otra pantalla. Solo sale arrastrandola desde ese
 * circulo, asi que solo sale desde Hoy, Entreno o Comida. Queda guardado en los ajustes,
 * asi que sigue guardada al volver a abrir la app.
 */
type Spot = { x: number; y: number };

const MARGIN = 10;
/** Cuanto viaja por cada unidad de velocidad al soltar: el peso de la bola. */
const THROW = 90;
/** Lo que se le reserva al teclado para que la ventana entera le quepa encima. */
const KEYBOARD_ROOM = 320;
const FADE_IN = 140;
const FADE_OUT = 130;
/** Soltada con el centro a menos de esto del centro del hueco, se guarda. */
const DOCK_REACH = 44;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function Assistant() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { state, saveSetting } = useAppData();
  const ready = state.phase === 'ready';
  const docked = ready && assistantDocked(state.loaded.settings);
  const dock = useAssistantDock();

  const [open, setOpen] = useState(false);
  /** La ventana sigue montada mientras se va, para que no desaparezca de golpe. */
  const [showing, setShowing] = useState(false);
  const [grabbed, setGrabbed] = useState(false);
  /** La bola arrastrada esta encima del hueco: soltarla ahi la guarda. */
  const [over, setOver] = useState(false);
  const [keyboard, setKeyboard] = useState(0);
  const [veil] = useState(() => new Animated.Value(0));

  // La ventana, con el teclado abajo. Cuando sube, no se encoge: sube entera.
  const panel = useMemo(() => {
    const wide = Math.min(360, width - 32);
    const tall = Math.min(460, height - insets.top - insets.bottom - KEYBOARD_ROOM - 40);
    return {
      x: (width - wide) / 2,
      y: height - insets.bottom - 16 - Math.max(260, tall),
      width: wide,
      height: Math.max(260, tall),
    };
  }, [width, height, insets.top, insets.bottom]);

  const bounds = useMemo(() => {
    const top = insets.top + 8;
    // La barra de abajo flota: la bola no se queda encima de ella.
    const bottom = height - tabBarSpace(insets.bottom) - PET_SIZE - 8;
    return {
      left: MARGIN,
      right: width - PET_SIZE - MARGIN,
      top,
      bottom: Math.max(top, bottom),
    };
  }, [width, height, insets.top, insets.bottom]);

  // Donde descansa con el chat cerrado, y con que velocidad llego ahi. Un valor que
  // corre por el hilo nativo no se puede leer, asi que la cuenta se lleva aparte.
  const [home, setHome] = useState<{ at: Spot; velocity: Spot }>({
    at: { x: bounds.right, y: bounds.bottom - 120 },
    velocity: { x: 0, y: 0 },
  });
  /** El costado de la ventana del que se cuelga, elegido al abrirla. */
  const [side, setSide] = useState<'left' | 'right'>('right');
  /** Donde quedo tras arrastrar la ventana. Null es colgada de su esquina. */
  const [moved, setMoved] = useState<Spot | null>(null);
  const [pos] = useState(() => new Animated.ValueXY(home.at));
  const [scale] = useState(() => new Animated.Value(1));

  /** Donde queda la bola guardada: centrada en el hueco. */
  const dockSpot = useMemo(
    () =>
      dock && {
        x: dock.x + dock.size / 2 - PET_SIZE / 2,
        y: dock.y + dock.size / 2 - PET_SIZE / 2,
      },
    [dock],
  );
  /** Donde esta guardada, o null si anda suelta. */
  const parked = docked ? dockSpot : null;
  // Guardada solo se ve donde esta el hueco. Antes de leer los ajustes no se sabe si lo
  // esta, y dibujarla en el costado para saltar luego al hueco se veria al abrir la app.
  const shown = ready && (!docked || dockSpot !== null);

  /** La esquina de arriba de la ventana quieta, que es de donde cuelga la bola. */
  const anchor = useMemo(
    () => ({
      x: side === 'left' ? panel.x - 14 : panel.x + panel.width - PET_SIZE + 14,
      y: panel.y - 24,
    }),
    [side, panel],
  );

  // Lo que sube el conjunto cuando el teclado tapa la parte de abajo de la ventana.
  const lift = keyboard > 0 ? Math.max(0, keyboard + 10 - (insets.bottom + 16)) : 0;

  useEffect(() => {
    const shown = Keyboard.addListener('keyboardWillShow', (event) =>
      setKeyboard(event.endCoordinates.height),
    );
    const hidden = Keyboard.addListener('keyboardWillHide', () => setKeyboard(0));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  // Con el chat abierto el limite no es la bola sino la ventana: la ventana se dibuja
  // desplazada lo que la bola se aparte de su esquina, asi que lo que no puede es
  // sacarla de la pantalla ni meterla debajo del teclado.
  const reach = useMemo(() => {
    if (!open) return bounds;
    const floor = height - (keyboard > 0 ? keyboard + 10 : insets.bottom + 8);
    return {
      left: anchor.x + 8 - panel.x,
      right: anchor.x + width - 8 - panel.x - panel.width,
      top: Math.max(insets.top + 4, anchor.y + insets.top + 8 - panel.y),
      bottom: anchor.y + floor - panel.y - panel.height,
    };
  }, [open, bounds, anchor, keyboard, panel, width, height, insets.top, insets.bottom]);

  // Arrastrada sin chat puede subir hasta el hueco, aunque quede un poco mas alta que el
  // limite de siempre. Aparte de `reach` para que el hueco, que cambia con cada pantalla,
  // no mueva la bola suelta.
  const drag = useMemo(
    () => (!open && dockSpot ? { ...reach, top: Math.min(reach.top, dockSpot.y) } : reach),
    [open, dockSpot, reach],
  );

  const rest = useMemo(() => {
    const base = moved ?? { x: anchor.x, y: anchor.y - lift };
    return {
      x: clamp(base.x, reach.left, reach.right),
      y: clamp(base.y, reach.top, reach.bottom),
    };
  }, [moved, anchor, lift, reach]);

  // Si acaba de aparecer (al abrir la app, o al volver a la principal con la bola
  // guardada) se pone en su sitio sin viajar hasta el.
  const placed = useRef(false);

  // El unico sitio que la mueve sola: abrir, cerrar, soltarla, guardarla y el teclado.
  useEffect(() => {
    if (!shown) {
      placed.current = false;
      return;
    }
    const to = parked ?? (open ? rest : home.at);
    if (!placed.current) {
      placed.current = true;
      pos.setValue(to);
      return;
    }
    Animated.spring(pos, {
      toValue: to,
      // La velocidad del dedo en puntos por segundo, que es como la mide el muelle. La
      // clave se quita entera cuando no hay velocidad: Animated parte cada ajuste en x
      // e y, y un `velocity: undefined` revienta ahi mismo.
      ...(open || parked ? null : { velocity: home.velocity }),
      tension: 50,
      friction: 11,
      useNativeDriver: true,
    }).start();
  }, [shown, parked, open, rest, home, pos]);

  // Guardada se encoge al tamano del hueco, y crece al levantarla con el dedo.
  const size = docked && !grabbed && dock ? dock.size / PET_SIZE : 1;
  useEffect(() => {
    Animated.spring(scale, {
      toValue: size,
      tension: 80,
      friction: 10,
      useNativeDriver: true,
    }).start();
  }, [size, scale]);

  const show = useCallback(() => {
    // Se cuelga del lado al que ya estaba mirando, que es el viaje mas corto.
    setSide(home.at.x + PET_SIZE / 2 < width / 2 ? 'left' : 'right');
    setMoved(null);
    setShowing(true);
    setOpen(true);
    Animated.timing(veil, {
      toValue: 1,
      duration: FADE_IN,
      useNativeDriver: true,
    }).start();
  }, [home, veil, width]);

  const hide = useCallback(() => {
    // Desde donde haya quedado al costado mas cercano, que es donde no tapa nada.
    const at = rest;
    setHome({
      at: {
        x: at.x + PET_SIZE / 2 < width / 2 ? bounds.left : bounds.right,
        y: clamp(at.y, bounds.top, bounds.bottom),
      },
      velocity: { x: 0, y: 0 },
    });
    setMoved(null);
    setOpen(false);
    Keyboard.dismiss();
    Animated.timing(veil, {
      toValue: 0,
      duration: FADE_OUT,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setShowing(false);
    });
  }, [bounds, rest, veil, width]);

  // Los nodos de la resta se hacen una vez: uno nuevo por render deja atras un nodo
  // nativo en cada cuadro.
  const shift = useMemo(
    () => ({
      x: Animated.subtract(pos.x, anchor.x),
      y: Animated.subtract(pos.y, anchor.y),
    }),
    [pos, anchor],
  );

  const pan = useMemo(() => {
    const from = () => parked ?? (open ? rest : home.at);
    const near = (at: Spot) =>
      dockSpot !== null && Math.hypot(at.x - dockSpot.x, at.y - dockSpot.y) < DOCK_REACH;
    // Guardada y soltada sin sacarla, vuelve al hueco: nada cambia que la mueva sola.
    const backToDock = () => {
      if (dockSpot)
        Animated.spring(pos, {
          toValue: dockSpot,
          tension: 50,
          friction: 11,
          useNativeDriver: true,
        }).start();
    };

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_event, gesture) =>
        Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2,
      onPanResponderGrant: () => setGrabbed(true),
      onPanResponderMove: (_event, gesture) => {
        const at = from();
        const to = {
          x: clamp(at.x + gesture.dx, drag.left, drag.right),
          y: clamp(at.y + gesture.dy, drag.top, drag.bottom),
        };
        pos.setValue(to);
        if (!open) setOver(near(to));
      },
      onPanResponderRelease: (_event, gesture) => {
        setGrabbed(false);
        setOver(false);
        const at = from();
        // Un toque no es un arrastre de cero: el dedo siempre se mueve un poco.
        if (Math.abs(gesture.dx) < 6 && Math.abs(gesture.dy) < 6) {
          // Guardada no abre el chat: sale arrastrandola, como lo pidio.
          if (docked) backToDock();
          else if (open) hide();
          else show();
          return;
        }

        // Con la ventana colgando se queda donde la dejo: moverla es ponerla en otro
        // sitio, no lanzarla. Sola si sale disparada hasta el costado.
        if (open) {
          setMoved({
            x: clamp(at.x + gesture.dx, reach.left, reach.right),
            y: clamp(at.y + gesture.dy, reach.top, reach.bottom),
          });
          return;
        }

        const dropped = {
          x: clamp(at.x + gesture.dx, drag.left, drag.right),
          y: clamp(at.y + gesture.dy, drag.top, drag.bottom),
        };
        if (near(dropped)) {
          if (docked) backToDock();
          else saveSetting('assistant_docked', 'true');
          return;
        }
        if (docked) saveSetting('assistant_docked', 'false');

        const thrownX = at.x + gesture.dx + gesture.vx * THROW;
        const thrownY = at.y + gesture.dy + gesture.vy * THROW;
        setHome({
          at: {
            x: thrownX + PET_SIZE / 2 < width / 2 ? bounds.left : bounds.right,
            y: clamp(thrownY, bounds.top, bounds.bottom),
          },
          velocity: { x: gesture.vx * 1000, y: gesture.vy * 1000 },
        });
      },
      onPanResponderTerminate: () => {
        setGrabbed(false);
        setOver(false);
        if (docked) backToDock();
      },
    });
  }, [
    open,
    docked,
    parked,
    dockSpot,
    rest,
    home,
    reach,
    drag,
    bounds,
    pos,
    width,
    show,
    hide,
    saveSetting,
  ]);

  if (!shown) return null;

  return (
    <>
      {showing && (
        <>
          <Animated.View style={[styles.scrim, StyleSheet.absoluteFill, { opacity: veil }]}>
            <Pressable
              accessibilityLabel="Cerrar el chat"
              onPress={hide}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>

          <Animated.View
            style={[
              styles.window,
              {
                left: panel.x,
                top: panel.y,
                width: panel.width,
                height: panel.height,
                opacity: veil,
                // La ventana va donde vaya la bola: lo que esta se aparte de su esquina
                // se lo lleva puesto.
                transform: [{ translateX: shift.x }, { translateY: shift.y }],
              },
            ]}
          >
            <Chat onClose={hide} />
          </Animated.View>
        </>
      )}

      {/* Donde se guarda, solo mientras la tiene agarrada y en la pantalla que lo tiene. */}
      {grabbed && !open && dock && (
        <View
          pointerEvents="none"
          style={[
            styles.dock,
            over && styles.dockOver,
            {
              left: dock.x,
              top: dock.y,
              width: dock.size,
              height: dock.size,
              borderRadius: dock.size / 2,
            },
          ]}
        >
          <Text style={[styles.dockLabel, over && styles.dockLabelOver]}>Guardar</Text>
        </View>
      )}

      {/* Despues de la ventana: asi queda encendida por encima del fondo oscuro. */}
      <Ball pos={pos} scale={scale} lit={grabbed || open} handlers={pan.panHandlers} />
    </>
  );
}

const styles = sheet((theme) => ({
  scrim: {
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
  },
  dock: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: theme.textFaint,
  },
  dockOver: {
    borderStyle: 'solid',
    borderColor: theme.accent,
  },
  dockLabel: {
    fontSize: 9,
    fontFamily: font.bold,
    color: theme.textFaint,
  },
  dockLabelOver: {
    color: theme.accent,
  },
  window: {
    position: 'absolute',
    borderRadius: shape.radiusLarge,
  },
}));
