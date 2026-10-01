import { useEffect, useState } from 'react';

/** Minutos y segundos, que es como se lee un descanso: "2:30". */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * Lo que lleva corriendo desde un instante, contando solo.
 *
 * En su propio componente porque un valor que cambia cada segundo dentro de una pantalla
 * grande la repinta entera una vez por segundo. Aqui lo que se repinta es este texto.
 */
export function Elapsed({ since, prefix = '' }: { since: number; prefix?: string }) {
  const [seconds, setSeconds] = useState(() => (Date.now() - since) / 1000);

  useEffect(() => {
    const tick = setInterval(() => setSeconds((Date.now() - since) / 1000), 1000);
    return () => clearInterval(tick);
  }, [since]);

  return (
    <>
      {prefix}
      {clock(seconds)}
    </>
  );
}
