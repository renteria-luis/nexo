import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
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
      {children}
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

/** Lo que mide el teclado, para que el contenido pueda hacerle sitio al desplazarse. */
export const NUMBER_PAD_HEIGHT = 220;
