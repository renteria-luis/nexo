import { useEffect, useState } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';

/** Minutos y segundos, que es como se lee un descanso: "2:30". */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Los segundos que lleva corriendo desde un instante, al dia cada segundo. */
export function useSecondsSince(since: number): number {
  const [seconds, setSeconds] = useState(() => (Date.now() - since) / 1000);

  useEffect(() => {
    const tick = setInterval(() => setSeconds((Date.now() - since) / 1000), 1000);
    return () => clearInterval(tick);
  }, [since]);

  return seconds;
}

/**
 * Lo que lleva corriendo desde un instante, contando solo.
 *
 * En su propio componente porque un valor que cambia cada segundo dentro de una pantalla
 * grande la repinta entera una vez por segundo. Aqui lo que se repinta es este texto.
 * Con `target`, al llegar a esos segundos se pinta con `reachedStyle`.
 */
export function Elapsed({
  since,
  prefix = '',
  target,
  reachedStyle,
}: {
  since: number;
  prefix?: string;
  target?: number;
  reachedStyle?: StyleProp<TextStyle>;
}) {
  const seconds = useSecondsSince(since);
  const text = `${prefix}${clock(seconds)}`;

  // Redondeado como el reloj: en "1:30 de 1:30" ya tiene que estar verde.
  return target !== undefined && Math.round(seconds) >= target ? (
    <Text style={reachedStyle}>{text}</Text>
  ) : (
    <>{text}</>
  );
}
