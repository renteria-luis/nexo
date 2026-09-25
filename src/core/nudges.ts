// Que avisos merece un dia, y a que hora.
//
// Anotar no falla por olvido de la regla sino por friccion: el dia que no anota es
// el dia que nadie le recordo en el momento en que todavia podia hacerlo. Pero un
// aviso de algo que ya hizo, o a una hora en la que no puede, es lo que hace que se
// apaguen todos.
//
// De ahi las tres reglas duras: nunca se avisa de algo que ya esta anotado, nunca se
// avisa fuera de su horario despierto, y nunca mas de un punado al dia. Todo lo demas
// es texto.
//
// Esto no habla con iOS ni con la base: recibe como va el dia y devuelve la lista.
// Asi la decision se puede probar entera sin telefono.

import { daysBetween, weekday, type IsoDate } from './dates.ts';
import { CRITERION_WEIGHTS } from './discipline.ts';
import { MEAL_SLOTS } from '../nutrition/units.ts';

export type NudgeKind = 'comida' | 'entreno' | 'agua' | 'manana' | 'cierre' | 'semana';

export type NudgeAction = {
  id: string;
  label: string;
};

export type Nudge = {
  /** Estable por dia y tipo, para no programar dos veces lo mismo. */
  id: string;
  kind: NudgeKind;
  date: IsoDate;
  /** Minuto del dia en que se muestra, hora local. */
  atMinute: number;
  title: string;
  body: string;
  actions: NudgeAction[];
  /** Los puntos de spec 4.1 que estan en juego, que es lo que decide si se manda. */
  weight: number;
};

/** Como va el dia, visto desde lo que se puede anotar. */
export type NudgeDay = {
  date: IsoDate;
  /** Los espacios de comida que ya tienen algo. */
  filledSlots: readonly string[];
  trained: boolean;
  restDay: boolean;
  /** Spec 4.3: sesiones que le faltan en la semana movil. */
  trainingDebt: number;
  waterMl: number | null;
  waterTargetMl: number;
  sleepMinutes: number | null;
  weightKg: number | null;
  criteriaWithData: number;
};

/** Las horas a las que de verdad hace cada cosa, en minutos del dia. */
export type NudgeHours = {
  /** Por espacio de comida. */
  meals: ReadonlyMap<string, number>;
  training: number;
  /** El primer rastro del dia, que es lo mas cerca que estamos de cuando se levanta. */
  wake: number;
};

export type NudgeRules = {
  /** Cuantos como maximo en un dia. */
  maxPerDay: number;
  /** Desde este minuto ya no se avisa nada. */
  quietFrom: number;
  /** Hasta este minuto tampoco. */
  quietTo: number;
  /** Los tipos apagados a mano o callados por ignorados. */
  silenced: readonly NudgeKind[];
};

export const DEFAULT_NUDGE_RULES: NudgeRules = {
  maxPerDay: 3,
  // Spec 1.4: se acuesta tarde pero el aviso util llega antes, no a medianoche.
  quietFrom: 21 * 60 + 30,
  quietTo: 7 * 60 + 30,
  silenced: [],
};

/** Spec 1.4, mientras no haya cinco veces suyas de las que sacar la hora. */
export const DEFAULT_HOURS: NudgeHours = {
  meals: new Map([
    [MEAL_SLOTS[0], 8 * 60],
    [MEAL_SLOTS[1], 10 * 60 + 40],
    [MEAL_SLOTS[2], 11 * 60 + 50],
    [MEAL_SLOTS[3], 14 * 60 + 40],
    [MEAL_SLOTS[4], 19 * 60 + 30],
  ]),
  training: 17 * 60,
  wake: 7 * 60 + 45,
};

export type HourSample = {
  kind: 'comida' | 'entreno';
  /** El espacio de comida, cuando el rastro es una comida. */
  slot?: string;
  date: IsoDate;
  /** Minuto del dia en hora local, ya resuelto por quien leyo la base. */
  minute: number;
};

/** Cuantas veces hay que verlo antes de creerle a una hora suya en vez de al spec. */
export const HOURS_SAMPLE_FLOOR = 5;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/**
 * Las horas suyas, sacadas de lo que ya anoto.
 *
 * La mediana y no el promedio: un dia que anoto el desayuno a las once porque se le
 * paso no tiene que arrastrar el aviso de todos los demas dias. Por debajo de cinco
 * veces manda el horario de spec 1.4, que es lo unico que sabemos de el hasta que
 * haya rastro suficiente.
 */
