import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useAppData } from '../../shell/AppData.tsx';
import { Button } from '../Button.tsx';
import { FloatingBarSpace } from '../TabBar.tsx';
import { font, sheet } from '../theme.ts';

/**
 * The frame every tab shares: scrolls, paints the full height so nothing shows
 * through underneath, and refuses to render its contents until the database is
 * open. A screen that opened on a failed database would look empty rather than
 * broken.
 *
 * El teclado se resuelve con las tres propiedades que ya trae el ScrollView de iOS y
 * sin ninguna libreria: la app arrancaba con un TypeError porque el paquete que se
 * usaba antes arrastraba reanimated 4, que pide una version de worklets que este SDK
 * de Expo todavia no soporta.
 */
/**
 * Subir el contenido para que el teclado de la app no tape lo que se esta escribiendo.
 *
 * El teclado vive en la raiz y mide siempre lo mismo, asi que no hay eventos de teclado
 * que escuchar como con el del sistema: al enfocar un campo se mide donde queda respecto
 * al contenido y se desplaza lo justo para que su bloque quede encima del teclado. Solo
 * sube, nunca baja: si ya se ve entero, no se mueve nada.
 */
type Measurable = {
  measureInWindow: (
    onSuccess: (x: number, y: number, width: number, height: number) => void,
  ) => void;
};

type Reveal = (target: Measurable | null) => void;

const RevealContext = createContext<Reveal>(() => undefined);

/** El aire con el que termina cualquier pantalla, antes de sumarle lo que tape la barra. */
const CONTENT_BOTTOM = 40;

/** Lo que nunca deja de haber entre una hoja y el borde de la pantalla. */
const OVERLAY_PADDING = 14;

/** Lo llama un campo al recibir el foco, con lo que tiene que quedar a la vista. */
export function useReveal(): Reveal {
  return useContext(RevealContext);
}

