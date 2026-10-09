import { useState } from 'react';
import { LayoutAnimation, Pressable, Text, View } from 'react-native';

import { todayIso } from '../../core/dates.ts';
import {
  comparedToUsual,
  dealCentsPerKg,
  proteinPerDollar,
  unitPrice,
  type DealWithContext,
} from '../../deals/index.ts';
import type { DealsDiscountRow } from '../../db/types.ts';
import { useAppData } from '../../shell/AppData.tsx';
import { ago, sourceStatus } from '../../shell/deals.ts';

import { Button } from '../Button.tsx';
import { Card } from '../Card.tsx';
import { Chip } from '../Chip.tsx';
import { ChevronDown, ChevronUp, RotateCcw } from '../icons.ts';
import { font, sheet, shape, theme } from '../theme.ts';

import { useNow } from '../useNow.ts';

import { Screen } from './Screen.tsx';

/** Spec 16.3 rule 5: a gap is drawn as a gap, never filled in from somewhere else. */
const MISSING = '—';

/** Como se reparte la lista. Por producto es lo que se pregunta al hacer la compra. */
const GROUPS = [
  { id: 'product', label: 'Por producto' },
  { id: 'store', label: 'Por tienda' },
  { id: 'value', label: 'Mejor valor' },
] as const;
type Group = (typeof GROUPS)[number]['id'];

/** Los nombres de las busquedas, en lo que el diria. */
const TERM_ES: Record<string, string> = {
  'chicken breast': 'Pechuga de pollo',
  'chicken thighs': 'Muslo de pollo',
  'ground beef': 'Carne molida',
  eggs: 'Huevos',
  'greek yogurt': 'Yogur griego',
  'cottage cheese': 'Queso cottage',
  'canned tuna': 'Atún',
  salmon: 'Salmón',
  'pork loin': 'Lomo de cerdo',
  'ground turkey': 'Pavo molido',
  'protein powder': 'Proteína en polvo',
  milk: 'Leche',
  cheese: 'Queso',
  oats: 'Avena',
  rice: 'Arroz',
  pasta: 'Pasta',
  lentils: 'Lentejas',
  'peanut butter': 'Mantequilla de maní',
};

function money(cents: number | null): string {
  return cents === null ? MISSING : `$${(cents / 100).toFixed(2)}`;
}

/**
 * Una oferta. Lo que la hace valer la pena sobre abrir Flipp es la segunda linea: el
 * precio por kilo y, cuando la comida esta en su catalogo, la proteina por dolar.
 *
 * Ya no lleva boton de abrir (2026-09-30). El enlace de `/action` es universal y Flipp
 * lo declara, pero quien decide si va a la app o a Safari es iOS, y una vez que ha ido a
 * Safari se queda yendo; no hay forma de forzarlo desde aqui. Un boton que promete abrir
 * una app y abre el navegador miente, asi que en su lugar queda la insignia que dice de
 * que app es la oferta, que ademas es lo que va a hacer falta cuando entre Flashfood.
 */
