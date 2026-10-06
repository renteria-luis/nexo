import type { SQLiteDatabase } from 'expo-sqlite';

import { listDailyLogs, listScoreHistory } from '../core/daily-log.ts';
import { scoreText } from '../core/day-report.ts';
import { daysBetween, shortDate, type DateRange, type IsoDate } from '../core/dates.ts';
import { currentStreak } from '../core/discipline.ts';
import { resolveQuestionDates, type ReadRequest } from '../core/questions.ts';
import { targetsInForceOn } from '../core/snapshots.ts';
import { withUnit, type WeightUnit } from '../core/units.ts';
import type { CoreDailyLogRow, TrainingExerciseRow } from '../db/types.ts';
import { fold } from '../nutrition/picker.ts';
import { listPortionsBetween } from '../nutrition/queries.ts';
import { dailyTotals } from '../nutrition/totals.ts';
import { listPantry } from '../pantry/queries.ts';
import { epleyE1rm } from '../training/calculations.ts';
import { GYM_EQUIPMENT_KIND, isPerSide } from '../training/queries.ts';

const EQUIPMENT_NAMES: Record<string, string> = {
  dumbbell: 'mancuernas',
  barbell: 'barra',
  ez_bar: 'barra Z',
  machine: 'máquina',
  cable: 'polea',
  bodyweight: 'peso corporal',
};
const EQUIPMENT_WORDS: Record<string, string> = {
  mancuerna: 'dumbbell',
  mancuernas: 'dumbbell',
  dumbbell: 'dumbbell',
  dumbbells: 'dumbbell',
  barra: 'barbell',
  barbell: 'barbell',
  maquina: 'machine',
  machine: 'machine',
  polea: 'cable',
  cable: 'cable',
};

function exerciseWords(text: string): string[] {
  return fold(text)
    .replace(/\bpres\b/g, 'press')
    .replace(/\bbench\b/g, 'banca')
    .replace(/\bincline\b/g, 'inclinado')
    .replace(/\bflat\b/g, 'plano')
    .replace(/\bdumbbells?\b/g, 'mancuernas')
    .replace(/\bbarbell\b/g, 'barra')
    .replace(/\bchest\b/g, 'pecho')
    .split(/[\s-]+/)
    .filter(
      (word) =>
        word !== '' && !['de', 'del', 'en', 'con', 'el', 'la', 'mi', 'los', 'las'].includes(word),
    );
}

function exerciseMatches(exercise: TrainingExerciseRow, wanted: string[]): boolean {
  const names = exerciseWords(`${exercise.name_es} ${exercise.name_en}`);
  const bench =
    exercise.primary_muscle === 'chest' &&
    names.includes('press') &&
    (names.some((word) => ['banca', 'banco', 'inclinado', 'plano'].includes(word)) ||
      exercise.equipment_type === 'barbell');
  return wanted.every(
    (word) =>
      EQUIPMENT_WORDS[word] !== undefined ||
      ((word === 'banca' || word === 'banco') && bench) ||
      names.some((name) => name.startsWith(word) || word.startsWith(name)),
  );
}

type RecordSet = {
  exercise_id: string;
  session_id: string;
  date: IsoDate;
  weight_kg: number;
  reps: number;
  set_index: number;
  equipment_type: string;
  equipment_kind: string | null;
  gym_name: string | null;
  gym_id: string | null;
};

