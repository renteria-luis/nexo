import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NumberPad, type PadKey } from './NumberPad.tsx';

/**
 * El teclado de la app vive una sola vez, aqui, y flota sobre todo lo demas.
 *
 * Los campos numericos se apuntan cuando reciben el foco y se borran al cerrarse,
 * asi que ninguna pantalla tiene que llevar un teclado propio ni saber que hay uno.
 */
export type PadTarget = {
  /** Que hacer con cada tecla. El campo es quien sabe lo que lleva escrito. */
  onKey: (key: PadKey) => void;
  allowDecimal: boolean;
  /** Para soltar el foco del campo, o volver a tocarlo no lo reabre. */
  onClose: () => void;
};

type PadApi = {
  open: (target: PadTarget) => void;
  close: () => void;
  isOpen: boolean;
  /**
   * En que campo esta escribiendo, para que el campo lo sepa sin depender de su propio
   * foco: al abrirse el teclado la primera vez, el campo pierde el foco y con el la
   * marca de "estoy escribiendo aqui".
   */
  target: PadTarget | null;
};

const Context = createContext<PadApi>({
  open: () => undefined,
  close: () => undefined,
  isOpen: false,
  target: null,
});

export function useNumberPad(): PadApi {
  return useContext(Context);
}

export function NumberPadHost({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<PadTarget | null>(null);
  const insets = useSafeAreaInsets();
  // El mismo dato en una referencia para poder avisar al campo que suelta fuera del
  // render. Avisarle desde dentro del cambio de estado era avisarle mientras React
  // pintaba, y React se comia ese aviso: el campo viejo se quedaba marcado y el nuevo
  // salia sin marcar.
  const current = useRef<PadTarget | null>(null);

  const close = useCallback(() => {
    const previous = current.current;
    current.current = null;
    setTarget(null);
    previous?.onClose();
  }, []);

  const open = useCallback((next: PadTarget) => {
    const previous = current.current;
    current.current = next;
    setTarget(next);
    // Saltar de un campo a otro suelta el anterior sin cerrar el teclado.
    if (previous && previous !== next) previous.onClose();
  }, []);

  const api = useMemo(
    () => ({ open, close, isOpen: target !== null, target }),
    [open, close, target],
  );

  return (
    <Context.Provider value={api}>
      {/* Tocar fuera del teclado lo cierra, pero solo donde no habia nada que tocar.
          Un toque se ofrece primero al elemento mas hondo y solo sube si nadie lo
          quiere, asi que un boton o un campo se quedan con el suyo y nunca llega
          hasta aqui: siguen funcionando a la primera y con el teclado abierto. */}
      <View
        style={styles.app}
        onStartShouldSetResponder={target ? claimTouch : undefined}
        onResponderRelease={target ? close : undefined}
      >
        {children}
      </View>
      {target && (
        <NumberPad
          onKey={target.onKey}
          onClose={close}
          allowDecimal={target.allowDecimal}
          bottomInset={insets.bottom}
        />
      )}
    </Context.Provider>
  );
}

const claimTouch = () => true;

const styles = StyleSheet.create({
  app: {
    flex: 1,
  },
});

/** Lo que mide el teclado, para que el contenido pueda hacerle sitio al desplazarse. */
export const NUMBER_PAD_HEIGHT = 220;