export function learnHours(
  samples: readonly HourSample[],
  fallback: NudgeHours = DEFAULT_HOURS,
): NudgeHours {
  const byMeal = new Map<string, number[]>();
  const training: number[] = [];
  const earliest = new Map<IsoDate, number>();

  for (const sample of samples) {
    if (sample.kind === 'entreno') training.push(sample.minute);
    if (sample.kind === 'comida' && sample.slot !== undefined) {
      byMeal.set(sample.slot, [...(byMeal.get(sample.slot) ?? []), sample.minute]);
    }
    const first = earliest.get(sample.date);
    if (first === undefined || sample.minute < first) earliest.set(sample.date, sample.minute);
  }

  const meals = new Map(fallback.meals);
  for (const [slot, minutes] of byMeal) {
    if (minutes.length >= HOURS_SAMPLE_FLOOR) meals.set(slot, median(minutes));
  }

  const firsts = [...earliest.values()];

  return {
    meals,
    training: training.length >= HOURS_SAMPLE_FLOOR ? median(training) : fallback.training,
    // El primer rastro del dia es lo mas cerca que estamos de cuando se levanta.
    wake: firsts.length >= HOURS_SAMPLE_FLOOR ? median(firsts) : fallback.wake,
  };
}

/** Lo que se espera despues de su hora antes de dar por hecho que se le paso. */
const MEAL_GRACE_MINUTES = 40;
const WAKE_GRACE_MINUTES = 30;
/** Spec 1.7: su botella, que es lo que se suma desde el propio aviso. */
export const WATER_ACTION_ML = 710;

/** Spec 3.4: a media tarde ya deberia llevar la mitad del agua del dia. */
const WATER_CHECK_MINUTE = 16 * 60 + 30;
const CLOSING_MINUTE = 21 * 60;
/** Spec 6.6: con menos de esto el dia se queda sin nota. */
const CLOSING_CRITERIA = 3;

export type NudgeRecord = {
  kind: NudgeKind;
  date: IsoDate;
  /** Null cuando lo dejo pasar sin tocar nada. */
  actedAt: number | null;
};

/** Ignorado estas veces seguidas, el tipo se calla. */
export const IGNORED_BEFORE_SILENCE = 3;
/** Y vuelve pasada una semana, por si fue una mala racha y no el aviso. */
export const SILENCE_DAYS = 7;

/**
 * Los tipos de aviso que hoy no se mandan porque los viene ignorando.
 *
 * Tres seguidos sin tocar ninguno de sus botones quiere decir que ese aviso no le
 * sirve, y seguir mandandolo es como se pierde la confianza en todos los demas. Se
 * calla una semana y se vuelve a intentar: la alternativa, callarlo para siempre,
 * castiga una semana mala como si fuera una preferencia.
 */
export function silencedKinds(records: readonly NudgeRecord[], today: IsoDate): NudgeKind[] {
  const byKind = new Map<NudgeKind, NudgeRecord[]>();
  for (const record of records) {
    if (record.date >= today) continue;
    byKind.set(record.kind, [...(byKind.get(record.kind) ?? []), record]);
  }

  const silenced: NudgeKind[] = [];
  for (const [kind, rows] of byKind) {
    const recent = [...rows].sort((a, b) => (a.date < b.date ? 1 : -1));
    const streak = recent.slice(0, IGNORED_BEFORE_SILENCE);
    if (streak.length < IGNORED_BEFORE_SILENCE) continue;
    if (streak.some((record) => record.actedAt !== null)) continue;
    if (daysBetween(streak[0].date, today) <= SILENCE_DAYS) silenced.push(kind);
  }
  return silenced;
}

function clockOf(minute: number): string {
  const hour = Math.floor(minute / 60) % 24;
  return `${hour}:${String(Math.round(minute % 60)).padStart(2, '0')}`;
}

/**
 * Los avisos que ese dia todavia tiene sentido mandar, en orden de reloj.
 *
 * Lo que ya esta anotado no genera aviso, asi que la lista se acorta sola conforme
 * va llenando el dia. Si aun asi se juntan mas de los que caben, se quedan los que
 * mas pesan en la nota: perderse el entreno cuesta 22 puntos y el agua 8.
 */
