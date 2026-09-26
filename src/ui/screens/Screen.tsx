import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, ScrollView, Text, View } from 'react-native';

import { useAppData } from '../../shell/AppData.tsx';
import { Button } from '../Button.tsx';
import { NUMBER_PAD_HEIGHT, useNumberPad } from '../NumberPadHost.tsx';
import { font, sheet, shape } from '../theme.ts';

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

/** Lo llama un campo al recibir el foco, con lo que tiene que quedar a la vista. */
export function useReveal(): Reveal {
  return useContext(RevealContext);
}

export function Screen({
  title,
  children,
  overlay,
  scrollEnabled = true,
}: {
  title?: string;
  children: ReactNode;
  /** Lo que va encima de la pantalla entera, fuera del scroll y sin ser un modal. */
  overlay?: ReactNode;
  /**
   * Apagado mientras se arrastra algo de dentro. Un arrastre vertical dentro de un
   * scroll es ambiguo y el scroll gana siempre: la unica forma de que el dedo mueva
   * la fila y no la pantalla es que la pantalla deje de escuchar mientras dura.
   */
  scrollEnabled?: boolean;
}) {
  const { state, resetDatabase } = useAppData();
  const pad = useNumberPad();
  const [confirming, setConfirming] = useState(false);
  const list = useRef<ScrollView>(null);
  const frame = useRef<View>(null);
  const offset = useRef(0);

  const reveal = useCallback<Reveal>((target) => {
    // Un cuadro de espera: el contenido acaba de crecer por debajo para hacerle sitio al
    // teclado, y sin ese hueco el desplazamiento se queda corto.
    requestAnimationFrame(() => {
      if (!target) return;
      target.measureInWindow((_x, y, _width, height) => {
        frame.current?.measureInWindow((_frameX, frameY, _frameWidth, frameHeight) => {
          // Todo en coordenadas de pantalla y en relativo: cuanto sobra por debajo del
          // borde del teclado, y se desplaza justo eso. Medir contra el contenido daba
          // numeros de otro origen y el desplazamiento se quedaba corto.
          const keyboard = frameY + frameHeight - NUMBER_PAD_HEIGHT;
          const below = y + height + 12 - keyboard;
          // Nunca tanto que se vaya la cabeza del bloque por encima de la pantalla.
          const room = Math.max(0, y - frameY);
          const move = Math.min(below, room);
          if (move > 0) list.current?.scrollTo({ y: offset.current + move, animated: true });
        });
      });
    });
  }, []);

  const scroll = (
    <ScrollView
      ref={list}
      scrollEnabled={scrollEnabled}
      onScroll={(event) => (offset.current = event.nativeEvent.contentOffset.y)}
      scrollEventThrottle={32}
      // Un toque en un boton con el teclado abierto lo pulsa a la primera; uno en
      // cualquier otro sitio sigue cerrando el teclado.
      keyboardShouldPersistTaps="handled"
      // Y arrastrar hacia abajo lo baja siguiendo el dedo.
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      style={styles.scroll}
      // Con el teclado de la app abierto, el contenido se puede seguir subiendo para
      // sacar de debajo el campo que se esta escribiendo.
      contentContainerStyle={[styles.content, pad.isOpen && { paddingBottom: NUMBER_PAD_HEIGHT }]}
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
      <View ref={frame} collapsable={false} style={styles.stack}>
        {scroll}
        {/* Con el teclado abierto la capa se encoge por arriba de el: si no, los
            botones de guardar y confirmar quedan justo debajo de las teclas. */}
        {overlay ? (
          <View style={[styles.overlay, pad.isOpen && { bottom: NUMBER_PAD_HEIGHT }]}>
            {overlay}
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
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    padding: 14,
    // Centrado y del alto que necesite: una hoja que ocupa la pantalla entera parece
    // otra pantalla, y esto es un formulario corto.
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
  },
  scroll: {
    flex: 1,
    backgroundColor: theme.bg,
    // La raya que cierra el encabezado: el nativo no deja ponerle borde a el.
    borderTopWidth: shape.border,
    borderTopColor: theme.line,
  },
  content: {
    flexGrow: 1,
    backgroundColor: theme.bg,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 40,
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
