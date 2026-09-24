import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
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
};

const Context = createContext<PadApi>({
  open: () => undefined,
  close: () => undefined,
  isOpen: false,
});

export function useNumberPad(): PadApi {
  return useContext(Context);
}

export function NumberPadHost({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<PadTarget | null>(null);
  const insets = useSafeAreaInsets();

  const close = useCallback(() => {
    setTarget((current) => {
      current?.onClose();
      return null;
    });
  }, []);

  const open = useCallback((next: PadTarget) => {
    setTarget((current) => {
      // Saltar de un campo a otro suelta el anterior sin cerrar el teclado.
      if (current && current !== next) current.onClose();
      return next;
    });
  }, []);

  const api = useMemo(() => ({ open, close, isOpen: target !== null }), [open, close, target]);

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
