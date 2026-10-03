/**
 * Corre `run` como mucho una vez cada `everyMs`, y lo que se pide dentro de la espera no
 * se pierde: deja una sola pasada para cuando la espera termina, con lo ultimo que se
 * pidio. `flush` corre ya esa pasada pendiente, si la hay.
 *
 * Sin la pasada del final, lo pedido en medio se tiraba: el plan de avisos se rehacia al
 * abrir la app y no despues del agua anotada veinte segundos mas tarde, y a las 16:30
 * llegaba "agua por debajo de la mitad".
 */
export function throttled<A extends unknown[]>(
  run: (...args: A) => void,
  everyMs: number,
  now: () => number = Date.now,
): { call: (...args: A) => void; flush: () => void } {
  let last = -Infinity;
  let pending: A | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const fire = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const args = pending;
    pending = null;
    if (args === null) return;
    last = now();
    run(...args);
  };

  return {
    call: (...args: A) => {
      pending = args;
      const wait = last + everyMs - now();
      if (wait <= 0 && timer === null) fire();
      else if (timer === null) timer = setTimeout(fire, wait);
    },
    flush: fire,
  };
}