function DealRow({
  item,
  discounts,
  showStore,
}: {
  item: DealWithContext;
  discounts: DealsDiscountRow[];
  showStore: boolean;
}) {
  const { deal, source, retailer, food, stale } = item;
  const chain = retailer?.chain ?? null;
  const value = food ? proteinPerDollar(deal, food, discounts, chain, todayIso()) : null;
  const versusUsual = food ? comparedToUsual(deal, food, discounts, chain, todayIso()) : null;
  const price = unitPrice(deal);
  const cheaper = versusUsual !== null && versusUsual.savingPercent > 0;

  return (
    <View style={[styles.deal, stale && styles.stale]}>
      <View style={styles.dealHead}>
        {/* El nombre que publica Flipp se queda corto: el tamano vive en la letra
            chica, y sin el "18'S" unos huevos son un precio sin nada detras. */}
        <Text style={styles.title} numberOfLines={2}>
          {deal.title}
          {price === null ? '' : ` · ${price.size}`}
        </Text>
        <Text style={styles.price}>{money(deal.price_cents)}</Text>
      </View>

      <Text style={styles.meta}>
        {[
          showStore ? (retailer?.name ?? MISSING) : null,
          deal.description === null ? null : deal.description.replace(/\s*\n\s*/g, ' · '),
          deal.original_price_cents === null ? null : `antes ${money(deal.original_price_cents)}`,
          deal.valid_to === null ? null : `hasta ${deal.valid_to}`,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>

      {/* Spec 16.6: los dos numeros que Flipp no puede dar, porque no conoce ni sus
          macros ni lo que el ya paga. Solo salen cuando todo lo que entra es real. */}
      <View style={styles.numbers}>
        <Text style={price === null ? styles.numberOff : styles.number}>
          {price === null ? `${MISSING} por medida` : `${money(price.cents)} ${price.per}`}
        </Text>
        <Text style={value === null ? styles.numberOff : styles.numberGood}>
          {value === null
            ? `${MISSING} g proteína/$`
            : `${Math.round(value.proteinPerDollar)} g proteína/$`}
        </Text>
        {cheaper && versusUsual !== null && (
          <Text style={styles.numberGood}>
            {Math.round(versusUsual.savingPercent)}% bajo lo tuyo
          </Text>
        )}
      </View>

      <View style={styles.marks}>
        {deal.staple === 1 && <Text style={styles.mark}>de tu lista</Text>}
        {stale && <Text style={styles.markWarn}>posiblemente vencido</Text>}
        {/* Spec 16.3 rule 2: la insignia de la fuente va en cada oferta. */}
        <Text style={styles.mark}>{source.name}</Text>
      </View>
    </View>
  );
}

/** Una fuente y su estado; callada, en el estilo de aviso y no en gris. */
function SourceLine({ status }: { status: { line: string; silent: boolean } }) {
  return <Text style={status.silent ? styles.healthWarn : styles.health}>{status.line}</Text>;
}

/**
 * Spec 16. Cards are never merged across sources and nothing is hidden: an expired
 * offer is greyed rather than dropped, because a screen that only shows fresh things
 * silently claims everything on it is fresh.
 */
export function DealsScreen() {
  const { state, refreshDeals } = useAppData();
  const now = useNow();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [group, setGroup] = useState<Group>('product');
  // Los grupos abiertos. Cerrados de entrada: con veinte productos, la lista entera
  // desplegada obliga a deslizar media pantalla para llegar al siguiente.
  const [open_, setOpen] = useState<string[]>([]);

  const fold = (name: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((before) =>
      before.includes(name) ? before.filter((one) => one !== name) : [...before, name],
    );
  };

  if (state.phase !== 'ready') return <Screen title="Ofertas">{null}</Screen>;

  const { deals, discounts, dealSources } = state.loaded;
  const today = todayIso();

  // El valor de cada oferta, una sola vez: lo usan el orden y las tarjetas.
  const scored = deals.map((item) => {
    const chain = item.retailer?.chain ?? null;
    const versusUsual = item.food
      ? comparedToUsual(item.deal, item.food, discounts, chain, today)
      : null;
    return {
      item,
      value: item.food ? proteinPerDollar(item.deal, item.food, discounts, chain, today) : null,
      perKg: dealCentsPerKg(item.deal),
      cheaper: versusUsual !== null && versusUsual.savingPercent > 0,
    };
  });

  /** Lo mejor primero: de tu lista, lo que baja de tu precio, y mas proteina por dolar. */
  const best = <T extends (typeof scored)[number]>(rows: T[]): T[] =>
    [...rows].sort((a, b) => {
      if (a.item.deal.staple !== b.item.deal.staple) {
        return b.item.deal.staple - a.item.deal.staple;
      }
      if (a.cheaper !== b.cheaper) return Number(b.cheaper) - Number(a.cheaper);
      if (a.value && b.value) return b.value.proteinPerDollar - a.value.proteinPerDollar;
      if (a.value) return -1;
      if (b.value) return 1;
      // Sin proteina que comparar, el kilo mas barato, y lo vencido al final.
      if (a.perKg !== null && b.perKg !== null) return a.perKg - b.perKg;
      return Number(a.item.stale) - Number(b.item.stale);
    });

  // Agrupar es lo que convierte 418 ofertas en una compra: o todas las de una tienda,
  // o todos los precios de lo mismo para poder elegir.
  const buckets = new Map<string, typeof scored>();
  if (group !== 'value') {
    for (const row of scored) {
      const key =
        group === 'store'
          ? (row.item.retailer?.name ?? 'Sin tienda')
          : (() => {
              const term = row.item.deal.category;
              return term === null ? 'Otros' : (TERM_ES[term] ?? term);
            })();
      buckets.set(key, [...(buckets.get(key) ?? []), row]);
    }
  }

  const groups =
    group === 'value'
      ? [{ name: null, rows: best(scored) }]
      : [...buckets.entries()]
          .map(([name, rows]) => ({ name, rows: best(rows) }))
          .sort((a, b) => {
            // Donde hay algo de tu lista, primero; despues, donde hay mas.
            const staple = (rows: typeof scored) =>
              rows.some((row) => row.item.deal.staple === 1) ? 1 : 0;
            const difference = staple(b.rows) - staple(a.rows);
            return difference !== 0 ? difference : b.rows.length - a.rows.length;
          });

  return (
    <Screen title="Ofertas" refreshable>
      <View style={styles.chips}>
        {GROUPS.map((option) => (
          <Chip
            key={option.id}
            label={option.label}
            accessibilityLabel={`Agrupar ${option.label.toLowerCase()}`}
            selected={option.id === group}
            onPress={() => {
              setGroup(option.id);
              // Los grupos de antes no son los de ahora.
              setOpen([]);
            }}
          />
        ))}
      </View>

      <Button
        label="Actualizar"
        accessibilityLabel="Actualizar ofertas"
        icon={RotateCcw}
        loading={busy}
        disabled={busy}
        block
        onPress={() => {
          setBusy(true);
          setNote('Buscando…');
          refreshDeals()
            .then((outcome) => {
              setNote(
                outcome.kind === 'ok'
                  ? `${outcome.count} ofertas, ${ago(outcome.fetchedAt, Date.now())}`
                  : outcome.reason,
              );
            })
            .finally(() => setBusy(false));
        }}
      />

      {/* Spec 16.7: a source that has not answered says so, with its last success. */}
      <Card>
        {note && <Text style={styles.note}>{note}</Text>}
        {dealSources.map((source) => (
          <SourceLine key={source.id} status={sourceStatus(source, now)} />
        ))}
      </Card>

      {deals.length === 0 && (
        <Card>
          <Text style={styles.empty}>
            Todavía no hay ofertas guardadas. Toca Actualizar para traerlas.
          </Text>
        </Card>
      )}

      {groups.map(({ name, rows }) => {
        const shown = name === null || open_.includes(name);
        return (
          <Card key={name ?? 'todas'}>
            {name !== null && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${name}, ${rows.length} ofertas`}
                onPress={() => fold(name)}
                style={({ pressed }) => [styles.group, pressed && styles.groupPressed]}
              >
                <View style={styles.groupText}>
                  <Text style={styles.groupTitle}>{name}</Text>
                  <Text style={styles.count}>
                    {rows.length} {rows.length === 1 ? 'oferta' : 'ofertas'}
                  </Text>
                </View>
                {shown ? (
                  <ChevronUp size={18} color={theme.text} strokeWidth={2.5} />
                ) : (
                  <ChevronDown size={18} color={theme.text} strokeWidth={2.5} />
                )}
              </Pressable>
            )}
            {shown &&
              rows.map(({ item }) => (
                <DealRow
                  key={item.deal.id}
                  item={item}
                  discounts={discounts}
                  showStore={group !== 'store'}
                />
              ))}
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = sheet((theme) => ({
  group: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 2,
  },
  groupPressed: {
    opacity: 0.7,
  },
  groupText: {
    flex: 1,
  },
  groupTitle: {
    fontSize: 15,
    fontFamily: font.black,
    color: theme.text,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  note: {
    fontSize: 13,
    fontFamily: font.bold,
    color: theme.text,
  },
  health: {
    fontSize: 12,
    fontFamily: font.regular,
    color: theme.textFaint,
  },
  healthWarn: {
    alignSelf: 'flex-start',
    fontSize: 12,
    fontFamily: font.black,
    color: theme.text,
    backgroundColor: theme.warnBg,
    paddingHorizontal: 5,
    borderRadius: 4,
  },
  empty: {
    fontSize: 13,
    fontFamily: font.regular,
    color: theme.textFaint,
  },
  count: {
    fontSize: 12,
    fontFamily: font.black,
    letterSpacing: 0.6,
    color: theme.textFaint,
    textTransform: 'uppercase',
  },
  deal: {
    gap: 6,
    borderTopWidth: shape.border,
    borderTopColor: theme.line,
    paddingTop: 10,
  },
  stale: {
    opacity: 0.55,
  },
  dealHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontFamily: font.black,
    color: theme.text,
  },
  price: {
    fontSize: 20,
    fontFamily: font.black,
    color: theme.text,
    fontVariant: ['tabular-nums'],
  },
  meta: {
    fontSize: 12,
    fontFamily: font.regular,
    color: theme.textFaint,
    fontVariant: ['tabular-nums'],
  },
  numbers: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  number: {
    fontSize: 12,
    fontFamily: font.black,
    color: theme.accentInk,
    backgroundColor: theme.surfaceHigh,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
    fontVariant: ['tabular-nums'],
  },
  numberGood: {
    fontSize: 12,
    fontFamily: font.black,
    color: theme.accentInk,
    backgroundColor: theme.ok,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
    fontVariant: ['tabular-nums'],
  },
  numberOff: {
    fontSize: 12,
    fontFamily: font.bold,
    color: theme.textGhost,
    paddingVertical: 2,
  },
  marks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  mark: {
    fontSize: 11,
    fontFamily: font.bold,
    color: theme.textFaint,
  },
  markWarn: {
    fontSize: 11,
    fontFamily: font.black,
    color: theme.text,
    backgroundColor: theme.warnBg,
    paddingHorizontal: 5,
    borderRadius: 4,
    overflow: 'hidden',
  },
}));
