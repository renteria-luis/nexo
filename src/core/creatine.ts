// Cuanta creatina lleva dentro el musculo, estimada dia a dia.
//
// La creatina no se nota el dia que se toma: funciona por acumulacion. El musculo se va
// llenando mientras la tome y se va vaciando cuando deja de tomarla, y lo que importa es
// en que punto de esa curva esta, no si hoy se acordo. Eso es lo que la cuadricula no
// puede decir con un si o un no por dia.
//
// Los dos extremos de la curva son medidos, no inventados (Hultman 1996, "Muscle
// creatine loading in men", J Appl Physiol 81:232-237):
//
//   - tomando 3 g al dia, el musculo llega en 28 dias al mismo +20% que se alcanza en
//     seis dias con la fase de carga de 20 g al dia;
//   - dejando de tomarla, a los 30 dias la concentracion ya no se distingue de la que
//     tenia antes de empezar.
//
// Entre esos dos puntos no hay medidas diarias publicadas, asi que la curva de aqui es la
// forma mas simple que los une, y sube distinto de como baja porque lo que pasa dentro
// tambien es distinto:
//
//   - **llenando**, cada dia entra una fraccion de lo que le falta. El transporte al
//     musculo se satura, asi que cuanto mas lleno esta menos coge: la primera semana sube
//     mucho y la cuarta casi nada;
//   - **vaciando**, cada dia se pierde lo mismo. Lo que sale es el desgaste normal, que
//     no sabe cuanta creatina queda: por eso treinta dias de nada lo dejan en cero,
//     repartidos a partes iguales.
//
// Es una estimacion con los extremos medidos, y la pantalla lo dice.
//
// Un dia sin anotar cuenta como no tomada. Es la lectura conservadora: la alternativa es
// suponer que si la tomo, y entonces el numero que le promete el efecto sale de dias que
// nadie registro.

import { addDays, type IsoDate } from './dates.ts';

/** Hultman 1996: 3 g al dia llenan el deposito en 28 dias. */
export const FILL_DAYS = 28;
/** Hultman 1996: sin tomarla, a los 30 dias esta como al principio. */
export const EMPTY_DAYS = 30;
/**
 * Lo que se considera lleno y vacio. Una exponencial nunca toca el extremo, asi que el
 * 95% es "lleno" y el 5% es "vacio", que es lo que hace que los dias de arriba cuadren
 * con los del estudio.
 */
const EDGE = 0.05;

/** Llenando: cada dia entra esta parte de lo que falta. */
const UP = 1 - EDGE ** (1 / FILL_DAYS);
/** Vaciando: cada dia se pierde esto del deposito entero, pase lo que pase. */
const DOWN = 1 / EMPTY_DAYS;

/**
 * Desde donde se empieza a contar cuando no hay nada anotado antes: vacio. Es lo mismo
 * que suponer que empezo a tomarla el primer dia que lo anoto.
 */
export const EMPTY = 0;

export type CreatineDay = { date: IsoDate; taken: boolean | null };

export type Saturation = { date: IsoDate; value: number };

/**
 * El deposito dia a dia, de 0 a 1, desde el primer dia anotado hasta el ultimo que se
 * pida.
 *
 * Los huecos entre dias anotados cuentan como dias sin tomarla, que es lo que de verdad
 * pasa: el deposito no se queda quieto porque nadie abriera la app.
 */
export function saturationSeries(
  days: readonly CreatineDay[],
  until: IsoDate,
  from = EMPTY,
): Saturation[] {
  const written = [...days].sort((a, b) => a.date.localeCompare(b.date));
  if (written.length === 0) return [];

  const taken = new Map(written.map((day) => [day.date, day.taken === true]));
  const series: Saturation[] = [];
  let level = from;

  for (let date = written[0].date; date <= until; date = addDays(date, 1)) {
    level = taken.get(date) === true ? level + (1 - level) * UP : Math.max(0, level - DOWN);
    series.push({ date, value: level });
  }

  return series;
}

export type CreatineReading = {
  /** De 0 a 1, lo que lleva dentro hoy. */
  level: number;
  /** Lo que ha hecho en la ultima semana, que es lo que dice si va bien o mal. */
  trend: 'subiendo' | 'bajando' | 'estable';
  /** Cuantos dias seguidos lleva tomandola, o sin tomarla si es negativo. */
  streak: number;
};

export function readSaturation(
  series: readonly Saturation[],
  days: readonly CreatineDay[],
): CreatineReading | null {
  if (series.length === 0) return null;

  const level = series[series.length - 1].value;
  const before = series[Math.max(0, series.length - 8)].value;
  const change = level - before;

  const taken = new Map(days.map((day) => [day.date, day.taken === true]));
  let streak = 0;
  const last = taken.get(series[series.length - 1].date) === true;
  for (let index = series.length - 1; index >= 0; index -= 1) {
    if ((taken.get(series[index].date) === true) !== last) break;
    streak += 1;
  }

  return {
    level,
    trend: change > 0.01 ? 'subiendo' : change < -0.01 ? 'bajando' : 'estable',
    streak: last ? streak : -streak,
  };
}

/** Lo que significa ese numero, dicho en una linea. */
export function sayLevel(level: number): string {
  if (level >= 0.9) return 'llena: la creatina ya está haciendo todo lo que puede hacer';
  if (level >= 0.7) return 'casi llena: te falta poco para el efecto completo';
  if (level >= 0.4) return 'a medio llenar: sigue tomándola a diario';
  if (level >= 0.15) return 'baja: a este nivel apenas aporta';
  return 'vacía: como si no la tomaras';
}
