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
  backgroundFor,
  backgroundsFrom,
  type Background,
  type Backgrounds,
} from '../core/backgrounds.ts';
import { useAppData } from '../shell/AppData.tsx';

/**
 * El fondo que se esta probando, encima de la pantalla misma (2026-10-18, a peticion
 * suya: una vista previa en chico no era la pantalla de verdad). Mientras dura, el fondo
 * de esa pantalla se dibuja con el borrador; al guardar o cancelar, vuelve a lo guardado.
 * `label` es la pantalla que se tiene delante, que para el general es Hoy.
 */
type Session = { screen: string; label: string; draft: Background };

type Editing = {
  begin: (screen: string, label: string) => void;
  change: (draft: Background) => void;
  end: () => void;
};

const SessionContext = createContext<Session | null>(null);
const EditingContext = createContext<Editing>({
  begin: () => undefined,
  change: () => undefined,
  end: () => undefined,
});

/** Lo que se esta editando, para que el fondo de esa pantalla dibuje el borrador. */
export function useEditingBackground(): Session | null {
  return useContext(SessionContext);
}

export function useBackgroundEditing(): Editing {
  return useContext(EditingContext);
}

export function BackgroundEditingProvider({ children }: { children: ReactNode }) {
  const { state } = useAppData();
  const raw = state.phase === 'ready' ? state.loaded.settings.get('backgrounds') : undefined;
  const [session, setSession] = useState<Session | null>(null);
  const latest = useRef(raw);
  useEffect(() => {
    latest.current = raw;
  });
  const begin = useCallback((screen: string, label: string) => {
    setSession({ screen, label, draft: backgroundFor(backgroundsFrom(latest.current), screen) });
  }, []);
  const change = useCallback(
    (draft: Background) => setSession((current) => (current ? { ...current, draft } : current)),
    [],
  );
  const end = useCallback(() => setSession(null), []);
  const editing = useMemo(() => ({ begin, change, end }), [begin, change, end]);
  return (
    <EditingContext.Provider value={editing}>
      <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
    </EditingContext.Provider>
  );
}

/**
 * Los fondos que se dibujan ahora: los guardados, con el borrador encima mientras se
 * prueba uno. Lo leen el fondo de cada pantalla y las tarjetas, que tienen que ver lo
 * mismo detras de ellas.
 */
export function useBackgrounds(): Backgrounds {
  const { state } = useAppData();
  const raw = state.phase === 'ready' ? state.loaded.settings.get('backgrounds') : undefined;
  const editing = useEditingBackground();
  return useMemo(() => {
    const saved = backgroundsFrom(raw);
    return editing ? { ...saved, [editing.screen]: editing.draft } : saved;
  }, [raw, editing]);
}
