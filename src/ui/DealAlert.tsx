import { ScrollView, Text, View } from 'react-native';

import { liveDeals, unitPrice, type WatchedDeal } from '../deals/index.ts';

import { Button } from './Button.tsx';
import { X } from './icons.ts';
import { IconButton } from './IconButton.tsx';
import { font, hardShadow, sheet, shape } from './theme.ts';

/**
 * Lo que esta en oferta de lo que a el le importa, y nada mas.
 *
 * La pantalla de ofertas eran cuatrocientas tarjetas que habia que recorrer, y por eso
 * abria Flipp directamente. Esto es lo contrario: sus palabras, lo que las encuentra,
 * en que tienda y hasta cuando. Lo demas sigue existiendo detras, a un boton.
 */
export function DealAlert({
  found,
  silent,
  onOpenAll,
  onClose,
}: {
  found: WatchedDeal[];
  /** Lo que se dice de las fuentes que se callaron: va arriba, antes que las ofertas. */
  silent: string[];
  onOpenAll: () => void;
  onClose: () => void;
}) {
  const live = liveDeals(found).length;
  const expired = found.length - live;
  return (
    <View style={styles.sheet}>
      <View style={styles.head}>
        <Text style={styles.title}>
          {live} {live === 1 ? 'oferta tuya' : 'ofertas tuyas'}
          {expired > 0 ? ` y ${expired} ${expired === 1 ? 'vencida' : 'vencidas'}` : ''}
        </Text>
        <IconButton icon={X} accessibilityLabel="Cerrar las ofertas" onPress={onClose} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.list}>
        {silent.map((line) => (
          <Text key={line} style={styles.markWarn}>
            {line}
          </Text>
        ))}
        {found.map(({ item, word }, index) => {
          const price = unitPrice(item.deal);
          return (
            <View
              key={item.deal.id}
              style={[styles.deal, index > 0 && styles.ruled, item.stale && styles.stale]}
            >
              <Text style={styles.word}>{word}</Text>
              {item.stale && <Text style={styles.markWarn}>posiblemente vencido</Text>}
              <Text style={styles.name}>
                {item.deal.title}
                {price === null ? '' : ` · ${price.size}`}
              </Text>
              <Text style={styles.meta}>
                {[
                  item.retailer?.name,
                  item.deal.price_cents === null
                    ? null
                    : `$${(item.deal.price_cents / 100).toFixed(2)}`,
                  price === null ? null : `${`$${(price.cents / 100).toFixed(2)}`} ${price.per}`,
                  item.deal.valid_to === null ? null : `hasta ${item.deal.valid_to}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.foot}>
        <Button
          label="Ver todas"
          accessibilityLabel="Ver todas las ofertas"
          style={styles.grow}
          onPress={onOpenAll}
        />
        <Button
          label="Listo"
          accessibilityLabel="Cerrar las ofertas"
          variant="primary"
          onPress={onClose}
        />
      </View>
    </View>
  );
}

const styles = sheet((theme) => ({
  sheet: {
    alignSelf: 'stretch',
    maxWidth: 400,
    maxHeight: 520,
    backgroundColor: theme.surface,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radius,
    ...hardShadow(theme),
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 14,
  },
  title: {
    flexShrink: 1,
    fontSize: 18,
    fontFamily: font.black,
    color: theme.text,
  },
  scroll: {
    flexShrink: 1,
  },
  list: {
    paddingHorizontal: 14,
    paddingBottom: 8,
    gap: 8,
  },
  deal: {
    gap: 3,
    paddingTop: 2,
  },
  ruled: {
    borderTopWidth: shape.border,
    borderTopColor: theme.line,
    paddingTop: 10,
  },
  stale: {
    opacity: 0.55,
  },
  markWarn: {
    alignSelf: 'flex-start',
    fontSize: 11,
    fontFamily: font.black,
    color: theme.text,
    backgroundColor: theme.warnBg,
    paddingHorizontal: 5,
    borderRadius: 4,
  },
  word: {
    alignSelf: 'flex-start',
    fontSize: 11,
    fontFamily: font.black,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: theme.accentInk,
    backgroundColor: theme.accent,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  name: {
    fontSize: 15,
    fontFamily: font.black,
    color: theme.text,
  },
  meta: {
    fontSize: 12,
    fontFamily: font.regular,
    color: theme.textFaint,
    fontVariant: ['tabular-nums'],
  },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderTopWidth: shape.border,
    borderTopColor: theme.line,
  },
  grow: {
    flex: 1,
  },
}));
