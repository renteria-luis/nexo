import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { todayIso } from '../../core/dates.ts';
import { proteinPerDollar, type DealWithContext } from '../../deals/index.ts';
import type { DealsDiscountRow } from '../../db/types.ts';
import { useAppData } from '../../shell/AppData.tsx';

import { Screen } from './Screen.tsx';

/** Spec 16.3 rule 5: a gap is drawn as a gap, never filled in from somewhere else. */
const MISSING = '—';

function money(cents: number | null): string {
  return cents === null ? MISSING : `$${(cents / 100).toFixed(2)}`;
}

function ago(fetchedAt: number | null): string {
  if (fetchedAt === null) return 'nunca';
  const hours = Math.floor((Date.now() - fetchedAt) / 3_600_000);
  if (hours < 1) return 'hace menos de una hora';
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.floor(hours / 24)} días`;
}

function DealCard({
  item,
  discounts,
  onOpen,
}: {
  item: DealWithContext;
  discounts: DealsDiscountRow[];
  onOpen: (item: DealWithContext) => void;
}) {
  const { deal, source, retailer, food, stale } = item;
  const value = food
    ? proteinPerDollar(deal, food, discounts, retailer?.chain ?? null, todayIso())
    : null;

  return (
    <View style={[styles.card, stale && styles.cardStale]}>
      <View style={styles.cardTop}>
        <Text style={styles.shop}>{retailer?.name ?? MISSING}</Text>
        {/* Spec 16.3 rule 2: the badge is on every card and never buried. */}
        <Text style={styles.badge}>{source.name}</Text>
      </View>

      <Text style={styles.title}>{deal.title}</Text>

      <Text style={styles.price}>
        {money(deal.price_cents)}
        {deal.unit === null ? '' : ` por ${deal.unit}`}
        {deal.original_price_cents === null ? '' : `  antes ${money(deal.original_price_cents)}`}
      </Text>

      {/* Spec 16.6: the number Flipp cannot give him, because Flipp does not know
          his macros. Shown only when every input is real. */}
      <Text style={styles.value}>
        {value === null
          ? `Proteína por dólar: ${MISSING}`
          : `${Math.round(value.proteinPerDollar)} g de proteína por dólar${
              value.discount === null ? '' : `, con ${value.discount.percent}% de descuento`
            }`}
      </Text>

      <View style={styles.marks}>
        {stale && <Text style={styles.stale}>posiblemente vencido</Text>}
        {deal.confidence === 'parsed' && (
          <Text style={styles.parsed}>precio leído del folleto</Text>
        )}
        {deal.valid_to !== null && <Text style={styles.until}>hasta {deal.valid_to}</Text>}
      </View>

      {/* Spec 16.3 rule 3: the button names the app that holds the deal. */}
      <Pressable
        accessibilityLabel={`Abrir ${source.name}`}
        onPress={() => onOpen(item)}
        style={styles.cta}
      >
        <Text style={styles.ctaText}>Abrir en {source.name} ›</Text>
      </Pressable>
    </View>
  );
}

/**
 * Spec 16. Cards are never merged across sources and nothing is hidden: an expired
 * offer is greyed rather than dropped, because a screen that only shows fresh things
 * silently claims everything on it is fresh.
 */
export function DealsScreen() {
  const { state, refreshDeals } = useAppData();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (state.phase !== 'ready') return <Screen title="Ofertas">{null}</Screen>;

  const { deals, discounts, dealSources } = state.loaded;
  const today = todayIso();

  // Best protein per dollar first, then everything else. That ordering is the whole
  // point of the module: Flipp already lists prices.
  const withValue = deals
    .map((item) => ({
      item,
      value: item.food
        ? proteinPerDollar(item.deal, item.food, discounts, item.retailer?.chain ?? null, today)
        : null,
    }))
    .sort((a, b) => {
      if (a.value && b.value) return b.value.proteinPerDollar - a.value.proteinPerDollar;
      if (a.value) return -1;
      if (b.value) return 1;
      return Number(a.item.stale) - Number(b.item.stale);
    });

  const open = (item: DealWithContext) => {
    const url = item.deal.source_url ?? item.source.web_fallback_url;
    if (url === null) {
      // Spec 16.3 rule 4: never fail silently.
      setNote(`${item.source.name} no dejó un enlace para esta oferta.`);
      return;
    }
    Linking.openURL(url).catch(() => {
      setNote(`No se pudo abrir ${item.source.name}. El enlace era ${url}`);
    });
  };

  return (
    <Screen title="Ofertas">
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Actualizar ofertas"
          disabled={busy}
          onPress={() => {
            setBusy(true);
            setNote('Buscando…');
            refreshDeals()
              .then((outcome) => {
                setNote(
                  outcome.kind === 'ok'
                    ? `${outcome.count} ofertas, ${ago(outcome.fetchedAt)}`
                    : `No se pudo actualizar: ${outcome.reason}`,
                );
              })
              .finally(() => setBusy(false));
          }}
          style={styles.refresh}
        >
          <Text style={styles.refreshText}>Actualizar</Text>
        </Pressable>
        {note && <Text style={styles.note}>{note}</Text>}
      </View>

      {/* Spec 16.7: a source that has not answered says so, with its last success. */}
      {dealSources.map((source) => (
        <Text key={source.id} style={source.health === 'ok' ? styles.health : styles.healthBad}>
          {source.name}: {source.health === 'ok' ? 'al día' : 'sin datos'}, última vez{' '}
          {ago(source.last_success_at)}
          {source.last_error === null ? '' : ` · ${source.last_error}`}
        </Text>
      ))}

      {deals.length === 0 && (
        <Text style={styles.empty}>
          Todavía no hay ofertas guardadas. Toca Actualizar para traerlas.
        </Text>
      )}

      {/* Flipp no publica una página por artículo, así que el botón abre Flipp y ahí
          lo buscas. Decirlo es mejor que mandarte a un enlace que no existe. */}
      {deals.length > 0 && (
        <Text style={styles.caveat}>
          Flipp no tiene enlace por artículo: el botón abre Flipp y ahí lo buscas.
        </Text>
      )}

      {withValue.map(({ item }) => (
        <DealCard key={item.deal.id} item={item} discounts={discounts} onOpen={open} />
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  refresh: {
    borderWidth: 1,
    borderColor: '#555',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  refreshText: {
    fontSize: 12,
  },
  note: {
    fontSize: 11,
    color: '#666',
    flexShrink: 1,
  },
  health: {
    fontSize: 11,
    color: '#888',
  },
  healthBad: {
    fontSize: 11,
    color: '#8a1f11',
  },
  empty: {
    fontSize: 12,
    color: '#888',
    marginTop: 12,
  },
  caveat: {
    fontSize: 11,
    color: '#999',
    marginTop: 4,
  },
  card: {
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 8,
    padding: 10,
    gap: 4,
    marginTop: 10,
  },
  cardStale: {
    opacity: 0.55,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  shop: {
    fontSize: 12,
    color: '#444',
  },
  badge: {
    fontSize: 10,
    color: '#39506b',
    borderWidth: 1,
    borderColor: '#cdd9e8',
    backgroundColor: '#f2f6fb',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  title: {
    fontSize: 13,
  },
  price: {
    fontSize: 14,
  },
  value: {
    fontSize: 12,
    color: '#4a6b4a',
  },
  marks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  stale: {
    fontSize: 10,
    color: '#8a6d1f',
  },
  parsed: {
    fontSize: 10,
    color: '#8a6d1f',
  },
  until: {
    fontSize: 10,
    color: '#999',
  },
  cta: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  ctaText: {
    fontSize: 12,
    color: '#555',
  },
});
