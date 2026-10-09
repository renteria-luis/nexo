import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { liveDeals, newestFetch, watchedDeals, watchWords } from '../../deals/index.ts';
import { useAppData } from '../../shell/AppData.tsx';
import { sourceStatus } from '../../shell/deals.ts';
import { WEEKS_SHOWN } from '../../shell/load.ts';
import { parseWaterTaps } from '../../core/water-taps.ts';
import { scoreText } from '../../core/day-report.ts';
import { currentStreak, longestStreak } from '../../core/discipline.ts';
import { scoreScaleFrom } from '../../core/palettes.ts';
import type { TargetChange } from '../../core/snapshots.ts';
import { proteinBand } from '../../core/targets.ts';
import { settingDefault } from '../../core/settings.ts';
import { fromKg } from '../../core/units.ts';

import { Button } from '../Button.tsx';
import { Card, type CardTone } from '../Card.tsx';
import { DealAlert } from '../DealAlert.tsx';
import { DayDialog } from '../DayDialog.tsx';
import { DisciplineGrid } from '../DisciplineGrid.tsx';
import { useInfo } from '../InfoBubble.tsx';
import { useNow } from '../useNow.ts';
import { ChevronRight, Dumbbell, Tag, Utensils, Wallet, type LucideIcon } from '../icons.ts';
import { Star } from '../Star.tsx';
import { TodayLog } from '../TodayLog.tsx';
import { font, sheet, shape, theme } from '../theme.ts';

import { Screen } from './Screen.tsx';

/**
 * Un modulo de la app en una cartilla de color.
 *
 * Media pantalla cada uno y en dos filas: al pulgar le sirve el area, y el color dice
 * cual es antes de leer la palabra. El que todavia no existe se queda plano y sin
 * relieve, que es como se ve aqui algo que no se puede tocar.
 */
function ModuleCard({
  label,
  value,
  detail,
  icon: Icon,
  tone,
  onOpen,
}: {
  label: string;
  value: string;
  detail?: string;
  icon: LucideIcon;
  tone: CardTone;
  onOpen?: () => void;
}) {
  return (
    <Card
      tone={tone}
      raised={onOpen !== undefined}
      accessibilityLabel={onOpen ? `Abrir ${label}` : undefined}
      onPress={onOpen}
      style={styles.module}
    >
      <View style={styles.moduleHead}>
        <View style={styles.moduleIcon}>
          <Icon size={17} color={theme.accentInk} strokeWidth={2.5} />
        </View>
        <Text style={styles.moduleLabel}>{label}</Text>
      </View>
      <Text style={styles.moduleValue}>{value}</Text>
      {detail ? <Text style={styles.moduleDetail}>{detail}</Text> : null}
    </Card>
  );
}

