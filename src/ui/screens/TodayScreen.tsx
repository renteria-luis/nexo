import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { useAppData, WEEKS_SHOWN } from '../../shell/AppData.tsx';
import { addDays, dateAndTime, todayIso, weekStart } from '../../core/dates.ts';
import { scoreText } from '../../core/day-report.ts';
import { currentStreak, longestStreak } from '../../core/discipline.ts';
import { averageScore, buildGrid } from '../../core/heatmap.ts';
import type { TargetChange } from '../../core/snapshots.ts';
import { proteinBand } from '../../core/targets.ts';
import { fromKg } from '../../core/units.ts';

import { Button } from '../Button.tsx';
import { Card, type CardTone } from '../Card.tsx';
import { CommandBar } from '../CommandBar.tsx';
import { DayDialog } from '../DayDialog.tsx';
import { DisciplineGrid } from '../DisciplineGrid.tsx';
import { ChevronRight, Dumbbell, Tag, Utensils, Wallet, type LucideIcon } from '../icons.ts';
import { Star } from '../Star.tsx';
import { TargetsCard } from '../TargetsCard.tsx';
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

/**
 * La fecha y la hora de arriba, refrescandose solas.
 *
 * Aparte del resto de la pantalla porque el minuto que pasa no tiene que volver a
 * armar la cuadricula de doce semanas ni repintar las cartillas.
 */
function Clock() {
  const [text, setText] = useState(() => dateAndTime());

  useEffect(() => {
    const tick = setInterval(() => setText(dateAndTime()), 20_000);
    return () => clearInterval(tick);
  }, []);

  return <Text style={styles.clock}>{text}</Text>;
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
  const { state, logDay, loadDay, dismissTargetChange, raiseStepsTarget, declineStepsTarget } =
    useAppData();
  const [openDay, setOpenDay] = useState<string | null>(null);
  // Doce semanas son ochenta y cuatro cuadritos, y armarlos son unos cuantos cientos
  // de elementos. Se rehacen solo cuando cambia alguna nota, no cada vez que la app
  // recarga: cada dato anotado trae una lista de dias nueva con el mismo contenido, y
  // por eso se compara por lo que dice y no por ser el mismo objeto.
  const days = state.phase === 'ready' ? state.loaded.days : null;
  const palette = state.phase === 'ready' ? state.loaded.palette : null;
  const signature =
    days === null ? '' : days.map((day) => `${day.date}:${day.score ?? ''}`).join('|');
  const weeks = useMemo(() => {
    if (days === null || palette === null) return [];
    const to = todayIso();
    return buildGrid(days, { from: weekStart(addDays(to, -(WEEKS_SHOWN - 1) * 7)), to }, palette);
    // La firma es la dependencia de verdad; la lista entra por ella.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, palette]);

  if (state.phase !== 'ready') return <Screen title="Hoy">{null}</Screen>;

  const { loaded } = state;
  const today = todayIso();
  const average = averageScore(loaded.days);
  const score = loaded.today.result?.score ?? null;
  const pending = loaded.today.result?.pointsWithoutData ?? 100;

  const targets = loaded.today.targets;
  const nutrition = loaded.today.nutrition;
  const band = targets ? proteinBand(targets) : null;

  return (
    <Screen title="Hoy">
      <Clock />

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
              <Text style={styles.starValue}>{currentStreak(loaded.days, today)}</Text>
            </Star>
            <Text style={styles.starLabel}>días de racha</Text>
          </View>
        </View>
      </Card>

      <CommandBar />

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

      {/* No horizontal scroller around it: twelve weeks fit across a phone, and a
          scroller here would swallow the swipe between tabs. */}
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
        <DisciplineGrid weeks={weeks} onOpenDay={setOpenDay} />
        <Text style={styles.gridFoot}>
          Máxima {longestStreak(loaded.days, today)} días · promedio{' '}
          {average === null ? '—' : Math.round(average)}
        </Text>
      </Card>

      {openDay !== null && (
        <DayDialog
          date={openDay}
          unit={loaded.unit}
          load={loadDay}
          onClose={() => setOpenDay(null)}
          onOpenDetail={() => {
            const date = openDay;
            setOpenDay(null);
            onOpenDay(date);
          }}
        />
      )}

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
        <ModuleCard
          label="OFERTAS"
          tone="danger"
          icon={Tag}
          value={loaded.deals.length === 0 ? 'Ninguna' : String(loaded.deals.length)}
          detail={loaded.deals.length === 0 ? 'Toca para buscarlas' : 'guardadas'}
          onOpen={() => onOpen('Ofertas')}
        />
        <ModuleCard
          label="FINANZAS"
          tone="warn"
          icon={Wallet}
          value="—"
          detail="Todavía no construido"
        />
      </View>

      <Card title="Registro del día">
        <TodayLog
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
        />
      </Card>

      {targets && <TargetsCard targets={targets} />}

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
  clock: {
    fontSize: 13,
    color: theme.textFaint,
    fontFamily: font.bold,
    marginTop: -4,
  },
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
