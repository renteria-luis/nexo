import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * La hora de ahora para lo que se pinta segun cuanto tiempo paso, mirada al montar y otra
 * vez cada vez que vuelve a la app: una pantalla que se queda montada dias en memoria no
 * puede seguir midiendo desde la hora en que se abrio.
 */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') setNow(Date.now());
    });
    return () => subscription.remove();
  }, []);
  return now;
}