function round1(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * Spec 3.6: recalculation is visible, never silent. One line on Today, tap for the
 * before and after, and it stays until he says he has seen it.
 */
function TargetChangeCard({ change, onDismiss }: { change: TargetChange; onDismiss: () => void }) {
  const [open, setOpen] = useState(false);
  const band = proteinBand(change.to);
  const rows: [string, number | undefined, number, string][] = [
    ['Peso base', change.from?.weightBasisKg, change.to.weightBasisKg, 'kg'],
    ['Calorías', change.from?.kcal, change.to.kcal, 'kcal'],
    ['Proteína', change.from?.proteinG, change.to.proteinG, 'g'],
    ['Grasa', change.from?.fatG, change.to.fatG, 'g'],
    ['Carbohidratos', change.from?.carbsG, change.to.carbsG, 'g'],
  ];

  return (
    <Card tone="warn">
      <Text style={styles.noticeTitle}>Objetivos actualizados</Text>
      <Text
        accessibilityLabel="Ver el cambio de metas"
        accessibilityRole="button"
        onPress={() => setOpen((value) => !value)}
        style={styles.noticeText}
      >
        Peso promedio {change.to.weightBasisKg.toFixed(1)} kg → proteína {band.from} a {band.to} g,{' '}
        {change.to.kcal} kcal.
      </Text>
      {open &&
        rows.map(([label, before, after, unit]) => (
          <Text key={label} style={styles.noticeRow}>
            {label}: {before === undefined ? '—' : round1(before)} → {round1(after)} {unit}
          </Text>
        ))}
      <Button label="Entendido" accessibilityLabel="Entendido" onPress={onDismiss} />
    </Card>
  );
}

export function TodayScreen({
  onOpen,
  onOpenDay,
}: {
  onOpen: (tab: string) => void;
  onOpenDay: (date: string) => void;
}) {
  const {
    state,
    dataRevision,
    loadScoreDays,
    logDay,
    addToDay,
    tapWater,
    undoWater,
    loadDay,
    dismissTargetChange,
    raiseStepsTarget,
    declineStepsTarget,
    saveSetting,
  } = useAppData();
  const info = useInfo();
  const now = useNow();
  // El aviso de ofertas: se abre solo la primera vez que hay recoleccion nueva, y
  // despues queda a un toque en su cartilla.
  const [deals, setDeals] = useState<'closed' | 'open'>('closed');
  const [announced, setAnnounced] = useState(false);
  // Unrelated writes may reload the same scores; retain their identity for the grid.
  const days = state.phase === 'ready' ? state.loaded.days : null;
  const signature =
    days === null
      ? ''
      : days.map((day) => `${day.date}:${day.score ?? ''}:${day.hasData}`).join('|');
  const gridDays = useMemo(
    () => days ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature],
  );
  const rawScale = state.phase === 'ready' ? state.loaded.settings.get('score_scale') : undefined;
  const scale = useMemo(() => scoreScaleFrom(rawScale), [rawScale]);

  // La cuadricula memoizada solo se salta su redibujo si el gesto es siempre la misma
  // funcion. Una nueva en cada render la rearmaba entera, los ochenta y cuatro cuadritos
  // dos veces por cada botella; lo que cambia lo lee de aqui al tocar.
  const unit = state.phase === 'ready' ? state.loaded.unit : null;
  const latest = useRef({ info, unit, loadDay, onOpenDay });
  useEffect(() => {
    latest.current = { info, unit, loadDay, onOpenDay };
  });

  /** Un cuadrito abre su globito ahi mismo, pegado al dedo, y no un modal encima de todo. */
  const peek = useCallback(
    (date: string, at: { x: number; y: number; width: number; height: number }) => {
      const { info, unit, loadDay, onOpenDay } = latest.current;
      if (unit === null) return;
      info.show(
        <DayDialog
          date={date}
          unit={unit}
          load={loadDay}
          onOpenDetail={() => {
            info.hide();
            onOpenDay(date);
          }}
        />,
        at,
      );
    },
    [],
  );
  const hideDay = useCallback(() => latest.current.info.hide(), []);

  if (state.phase !== 'ready') return <Screen title="Hoy">{null}</Screen>;

  const { loaded } = state;
  // Con el valor de fabrica si nunca lo toco: la lista guardada solo trae lo escrito.
  const watching = loaded.settings.get('deal_watchlist') ?? settingDefault('deal_watchlist');
  const blocked = loaded.settings.get('deal_blocklist') ?? settingDefault('deal_blocklist');
  const watched = watchedDeals(loaded.deals, watchWords(watching), watchWords(blocked));
  // Lo vencido se sigue viendo en el aviso, pero ni cuenta en la cartilla ni lo abre solo.
  const live = liveDeals(watched).length;
  // Spec 16.7: una fuente que se callo lo dice aqui tambien, no solo en Ofertas.
  const silent = loaded.dealSources
    .map((source) => sourceStatus(source, now))
    .filter((status) => status.silent)
    .map((status) => status.line);
  const collected = newestFetch(loaded.deals);
  const seen = Number(loaded.settings.get('deals_seen_at') ?? '0');
  // Una sola vez por recoleccion: si ya lo vio, la cartilla sigue ahi pero no se abre
  // encima de lo que estaba haciendo.
  if (!announced && live > 0 && collected !== null && collected > seen) {
    setAnnounced(true);
    setDeals('open');
  }

  const closeDeals = () => {
    setDeals('closed');
    if (collected !== null) saveSetting('deals_seen_at', String(collected));
  };
  const today = loaded.today.date;
  const score = loaded.today.result?.score ?? null;
  const pending = loaded.today.result?.pointsWithoutData ?? 100;

  const targets = loaded.today.targets;
  const nutrition = loaded.today.nutrition;
  const band = targets ? proteinBand(targets) : null;

  return (
    <Screen
      title="Hoy"
      onOverlayDismiss={deals === 'open' ? closeDeals : undefined}
      overlay={
        deals === 'open' ? (
          <DealAlert
            found={watched}
            silent={silent}
            onOpenAll={() => {
              closeDeals();
              onOpen('Ofertas');
            }}
            onClose={closeDeals}
          />
        ) : null
      }
    >
      {/* Lo primero y lo mas grande, porque es de lo que va la app entera. La racha va
          dentro de la estrella: es el numero que mas le mueve a no romper el dia. Toda
          la cartilla abre el dia de hoy con el desglose de donde salio cada punto. */}
      <Card
        tone="accent"
        accessibilityLabel="Ver el detalle de hoy"
        onPress={() => onOpenDay(today)}
      >
        <View style={styles.heroRow}>
          <View style={styles.heroSide}>
            <Text style={styles.heroEyebrow}>NOTA DE HOY</Text>
            <Text style={styles.heroScore}>{score === null ? '—' : scoreText(score)}</Text>
            <Text style={styles.heroNote}>
              de 100
              {pending > 0 ? ` · faltan ${Math.round(pending)} por anotar` : ' · día completo'}
            </Text>
          </View>
          <View style={styles.heroStar}>
            <Star size={78} color={theme.surface} style={styles.star}>
              <Text style={styles.starValue}>{currentStreak(loaded.scoreHistory, today)}</Text>
            </Star>
            <Text style={styles.starLabel}>días de racha</Text>
          </View>
        </View>
      </Card>

      {loaded.readapting && (
        <Card tone="warn">
          <Text style={styles.noticeTitle}>Readaptación</Text>
          <Text style={styles.noticeText}>
            Semana {loaded.readapting.week} de {loaded.readapting.of}: los entrenos que falten no te
            penalizan.
          </Text>
        </Card>
      )}

      {loaded.targetChange && (
        <TargetChangeCard
          change={loaded.targetChange}
          onDismiss={() => {
            if (loaded.targetChange) dismissTargetChange(loaded.targetChange.effectiveFrom);
          }}
        />
      )}

      {loaded.steps && (
        /* Spec 14.2: the stage is earned, and it still needs a yes. */
        <Card tone="info">
          <Text style={styles.noticeTitle}>Meta de pasos</Text>
          <Text style={styles.noticeText}>
            Tres semanas seguidas cumpliendo {loaded.steps.current} pasos. ¿Subimos la meta a{' '}
            {loaded.steps.next}?
          </Text>
          <View style={styles.noticeButtons}>
            <Button
              label="Subirla"
              accessibilityLabel={`Subir la meta de pasos a ${loaded.steps.next}`}
              variant="primary"
              onPress={() => loaded.steps && raiseStepsTarget(loaded.steps.next)}
            />
            <Button
              label="Ahora no"
              accessibilityLabel="Dejar la meta de pasos como está"
              onPress={() => loaded.steps && declineStepsTarget(loaded.steps.next)}
            />
          </View>
        </Card>
      )}

      <Card>
        <View style={styles.gridHead}>
          <Text style={styles.gridTitle}>{WEEKS_SHOWN} semanas</Text>
          <Button
            label="Registros"
            accessibilityLabel="Ver todos los registros"
            variant="ghost"
            icon={ChevronRight}
            onPress={() => onOpen('Registros')}
          />
        </View>
        <DisciplineGrid
          days={gridDays}
          today={today}
          scale={scale}
          revision={dataRevision}
          loadDays={loadScoreDays}
          onOpenDay={peek}
          onScrollStart={hideDay}
        />
        <Text style={styles.gridFoot}>
          Máxima histórica: {longestStreak(loaded.scoreHistory, today)} días
        </Text>
      </Card>

      <View style={styles.modules}>
        <ModuleCard
          label="ENTRENO"
          tone="ok"
          icon={Dumbbell}
          value={
            loaded.today.session
              ? `${Math.round(fromKg(loaded.today.sessionVolume, loaded.unit))} ${loaded.unit}`
              : 'Sin entrenar'
          }
          detail={loaded.today.session ? 'de volumen hoy' : 'Toca para empezar'}
          onOpen={() => onOpen('Entreno')}
        />
        <ModuleCard
          label="COMIDA"
          tone="info"
          icon={Utensils}
          value={nutrition ? `${Math.round(nutrition.kcal)} kcal` : 'Nada aún'}
          detail={
            nutrition
              ? `${Math.round(nutrition.proteinG)} g de proteína`
              : band
                ? `Meta ${band.from} a ${band.to} g`
                : 'Faltan tus metas'
          }
          onOpen={() => onOpen('Comida')}
        />
      </View>

      <View style={styles.modules}>
        {/* Ofertas dejo de ser una pestana: lo que importa son las tuyas, y eso cabe
            en una hoja que se abre cuando hay algo y se vuelve a abrir a un toque. */}
        <ModuleCard
          label="OFERTAS"
          tone="danger"
          icon={Tag}
          value={live === 0 ? 'Ninguna' : String(live)}
          detail={
            silent.length > 0
              ? 'sin datos nuevos'
              : live === 0
                ? 'de tus palabras'
                : 'de lo que vigilas'
          }
          onOpen={live === 0 ? () => onOpen('Ofertas') : () => setDeals('open')}
        />
        <ModuleCard
          label="FINANZAS"
          tone="warn"
          icon={Wallet}
          value="—"
          detail="Todavía no construido"
          onOpen={() => onOpen('Finanzas')}
        />
      </View>

      <Card title="Registro del día">
        <TodayLog
          editing
          // Un dia nuevo es otro registro: sin esto los campos seguian con lo de ayer.
          key={loaded.today.date}
          log={loaded.today.log}
          lastWeight={loaded.lastWeight}
          containers={loaded.containers}
          waterTargetMl={
            targets
              ? loaded.today.trained === true
                ? targets.waterMlTraining
                : targets.waterMlRest
              : null
          }
          onLog={logDay}
          onAdd={addToDay}
          onTapWater={tapWater}
          onUndoWater={undoWater}
          canUndoWater={
            parseWaterTaps(loaded.settings.get('water_taps'), loaded.today.date).length > 0
          }
        />
      </Card>

      <View style={styles.links}>
        <Button
          label="Gráficas"
          accessibilityLabel="Ver las gráficas"
          icon={ChevronRight}
          onPress={() => onOpen('Gráficas')}
        />
        <Button
          label="Resumen de la semana"
          accessibilityLabel="Ver el resumen de la semana"
          icon={ChevronRight}
          onPress={() => onOpen('Resumen semanal')}
        />
        {/* Spec 12: the score has to be auditable, not just shown. */}
        <Button
          label="Por qué cuenta cada cosa"
          accessibilityLabel="Ver por que cuenta cada cosa"
          icon={ChevronRight}
          onPress={() => onOpen('Lecturas')}
        />
      </View>
    </Screen>
  );
}

