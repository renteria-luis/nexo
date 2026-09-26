import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { DARK, LIGHT, applyPalette, type Palette } from './theme.ts';

/**
 * Quien decide si la app se ve clara u oscura.
 *
 * Las hojas de estilo se escriben una sola vez y se rehacen solas al cambiar de
 * paleta, asi que aqui solo hay que resolver cual toca y volver a montar el arbol
 * para que todo se pinte con la nueva. Montar de nuevo y no avisar pantalla por
 * pantalla: cambiar de modo pasa tres veces al dia como mucho, y asi ninguna pantalla
 * tiene que saber que existen dos.
 */
export type ThemeMode = 'claro' | 'oscuro' | 'sistema' | 'horario';

export type ThemeSkinProps = {
  mode: ThemeMode;
  /** Hora a la que empieza y termina el modo oscuro cuando va por horario. */
  darkFrom: number;
  darkTo: number;
  children: ReactNode;
};

/** Si esa hora cae dentro de la franja oscura, contando que cruza la medianoche. */
export function isDarkHour(hour: number, from: number, to: number): boolean {
  if (from === to) return false;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

export function ThemeSkin({ mode, darkFrom, darkTo, children }: ThemeSkinProps) {
  const system = useColorScheme();
  // Un minuto es de sobra para notar que cruzo la hora, y no cuesta nada.
  const [minute, setMinute] = useState(() => new Date().getHours());
  useEffect(() => {
    if (mode !== 'horario') return;
    const tick = setInterval(() => setMinute(new Date().getHours()), 60_000);
    return () => clearInterval(tick);
  }, [mode]);

  const palette: Palette = useMemo(() => {
    if (mode === 'claro') return LIGHT;
    if (mode === 'oscuro') return DARK;
    if (mode === 'sistema') return system === 'dark' ? DARK : LIGHT;
    return isDarkHour(minute, darkFrom, darkTo) ? DARK : LIGHT;
  }, [mode, system, minute, darkFrom, darkTo]);

  applyPalette(palette);

  // La clave fuerza el montaje nuevo con los estilos ya rehechos.
  return <Fragment key={palette === DARK ? 'oscuro' : 'claro'}>{children}</Fragment>;
}

function Fragment({ children }: { key: string; children: ReactNode }) {
  return <>{children}</>;
}