export function nudgesFor(day: NudgeDay, hours: NudgeHours, rules: NudgeRules): Nudge[] {
  const candidates: Nudge[] = [];
  const add = (nudge: Omit<Nudge, 'id' | 'date'>) => {
    candidates.push({ ...nudge, id: `${nudge.kind}-${day.date}`, date: day.date });
  };

  for (const slot of MEAL_SLOTS) {
    if (day.filledSlots.includes(slot)) continue;
    const usual = hours.meals.get(slot);
    if (usual === undefined) continue;
    add({
      kind: 'comida',
      atMinute: usual + MEAL_GRACE_MINUTES,
      title: `Falta ${slot}`,
      body: `Sueles anotarlo cerca de las ${clockOf(usual)}.`,
      actions: [{ id: 'abrir', label: 'Anotar' }],
      // Los puntos de la comida son del dia entero, no de cada espacio: repartidos,
      // una comida suelta no le gana al entreno ni al sueño.
      weight: (CRITERION_WEIGHTS.protein + CRITERION_WEIGHTS.calories) / MEAL_SLOTS.length,
    });
  }

  if (!day.trained && !day.restDay && day.trainingDebt > 0) {
    add({
      kind: 'entreno',
      atMinute: hours.training,
      title: '¿Entrenas hoy?',
      body:
        day.trainingDebt === 1
          ? 'Te falta una sesión para las cinco de la semana.'
          : `Te faltan ${day.trainingDebt} sesiones para las cinco de la semana.`,
      actions: [
        { id: 'entreno', label: 'Hoy entreno' },
        { id: 'descanso', label: 'Descanso' },
      ],
      weight: CRITERION_WEIGHTS.trained,
    });
  }

  if ((day.waterMl ?? 0) < day.waterTargetMl / 2) {
    add({
      kind: 'agua',
      atMinute: WATER_CHECK_MINUTE,
      title: 'Vas corto de agua',
      body: `${((day.waterMl ?? 0) / 1000).toFixed(2)} L de ${(day.waterTargetMl / 1000).toFixed(1)} L.`,
      actions: [{ id: 'agua', label: `+${WATER_ACTION_ML} ml` }],
      weight: CRITERION_WEIGHTS.water,
    });
  }

  if (day.sleepMinutes === null || day.weightKg === null) {
    const missing =
      day.sleepMinutes === null && day.weightKg === null
        ? 'el sueño y el peso'
        : day.sleepMinutes === null
          ? 'el sueño de anoche'
          : 'tu peso';
    add({
      kind: 'manana',
      atMinute: hours.wake + WAKE_GRACE_MINUTES,
      title: 'Empieza el día',
      body: `Falta ${missing}.`,
      actions: [{ id: 'abrir', label: 'Anotar' }],
      weight: day.sleepMinutes === null ? CRITERION_WEIGHTS.sleep : 0,
    });
  }

  if (day.criteriaWithData < CLOSING_CRITERIA) {
    add({
      kind: 'cierre',
      atMinute: CLOSING_MINUTE,
      title: 'El día va a quedar sin nota',
      body: `Llevas ${day.criteriaWithData} de los 8 criterios anotados.`,
      actions: [{ id: 'abrir', label: 'Anotar' }],
      // Lo ultimo del dia manda sobre lo demas: es la unica pasada que queda.
      weight: 100,
    });
  }

  if (weekday(day.date) === 7) {
    add({
      kind: 'semana',
      atMinute: CLOSING_MINUTE,
      title: 'Resumen de la semana',
      body: 'Ya está listo el de esta semana.',
      actions: [{ id: 'abrir', label: 'Ver' }],
      weight: 1,
    });
  }

  const awake = candidates.filter(
    (nudge) =>
      !rules.silenced.includes(nudge.kind) &&
      nudge.atMinute >= rules.quietTo &&
      nudge.atMinute <= rules.quietFrom,
  );

  // Primero se decide cuales entran, por peso, y despues se ordenan por reloj: al
  // reves, un aviso de la mañana se comeria el cupo del cierre del dia.
  return awake
    .slice()
    .sort((a, b) => b.weight - a.weight || a.atMinute - b.atMinute)
    .slice(0, rules.maxPerDay)
    .sort((a, b) => a.atMinute - b.atMinute);
}
