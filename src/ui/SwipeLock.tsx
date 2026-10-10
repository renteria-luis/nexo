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
  isLocked: () => boolean;
  setLocked: (locked: boolean) => void;
  acquire: () => () => void;
};

const Actions = createContext<SwipeLock>({
  isLocked: () => false,
  setLocked: () => undefined,
  acquire: () => () => undefined,
});

/**
 * Apagado o no, aparte de las funciones: solo el carrusel lo lee. Juntos, cada vez que una
 * fila del orden de Entreno se despegaba se redibujaba todo lo que usa el interruptor, y
 * despegarla tardaba (2026-10-10).
 */
const Locked = createContext(false);

export function useSwipeLock(): SwipeLock {
  return useContext(Actions);
}

export function useSwipeLocked(): boolean {
  return useContext(Locked);
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
  const actions = useMemo(() => ({ isLocked, setLocked, acquire }), [isLocked, setLocked, acquire]);

  return (
    <Actions.Provider value={actions}>
      <Locked.Provider value={locked}>{children}</Locked.Provider>
    </Actions.Provider>
  );
}
