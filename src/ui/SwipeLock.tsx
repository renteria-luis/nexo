import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

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
  setLocked: (locked: boolean) => void;
};

const Context = createContext<SwipeLock>({ locked: false, setLocked: () => undefined });

export function useSwipeLock(): SwipeLock {
  return useContext(Context);
}

export function SwipeLockProvider({ children }: { children: ReactNode }) {
  const [locked, setLocked] = useState(false);
  const value = useMemo(() => ({ locked, setLocked }), [locked]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