export function Screen({
  title,
  children,
  overlay,
  onOverlayDismiss,
  scrollEnabled = true,
}: {
  title?: string;
  children: ReactNode;
  /** Lo que va encima de la pantalla entera, fuera del scroll y sin ser un modal. */
  overlay?: ReactNode;
  /**
   * Que hacer al tocar el fondo oscuro. Sin esto el fondo no se toca: no toda hoja se
   * puede cerrar tocando fuera, y una que se cierra a medio llenar es un formulario
   * perdido.
   */
  onOverlayDismiss?: () => void;
  /**
   * Apagado mientras se arrastra algo de dentro. Tomar el toque no basta: el scroll es
   * nativo y se lo lleva igual, asi que mientras dura el arrastre la pantalla deja de
   * escuchar.
   */
  scrollEnabled?: boolean;
}) {
  const { state, resetDatabase } = useAppData();
  // En las pestanas la barra de abajo flota encima del contenido: lo ultimo de la
  // pantalla necesita ese hueco para poder subir por encima de ella.
  const barSpace = useContext(FloatingBarSpace);
  const [confirming, setConfirming] = useState(false);
  const list = useRef<ScrollView>(null);
  const frame = useRef<View>(null);
  const offset = useRef(0);
  // Lo que se subio el contenido para dejar ver el campo, y que hay que devolver
  // cuando el teclado se va: si no, la pantalla se queda mirando un hueco.
  const lifted = useRef(0);
  // El bloque que ya se subio en esta tanda de teclado, y el que espera a que el
  // teclado diga cuanto mide.
  const revealed = useRef<Measurable | null>(null);
  const pending = useRef<Measurable | null>(null);
  // Lo que tapa el teclado, medido por el propio teclado. Entra en las dependencias
  // para que la cuenta de subir el contenido no se quede con el valor de partida.
  // Lo que tapa el teclado del sistema, que lo dice el mismo al aparecer.
  const [keyboard, setKeyboard] = useState(0);
  const tall = useRef(0);
  // Lo que mide el marco y lo que mide la hoja, para poder subirla lo justo: lo que el
  // teclado le tapa, y nunca mas de lo que hay libre por arriba.
  const [frameHeight, setFrameHeight] = useState(0);
  const [sheetHeight, setSheetHeight] = useState(0);
  const shift = useMemo(() => {
    if (frameHeight === 0 || sheetHeight === 0) return 0;
    const spare = (frameHeight - sheetHeight) / 2;
    const covered = keyboard - spare;
    return -Math.max(0, Math.min(covered, spare - OVERLAY_PADDING));
  }, [frameHeight, sheetHeight, keyboard]);
  // La hoja sube con la misma animacion del teclado: cero en reposo, uno con el teclado
  // arriba, y lo que tarda lo dice el propio aviso del sistema.
  const [rise] = useState(() => new Animated.Value(0));
  const lift = useMemo(
    () => rise.interpolate({ inputRange: [0, 1], outputRange: [0, shift] }),
    [rise, shift],
  );

  /**
   * Sube el contenido lo justo para que el teclado no tape el bloque que se esta
   * escribiendo. Solo sube: algo que ya se ve no se mueve.
   */
  const raise = useCallback((target: Measurable, height: number) => {
    target.measureInWindow((_x, y, _width, blockHeight) => {
      frame.current?.measureInWindow((_frameX, frameY, _frameWidth, frameHeight) => {
        // Todo en coordenadas de pantalla y en relativo: cuanto sobra por debajo del
        // borde del teclado, y se desplaza justo eso. Medir contra el contenido daba
        // numeros de otro origen y el desplazamiento se quedaba corto.
        const top = frameY + frameHeight - height;
        const below = y + blockHeight + 12 - top;
        // Nunca tanto que se vaya la cabeza del bloque por encima de la pantalla.
        const room = Math.max(0, y - frameY);
        const move = Math.min(below, room);
        if (move > 0) {
          lifted.current += move;
          list.current?.scrollTo({ y: offset.current + move, animated: true });
        }
      });
    });
  }, []);

  const reveal = useCallback<Reveal>(
    (target) => {
      // Una vez por bloque y no una por foco: saltando de un campo a otro el teclado ya
      // no vuelve a avisar, y sin esto cada vuelta sumaria una subida sobre la anterior.
      if (target === null || target === revealed.current) return;
      // Con un formulario encima no hay nada que subir: lo que se mueve es la hoja.
      if (overlay) return;
      revealed.current = target;
      // Si el teclado ya esta arriba, sube ahora; si no, cuando el sistema diga cuanto
      // mide, que es lo unico que se puede saber de el.
      if (tall.current > 0) raise(target, tall.current);
      else pending.current = target;
    },
    [overlay, raise],
  );

  useEffect(() => {
    // El sistema avisa antes de mover el teclado, y trae su alto y lo que va a tardar:
    // con eso la pantalla se mueve con el y no detras de el.
    const shown = Keyboard.addListener('keyboardWillShow', (event) => {
      const height = event.endCoordinates.height;
      tall.current = height;
      setKeyboard(height);
      Animated.timing(rise, {
        toValue: 1,
        duration: event.duration > 0 ? event.duration : 250,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      const target = pending.current;
      pending.current = null;
      // Un cuadro de espera: el contenido acaba de crecer por debajo para hacerle sitio
      // al teclado, y sin ese hueco el desplazamiento se queda corto.
      if (target) requestAnimationFrame(() => raise(target, height));
    });

    const hidden = Keyboard.addListener('keyboardWillHide', (event) => {
      tall.current = 0;
      setKeyboard(0);
      pending.current = null;
      revealed.current = null;
      Animated.timing(rise, {
        toValue: 0,
        duration: event.duration > 0 ? event.duration : 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start();
      // Y el contenido vuelve por donde subio, a la vez que el teclado baja.
      const back = lifted.current;
      lifted.current = 0;
      if (back > 0) {
        list.current?.scrollTo({ y: Math.max(0, offset.current - back), animated: true });
      }
    });

    return () => {
      shown.remove();
      hidden.remove();
    };
  }, [raise, rise]);

  const scroll = (
    <ScrollView
      ref={list}
      scrollEnabled={scrollEnabled}
      onScroll={(event) => (offset.current = event.nativeEvent.contentOffset.y)}
      scrollEventThrottle={32}
      // Un toque en un boton con el teclado abierto lo pulsa a la primera; uno en
      // cualquier otro sitio sigue cerrando el teclado.
      keyboardShouldPersistTaps="handled"
      // Y arrastrar hacia abajo lo baja siguiendo el dedo. Con el teclado de la app
      // abierto no hay teclado del sistema que bajar, y en cambio si hay contenido que
      // se desplaza solo para dejar el campo a la vista: con esto puesto, ese
      // desplazamiento le quitaba el foco al campo y con el, el cursor.
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      style={styles.scroll}
      // Con el teclado de la app abierto, el contenido se puede seguir subiendo para
      // sacar de debajo el campo que se esta escribiendo.
      contentContainerStyle={[
        styles.content,
        { paddingBottom: CONTENT_BOTTOM + (keyboard > 0 ? keyboard : barSpace) },
      ]}
    >
      {title ? <Text style={styles.title}>{title}</Text> : null}

      {state.phase === 'opening' && <ActivityIndicator accessibilityLabel="Abriendo la base" />}

      {state.phase === 'failed' && (
        <View style={styles.failure}>
          <Text style={styles.error}>No abrió la base de datos: {state.message}</Text>
          {/* Con la base rota no se llega ni a Ajustes, asi que la unica salida vive
              aqui. Borra y reconstruye: se pierde lo registrado, por eso pregunta. */}
          {confirming ? (
            <View style={styles.failureButtons}>
              <Button
                label="Sí, borrar y empezar de cero"
                accessibilityLabel="Confirmar borrado"
                variant="danger"
                block
                onPress={() => {
                  setConfirming(false);
                  resetDatabase();
                }}
              />
              <Button
                label="Cancelar"
                accessibilityLabel="Cancelar borrado"
                block
                onPress={() => setConfirming(false)}
              />
            </View>
          ) : (
            <Button
              label="Borrar la base de datos"
              accessibilityLabel="Borrar la base de datos"
              onPress={() => setConfirming(true)}
            />
          )}
        </View>
      )}

      {state.phase === 'ready' && children}
    </ScrollView>
  );

  return (
    <RevealContext.Provider value={reveal}>
      {/* El marco se mide para saber donde empieza el teclado en la pantalla. */}
      <View
        ref={frame}
        collapsable={false}
        onLayout={(event) => setFrameHeight(event.nativeEvent.layout.height)}
        style={styles.stack}
      >
        {scroll}
        {/* Con el teclado abierto la capa se encoge por arriba de el: si no, los
            botones de guardar y confirmar quedan justo debajo de las teclas. */}
        {overlay ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            {/* El oscurecido cubre la pantalla entera y no se encoge con el teclado: el
                hueco que se le hace abajo es parte del fondo, y sin esto se veia una
                franja sin oscurecer mientras el teclado sube o baja. */}
            {onOverlayDismiss ? (
              <Pressable
                accessibilityLabel="Cerrar"
                onPress={() => {
                  // El teclado se quedaria flotando sobre una pantalla en la que ya no
                  // hay nada que escribir.
                  Keyboard.dismiss();
                  onOverlayDismiss();
                }}
                style={styles.scrim}
              />
            ) : (
              <View style={styles.scrim} pointerEvents="none" />
            )}
            {/* La hoja se centra en lo que queda libre encima del teclado. El hueco se
                hace de golpe, para que la hoja nunca mida mas de lo que cabe, y el
                desplazamiento lo deshace: asi sube con la misma animacion del teclado en
                vez de dar un salto. */}
            <Animated.View
              pointerEvents="box-none"
              style={[styles.overlay, { transform: [{ translateY: lift }] }]}
            >
              <View onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}>
                {overlay}
              </View>
            </Animated.View>
          </View>
        ) : null}
      </View>
    </RevealContext.Provider>
  );
}

const styles = sheet((theme) => ({
  stack: {
    flex: 1,
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    padding: OVERLAY_PADDING,
    // Centrado y del alto que necesite: una hoja que ocupa la pantalla entera parece
    // otra pantalla, y esto es un formulario corto.
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  content: {
    flexGrow: 1,
    backgroundColor: theme.bg,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: CONTENT_BOTTOM,
    gap: 12,
  },
  title: {
    fontSize: 27,
    fontFamily: font.display,
    color: theme.text,
    letterSpacing: -0.5,
    marginBottom: 2,
  },
  failure: {
    gap: 12,
    alignItems: 'center',
    marginTop: 24,
  },
  failureButtons: {
    gap: 8,
    alignSelf: 'stretch',
  },
  error: {
    fontSize: 14,
    fontFamily: font.bold,
    color: theme.danger,
    textAlign: 'center',
  },
}));