async function marks(
  db: SQLiteDatabase,
  request: ReadRequest,
  today: IsoDate,
  unit: WeightUnit,
  range: DateRange,
): Promise<string> {
  if (request.exercise === null || request.exercise.trim() === '')
    return '¿De qué ejercicio quieres ver el récord?';
  const words = exerciseWords(request.exercise);
  const exercises = (
    await db.getAllAsync<TrainingExerciseRow>('SELECT * FROM training_exercise ORDER BY name_es;')
  ).filter((exercise) => exerciseMatches(exercise, words));
  if (exercises.length === 0)
    return `No encuentro un ejercicio que coincida con «${request.exercise}».`;
  const ids = exercises.map((exercise) => exercise.id);
  const sets = await db.getAllAsync<RecordSet>(
    `SELECT s.exercise_id, s.session_id, e.date, s.weight_kg, s.reps, s.set_index,
            coalesce(s.implement, x.equipment_type) AS equipment_type,
            ${GYM_EQUIPMENT_KIND} AS equipment_kind, e.gym_id, g.name AS gym_name
       FROM training_set_entry s
       JOIN training_session e ON e.id = s.session_id
       JOIN training_exercise x ON x.id = s.exercise_id
       LEFT JOIN training_gym g ON g.id = e.gym_id
      WHERE s.is_warmup = 0 AND e.date BETWEEN ? AND ?
        AND s.exercise_id IN (${ids.map(() => '?').join(',')})
      ORDER BY e.date, s.session_id, s.set_index;`,
    [
      request.date === null ? '0001-01-01' : range.from,
      request.date === null ? today : range.to,
      ...ids,
    ],
  );
  const wantedEquipment = words.map((word) => EQUIPMENT_WORDS[word]).filter(Boolean);
  const groups = new Map<string, RecordSet[]>();
  for (const set of sets) {
    if (wantedEquipment.length > 0 && !wantedEquipment.includes(set.equipment_type)) continue;
    const machine = set.equipment_type === 'machine' || set.equipment_type === 'cable';
    const key = JSON.stringify([
      set.exercise_id,
      set.equipment_type,
      set.equipment_kind,
      machine ? set.gym_id : null,
    ]);
    groups.set(key, [...(groups.get(key) ?? []), set]);
  }
  const nameOf = new Map(exercises.map((exercise) => [exercise.id, exercise.name_es]));
  const answers: string[] = [];
  for (const entries of groups.values()) {
    let best: RecordSet | null = null;
    let maximum = -1;
    for (const set of entries) {
      const value =
        request.question === 'e1rm' ? epleyE1rm(set.weight_kg, set.reps) : set.weight_kg;
      if (
        value !== null &&
        (value > maximum || (value === maximum && (best === null || set.date > best.date)))
      ) {
        best = set;
        maximum = value;
      }
    }
    if (best === null) continue;
    const name = nameOf.get(best.exercise_id) ?? best.exercise_id;
    const side = isPerSide(best.equipment_type, best.equipment_kind)
      ? ' por lado'
      : best.equipment_type === 'bodyweight'
        ? ' de lastre'
        : '';
    const equipment = EQUIPMENT_NAMES[best.equipment_type] ?? best.equipment_type;
    const venue =
      best.gym_name !== null && ['machine', 'cable'].includes(best.equipment_type)
        ? `, ${best.gym_name}`
        : '';
    const repeated = entries.filter(
      (set) => set.session_id === best.session_id && set.weight_kg === best.weight_kg,
    );
    const reps = repeated.map((set) => set.reps).join('–');
    const label = request.question === 'e1rm' ? '1RM estimado' : 'Mayor peso registrado';
    answers.push(
      `${name} (${equipment}${venue}): ${label.toLowerCase()} de ${withUnit(maximum, unit)}${side}. Última vez: ${shortDate(best.date)}. ${repeated.length} ${repeated.length === 1 ? 'serie' : 'series'} de ${reps} repeticiones${request.question === 'e1rm' ? ` con ${withUnit(best.weight_kg, unit)}${side}; es una estimación, no un peso levantado` : ''}.`,
    );
  }
  const scope =
    request.date === null
      ? 'en todo tu historial'
      : `entre ${shortDate(range.from)} y ${shortDate(range.to)}`;
  if (answers.length === 0)
    return request.question === 'e1rm' && sets.length > 0
      ? 'No hay series de 12 repeticiones o menos para estimar el 1RM en ese período.'
      : `No hay series de trabajo registradas para «${request.exercise}» ${scope}.`;
  return `${answers.join('\n')}\nConsulta ${scope}.`;
}

function rangeLabel(range: DateRange): string {
  return range.from === range.to
    ? shortDate(range.from)
    : `${shortDate(range.from)} al ${shortDate(range.to)}`;
}

async function nutrition(
  db: SQLiteDatabase,
  request: ReadRequest,
  range: DateRange,
): Promise<string> {
  const byDate = await listPortionsBetween(db, range);
  const portions = [...byDate.values()].flat();
  const label = rangeLabel(range);
  if (portions.length === 0)
    return `No hay comida registrada para ${label}. Eso no significa que hayas consumido cero.`;
  const totals = dailyTotals(portions);
  const unknownProtein = totals.missing.filter((item) => item.nutrient === 'protein_g');
  const protein =
    unknownProtein.length > 0
      ? `al menos ${Math.round(totals.proteinG)} g de proteína; falta la proteína de ${unknownProtein.map((item) => item.foodName).join(', ')}`
      : `${Math.round(totals.proteinG)} g de proteína`;
  let answer = `${label}: ${protein}.`;
  if (request.question === 'nutricion') {
    const gap = totals.missing.some((item) => ['kcal', 'fat_g', 'carbs_g'].includes(item.nutrient));
    answer += ` ${Math.round(totals.kcal)} kcal, ${Math.round(totals.carbsG)} g de carbohidratos y ${Math.round(totals.fatG)} g de grasa${gap ? ' (totales incompletos: faltan datos nutricionales)' : ''}.`;
    answer += ` Comidas registradas: ${[...new Set(portions.map((portion) => portion.food.name))].join(', ')}.`;
  }
  if (range.from === range.to) {
    const targets = await targetsInForceOn(db, range.from);
    if (targets !== null)
      answer += ` Meta de ese día: ${Math.round(targets.proteinG)} g de proteína${unknownProtein.length === 0 ? `; ${Math.max(0, Math.round(targets.proteinG - totals.proteinG))} g por completar` : ''}.`;
  } else {
    const missing = daysBetween(range.from, range.to) + 1 - byDate.size;
    answer += ` ${byDate.size} ${byDate.size === 1 ? 'día con comida registrada' : 'días con comida registrada'}${missing > 0 ? `; ${missing} días sin registros, no contados como consumo cero` : ''}.`;
  }
  return answer;
}

