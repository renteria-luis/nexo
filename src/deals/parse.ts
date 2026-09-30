// Lo que el folleto dice en palabras, convertido en numeros con los que se puede
// comparar.
//
// Flipp publica el precio y, si acaso, un "/lb" al lado. El peso casi siempre esta en
// el titulo ("SEASONED CHICKEN BREAST, 4 KG") o en la descripcion del articulo
// ("11.00/kg"), y sin el no hay proteina por dolar que calcular: de 224 ofertas de un
// dia normal, solo dos traian una unidad que el codigo entendia. Esto es lo que
// convierte el modulo en algo util en vez de una lista de precios sueltos.
//
// Todo lo de aqui devuelve null cuando no esta seguro (spec 16.3 regla 5): una cifra
// inventada es peor que ninguna, porque es justo sobre la que decidiria.

const GRAMS_PER_LB = 453.59237;
const GRAMS_PER_OZ = 28.349523;

/**
 * La unidad tal como la escribe la fuente, dejada en una de las que el resto del
 * modulo entiende: 'lb', 'kg', '100g', 'ea'. Null cuando el texto no es una unidad,
 * que en Flipp pasa a menudo porque ese hueco lo usan para decir otra cosa
 * ("scene+ member pricing", "on sale for").
 */
export function normaliseUnit(text: string | null | undefined): string | null {
  if (typeof text !== 'string') return null;
  const clean = text
    .toLowerCase()
    .replace(/[/.\s]/g, '')
    .replace(/^each$/, 'ea');
  if (clean === '') return null;
  if (clean === 'lb' || clean === 'lbs') return 'lb';
  if (clean === 'kg' || clean === 'kgs') return 'kg';
  if (clean === '100g') return '100g';
  if (clean === 'ea' || clean === 'pkg' || clean === 'ct') return 'ea';
  return null;
}

/**
 * Lo que trae un paquete, tal como lo escribe el folleto: gramos, mililitros o
 * unidades. Es lo que Flipp deja fuera del nombre y mete en la letra chica, que es
 * donde estaban "18'S" de los huevos y "4 L" de la leche.
 */
export type Pack = { grams: number } | { millilitres: number } | { count: number } | null;

export function packFromText(text: string | null | undefined): Pack {
  if (typeof text !== 'string' || text.trim() === '') return null;
  const grams = gramsFromText(text);
  if (grams !== null) return { grams };

  const lower = text.toLowerCase();

  // "4 L", "750 ml", "2x1.89l"
  const volumePack = lower.match(/(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(l|ml)\b/);
  if (volumePack) {
    const each = millilitres(Number(volumePack[2].replace(',', '.')), volumePack[3]);
    if (each !== null) return { millilitres: Math.round(each * Number(volumePack[1])) };
  }
  const volume = lower.match(/(\d+(?:[.,]\d+)?)\s*(l|ml)\b/);
  if (volume) {
    const amount = millilitres(Number(volume[1].replace(',', '.')), volume[2]);
    if (amount !== null) return { millilitres: amount };
  }

  // "18'S", "18 PK", "12 un.", "6 ct", "pack of 12"
  const count =
    lower.match(/(\d+)\s*(?:'s|s\b|pk\b|pack\b|ct\b|un\.?|unidades?\b|count\b)/) ??
    lower.match(/pack of\s*(\d+)/);
  if (count) {
    const amount = Number(count[1]);
    if (Number.isInteger(amount) && amount > 0 && amount <= 500) return { count: amount };
  }

  return null;
}

function millilitres(amount: number, unit: string): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return unit === 'l' ? Math.round(amount * 1000) : Math.round(amount);
}

/** Lo que pesa una oferta, en gramos, si el texto lo dice. */
export function gramsFromText(text: string | null | undefined): number | null {
  if (typeof text !== 'string' || text.trim() === '') return null;
  const lower = text.toLowerCase();

  // "12 x 355 g": lo que importa es el total, no el envase.
  const pack = lower.match(/(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|lb|oz)\b/);
  if (pack) {
    const each = size(Number(pack[2].replace(',', '.')), pack[3]);
    return each === null ? null : Math.round(each * Number(pack[1]));
  }

  const single = lower.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|lb|lbs|oz)\b/);
  if (single) return size(Number(single[1].replace(',', '.')), single[2]);

  return null;
}

function size(amount: number, unit: string): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (unit === 'kg') return Math.round(amount * 1000);
  if (unit === 'g') return Math.round(amount);
  if (unit === 'lb' || unit === 'lbs') return Math.round(amount * GRAMS_PER_LB);
  if (unit === 'oz') return Math.round(amount * GRAMS_PER_OZ);
  return null;
}

/**
 * El precio por kilo que el folleto escribe en letra chica, en centavos.
 *
 * Es el dato mas honesto que da Flipp: "11.00/kg" debajo de un "$4.99 /lb" es el
 * mismo precio dicho en metrico, y compararlo no necesita adivinar nada.
 */
export function centsPerKgFromText(text: string | null | undefined): number | null {
  if (typeof text !== 'string') return null;
  const match = text.toLowerCase().match(/\$?\s*(\d+(?:[.,]\d+)?)\s*\/\s*(kg|lb)\b/);
  if (!match) return null;
  const amount = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const perKg = match[2] === 'kg' ? amount : amount / (GRAMS_PER_LB / 1000);
  return Math.round(perKg * 100);
}

/**
 * Lo que pesa una oferta juntando lo que se sepa: el titulo, la descripcion y, si el
 * precio ya venia por kilo o por libra, la unidad misma.
 */
export function dealPack(
  title: string,
  description: string | null | undefined,
  unit: string | null,
): Pack {
  const normalised = normaliseUnit(unit);
  // Un precio por libra o por kilo ya dice cuanto compra sin mirar nada mas.
  if (normalised === 'lb') return { grams: Math.round(GRAMS_PER_LB) };
  if (normalised === 'kg') return { grams: 1000 };
  if (normalised === '100g') return { grams: 100 };
  // Y si no, el tamano esta escrito: casi siempre en la letra chica, no en el nombre.
  return packFromText(description) ?? packFromText(title);
}
