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
import { StyleSheet, View } from 'react-native';
import type { NativeStackHeaderProps } from '@react-navigation/native-stack';

/** Donde se guarda la bola, en la ventana: la esquina de arriba a la izquierda y el lado. */
export type Dock = { x: number; y: number; size: number };

/** El hueco de la barra de arriba, igual que sus botones redondos. */
export const DOCK_SIZE = 44;

/**
 * El hueco junto a Ajustes donde se guarda la bola, medido en la ventana. Null mientras
 * la pantalla principal no esta a la vista: guardada, la bola solo existe ahi.
 */
const DockContext = createContext<{
  dock: Dock | null;
  setDock: (dock: Dock | null) => void;
}>({ dock: null, setDock: () => undefined });

export function AssistantDockProvider({ children }: { children: ReactNode }) {
  const [dock, setDock] = useState<Dock | null>(null);
  const value = useMemo(() => ({ dock, setDock }), [dock]);
  return <DockContext.Provider value={value}>{children}</DockContext.Provider>;
}

export function useAssistantDock(): Dock | null {
  return useContext(DockContext).dock;
}

/**
 * El hueco en si, en la barra de la pantalla principal. No dibuja nada: la bola y el
 * circulo punteado los pone el asistente encima, y aqui solo se aparta el sitio y se
 * dice donde quedo. Al salir a otra pantalla deja de existir para la bola.
 *
 * Se mide una vez: la barra de la principal no se mueve mientras las pestanas se
 * deslizan por debajo.
 */
export function AssistantDockSlot({
  navigation,
}: {
  navigation: NativeStackHeaderProps['navigation'];
}) {
  const { setDock } = useContext(DockContext);
  const self = useRef<View>(null);
  const measured = useRef<Dock | null>(null);

  const measure = useCallback(() => {
    self.current?.measureInWindow((x, y, width) => {
      measured.current = { x, y, size: width };
      if (navigation.isFocused()) setDock(measured.current);
    });
  }, [navigation, setDock]);

  useEffect(() => {
    const focus = navigation.addListener('focus', () => setDock(measured.current));
    const blur = navigation.addListener('blur', () => setDock(null));
    return () => {
      focus();
      blur();
      setDock(null);
    };
  }, [navigation, setDock]);

  return (
    <View
      ref={self}
      collapsable={false}
      pointerEvents="none"
      onLayout={measure}
      style={styles.slot}
    />
  );
}

const styles = StyleSheet.create({
  slot: { width: DOCK_SIZE, height: DOCK_SIZE },
});