const DAILY_COLUMNS = {
  agua: 'water_ml',
  peso: 'weight_kg',
  pasos: 'steps',
  sueno: 'sleep_minutes',
  creatina: 'creatine_taken',
  nota: 'score',
} as const;
function dailyValue(question: keyof typeof DAILY_COLUMNS, row: CoreDailyLogRow): string {
  const value = row[DAILY_COLUMNS[question]];
  if (value === null) return 'sin registrar';
  if (question === 'agua') return `${value} ml de agua`;
  if (question === 'peso') return `${value} kg de peso corporal`;
  if (question === 'pasos') return `${value} pasos`;
  if (question === 'sueno') return `${Math.floor(value / 60)} h ${value % 60} min de sueño`;
  if (question === 'creatina') return value === 1 ? 'creatina tomada' : 'creatina no tomada';
  return `nota ${scoreText(value)} de 100`;
}

export async function answerLocalQuestion(
  db: SQLiteDatabase,
  request: ReadRequest,
  today: IsoDate,
  unit: WeightUnit,
): Promise<string> {
  const range = resolveQuestionDates(request.date, today);
  if (range === null)
    return `No sé qué fecha es «${request.date}». Dime un día o un rango concreto.`;
  if (request.question === 'marca' || request.question === 'e1rm')
    return marks(db, request, today, unit, range);
  if (request.question === 'proteina' || request.question === 'nutricion')
    return nutrition(db, request, range);
  if (request.question === 'racha') {
    if (range.from !== range.to) return 'Para ver una racha, dime el día al que te refieres.';
    const count = currentStreak(await listScoreHistory(db, range.to), range.to);
    return `${shortDate(range.to)}: ${count} ${count === 1 ? 'día' : 'días'} de racha.`;
  }
  if (request.question === 'entreno') {
    const dates = await db.getAllAsync<{ date: IsoDate }>(
      `SELECT DISTINCT e.date FROM training_session e
       WHERE e.date BETWEEN ? AND ? AND EXISTS (SELECT 1 FROM training_set_entry s WHERE s.session_id = e.id AND s.is_warmup = 0)
       ORDER BY e.date DESC;`,
      [request.date === null ? '0001-01-01' : range.from, range.to],
    );
    if (dates.length === 0)
      return `No hay entrenamientos registrados ${request.date === null ? 'en tu historial' : `para ${rangeLabel(range)}`}.`;
    return request.date === null
      ? `Tu último entrenamiento registrado fue el ${shortDate(dates[0].date)}.`
      : `Entrenaste: ${dates.map((item) => shortDate(item.date)).join('; ')}.`;
  }
  if (request.question === 'despensa') {
    if (request.date !== null && (range.from !== today || range.to !== today))
      return 'La despensa guarda el estado actual; no tengo su inventario de ese día.';
    const pantry = await listPantry(db);
    if (pantry.length === 0) return 'No hay productos registrados en la despensa.';
    return `Tu despensa registrada:\n${pantry.map((item) => `${item.name}: ${item.kind === 'counted' || item.kind === 'weighed' ? `${item.quantity ?? 0} ${item.unit ?? 'unidades'}` : item.kind === 'durable' ? (item.state ?? 'sin registrar') : item.hasIt === null ? 'sin registrar' : item.hasIt ? 'hay' : 'no hay'}`).join('\n')}`;
  }
  if (request.question === 'receta')
    return 'Dime qué te gustaría cocinar para buscar una receta y compararla con tu despensa.';
  const rows = await listDailyLogs(db, range);
  const question = request.question;
  const recorded = rows.filter((row) => row[DAILY_COLUMNS[question]] !== null);
  if (recorded.length === 0)
    return `No hay ${question === 'nota' ? 'nota' : 'datos de ' + question} registrados para ${rangeLabel(range)}.`;
  return recorded.map((row) => `${shortDate(row.date)}: ${dailyValue(question, row)}.`).join('\n');
}