const styles = sheet((theme) => ({
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  heroSide: {
    flexShrink: 1,
  },
  heroEyebrow: {
    fontSize: 11,
    fontFamily: font.black,
    letterSpacing: 1.2,
    color: theme.accentInkSoft,
  },
  heroScore: {
    fontSize: 56,
    lineHeight: 62,
    fontFamily: font.display,
    color: theme.accentInk,
    fontVariant: ['tabular-nums'],
  },
  heroNote: {
    fontSize: 12,
    fontFamily: font.bold,
    color: theme.accentInkSoft,
  },
  heroStar: {
    alignItems: 'center',
    gap: 2,
  },
  star: {
    // Pegada un poco torcida: es un sticker, no un icono alineado a la rejilla.
    transform: [{ rotate: '-8deg' }],
  },
  starValue: {
    fontSize: 26,
    fontFamily: font.black,
    color: theme.text,
    fontVariant: ['tabular-nums'],
  },
  starLabel: {
    fontSize: 11,
    fontFamily: font.bold,
    color: theme.accentInkSoft,
  },
  noticeTitle: {
    fontSize: 15,
    fontFamily: font.black,
    color: theme.accentInk,
  },
  noticeText: {
    fontSize: 13,
    fontFamily: font.regular,
    color: theme.accentInk,
  },
  noticeRow: {
    fontSize: 12,
    fontFamily: font.bold,
    color: theme.accentInkSoft,
    fontVariant: ['tabular-nums'],
  },
  noticeButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  gridHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  gridTitle: {
    fontSize: 16,
    fontFamily: font.black,
    color: theme.text,
  },
  gridFoot: {
    fontSize: 12,
    fontFamily: font.bold,
    color: theme.textFaint,
    fontVariant: ['tabular-nums'],
  },
  modules: {
    flexDirection: 'row',
    gap: 12,
  },
  module: {
    flex: 1,
    gap: 6,
    padding: 12,
  },
  moduleHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  moduleIcon: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: 6,
    backgroundColor: theme.surface,
  },
  moduleLabel: {
    fontSize: 11,
    fontFamily: font.black,
    letterSpacing: 0.8,
    color: theme.accentInk,
  },
  moduleValue: {
    fontSize: 18,
    fontFamily: font.black,
    color: theme.accentInk,
    fontVariant: ['tabular-nums'],
  },
  moduleDetail: {
    fontSize: 12,
    fontFamily: font.regular,
    color: theme.accentInkSoft,
  },
  links: {
    gap: 8,
    marginTop: 2,
  },
}));
