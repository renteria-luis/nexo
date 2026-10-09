import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * El interruptor que apaga el deslizamiento entre pestanas.
 *
 * Las cinco pestanas son un carrusel, y su gesto horizontal es nativo: en cuanto el dedo
 * se va un milimetro a un lado, el carrusel reclama el toque y a quien lo tenia le llega
 * un "se te quito". Arrastrando una fila eso soltaba el asa, porque ningun dedo baja
 * recto. Mientras algo de dentro esta arrastrando, el carrusel deja de escuchar.
 *
 * Vive arriba de la navegacion porque quien lo apaga (una pantalla) y quien lo obedece
 * (el carrusel de pestanas) no se ven entre si.
 */
type SwipeLock = {
  locked: boolean;
  isLocked: () => boolean;
  setLocked: (locked: boolean) => void;
  acquire: () => () => void;
};

const Context = createContext<SwipeLock>({
  locked: false,
  isLocked: () => false,
  setLocked: () => undefined,
  acquire: () => () => undefined,
});

export function useSwipeLock(): SwipeLock {
  return useContext(Context);
}

export function SwipeLockProvider({ children }: { children: ReactNode }) {
  const [locked, publish] = useState(false);
  const legacy = useRef(false);
  const owners = useRef(new Set<symbol>());
  // Capture handlers can run before React publishes the touch-start update.
  const isLocked = useCallback(() => legacy.current || owners.current.size > 0, []);
  const setLocked = useCallback((value: boolean) => {
    legacy.current = value;
    publish(value || owners.current.size > 0);
  }, []);
  const acquire = useCallback(() => {
    const owner = Symbol();
    owners.current.add(owner);
    publish(true);
    return () => {
      owners.current.delete(owner);
      publish(legacy.current || owners.current.size > 0);
    };
  }, []);
  const value = useMemo(
    () => ({ locked, isLocked, setLocked, acquire }),
    [locked, isLocked, setLocked, acquire],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
