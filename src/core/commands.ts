// La consola del nucleo: una linea escrita en vez de cuatro toques.
//
// Solo se entiende lo que esta aqui. Un comando que no se reconoce no escribe nada y
// dice por que, porque lo contrario seria guardar algo distinto de lo que escribio y
// enterarse tres semanas despues, cuando el dato ya esta en la cuadricula.
//
// El parser no toca la base ni sabe de unidades: devuelve que quiso decir, y quien lo
// ejecuta decide si "65" son kilos o libras segun su ajuste.

export type Command =
  | { kind: 'water'; ml: number }
  | { kind: 'weight'; value: number }
  | { kind: 'steps'; steps: number }
  | { kind: 'sleep'; minutes: number }
  | { kind: 'creatine'; taken: boolean }
  | { kind: 'set'; weight: number; reps: number; rpe: number | null }
  | { kind: 'help' };

export type ParsedCommand = { ok: true; command: Command } | { ok: false; reason: string };

export const COMMAND_HELP = [
  'agua 710        suma esos ml al dia',
  'serie 65x8      una serie del ejercicio abierto, rpe8 opcional',
  'peso 74.2       tu peso de hoy en kilos',
  'pasos 8200      los pasos del dia',
  'sueno 7.5h      tambien sueno 130m',
  'creatina        o creatina no',
  'ayuda           esta lista',
];

/** Sin tildes y en minusculas, para que "sueño" y "sueno" sean el mismo comando. */
function plain(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function number(raw: string): number | null {
  const value = Number(raw.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

function bad(reason: string): ParsedCommand {
  return { ok: false, reason };
}

export function parseCommand(input: string): ParsedCommand {
  const parts = plain(input).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return bad('Escribe algo. "ayuda" lista los comandos.');

  const [verb, ...rest] = parts;

  if (verb === 'ayuda' || verb === 'help') return { ok: true, command: { kind: 'help' } };

  if (verb === 'agua') {
    const ml = number(rest[0] ?? '');
    if (ml === null || ml <= 0) return bad('Cuantos ml. Por ejemplo "agua 710".');
    return { ok: true, command: { kind: 'water', ml: Math.round(ml) } };
  }

  if (verb === 'peso') {
    const value = number(rest[0] ?? '');
    if (value === null || value <= 0) return bad('Cuanto pesas hoy. Por ejemplo "peso 74.2".');
    return { ok: true, command: { kind: 'weight', value } };
  }

  if (verb === 'pasos') {
    const steps = number(rest[0] ?? '');
    if (steps === null || steps < 0) return bad('Cuantos pasos. Por ejemplo "pasos 8200".');
    return { ok: true, command: { kind: 'steps', steps: Math.round(steps) } };
  }

  if (verb === 'sueno') {
    const raw = rest[0] ?? '';
    const match = /^([0-9]+(?:[.,][0-9]+)?)(h|m)$/.exec(raw);
    if (!match) return bad('Con h o con m: "sueno 7.5h" o "sueno 130m".');
    const value = number(match[1]);
    if (value === null || value <= 0) return bad('Con h o con m: "sueno 7.5h" o "sueno 130m".');
    const minutes = Math.round(match[2] === 'h' ? value * 60 : value);
    if (minutes <= 0) return bad('Eso no llega ni a un minuto.');
    return { ok: true, command: { kind: 'sleep', minutes } };
  }

  if (verb === 'creatina') {
    const negative = rest[0] === 'no';
    if (rest.length > 0 && !negative) return bad('"creatina" o "creatina no".');
    return { ok: true, command: { kind: 'creatine', taken: !negative } };
  }

  if (verb === 'serie') {
    const match = /^([0-9]+(?:[.,][0-9]+)?)x([0-9]+)$/.exec(rest[0] ?? '');
    if (!match) return bad('Asi: "serie 65x8", peso por repeticiones.');
    const weight = number(match[1]);
    const reps = Number(match[2]);
    if (weight === null || weight < 0) return bad('Asi: "serie 65x8", peso por repeticiones.');
    if (reps <= 0) return bad('Cero repeticiones no es una serie.');

    let rpe: number | null = null;
    if (rest.length > 1) {
      const rpeMatch = /^rpe([0-9]+(?:[.,][0-9]+)?)$/.exec(rest[1]);
      const parsed = rpeMatch ? number(rpeMatch[1]) : null;
      if (parsed === null || parsed < 1 || parsed > 10) {
        return bad('El RPE va de 1 a 10, pegado: "serie 65x8 rpe8".');
      }
      rpe = parsed;
    }

    return { ok: true, command: { kind: 'set', weight, reps, rpe } };
  }

  return bad(`No conozco "${verb}". Escribe "ayuda" para ver la lista.`);
}
