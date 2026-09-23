import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppData, WEEKS_SHOWN } from '../../shell/AppData.tsx';
import { addDays, todayIso, weekStart } from '../../core/dates.ts';
import { currentStreak, longestStreak } from '../../core/discipline.ts';
import { averageScore, buildGrid } from '../../core/heatmap.ts';
import type { TargetChange } from '../../core/snapshots.ts';
import { proteinBand } from '../../core/targets.ts';
import { fromKg } from '../../core/units.ts';
import {
  ChevronRight,
  Dumbbell,
  Tag,
  Utensils,
  Wallet,
  type LucideIcon,
} from 'lucide-react-native';

import { DayDialog } from '../DayDialog.tsx';
import { DisciplineGrid } from '../DisciplineGrid.tsx';
import { TargetsCard } from '../TargetsCard.tsx';
import { TodayLog } from '../TodayLog.tsx';

import { Screen } from './Screen.tsx';
import { CommandBar } from '../CommandBar.tsx';
import { mono, theme } from '../theme.ts';

/** A one line read on a module, with the way into it. */
function ModuleCard({
  label,
  value,
  detail,
  icon: Icon,
  onOpen,
}: {
  label: string;
  value: string;
  detail?: string;
  icon: LucideIcon;
  onOpen?: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={`Abrir ${label}`}
      disabled={!onOpen}
      onPress={onOpen}
      style={styles.card}
    >
      <View>
        <Text style={styles.cardLabel}>{label}</Text>
        <Text style={styles.cardValue}>{value}</Text>
        {detail ? <Text style={styles.cardDetail}>{detail}</Text> : null}
      </View>
      {onOpen ? <ChevronRight size={18} color={theme.textGhost} strokeWidth={1.75} /> : null}
    </Pressable>
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
    <View style={styles.change}>
      <Pressable accessibilityLabel="Ver el cambio de metas" onPress={() => setOpen((v) => !v)}>
        <Text style={styles.changeText}>
          Objetivos actualizados: peso promedio {change.to.weightBasisKg.toFixed(1)} kg → proteína{' '}
          {band.from} a {band.to} g, {change.to.kcal} kcal.
        </Text>
      </Pressable>
      {open &&
        rows.map(([label, before, after, unit]) => (
          <Text key={label} style={styles.changeRow}>
            {label}: {before === undefined ? '—' : round1(before)} → {round1(after)} {unit}
          </Text>
        ))}
      <Pressable accessibilityLabel="Entendido" onPress={onDismiss} style={styles.changeDismiss}>
        <Text style={styles.changeDismissText}>Entendido</Text>
      </Pressable>
    </View>
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
  if (state.phase !== 'ready') return <Screen title="Hoy">{null}</Screen>;

  const { loaded } = state;
  const today = todayIso();
  const from = weekStart(addDays(today, -(WEEKS_SHOWN - 1) * 7));
  const weeks = buildGrid(loaded.days, { from, to: today }, loaded.palette);
  const scores = loaded.days.map((day) => day.score);
  const average = averageScore(loaded.days);
  const score = loaded.today.result?.score ?? null;

  const targets = loaded.today.targets;
  const nutrition = loaded.today.nutrition;
  const band = targets ? proteinBand(targets) : null;

  return (
    <Screen title="Hoy">
      <CommandBar />

      {loaded.readapting && (
        <Text style={styles.banner}>
          Readaptación — semana {loaded.readapting.week} de {loaded.readapting.of}
        </Text>
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
        <View style={styles.change}>
          <Text style={styles.changeText}>
            Tres semanas seguidas cumpliendo {loaded.steps.current} pasos. ¿Subimos la meta a{' '}
            {loaded.steps.next}?
          </Text>
          <View style={styles.stepsButtons}>
            <Pressable
              accessibilityLabel={`Subir la meta de pasos a ${loaded.steps.next}`}
              onPress={() => loaded.steps && raiseStepsTarget(loaded.steps.next)}
              style={styles.stepsAccept}
            >
              <Text style={styles.changeDismissText}>Subirla</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Dejar la meta de pasos como está"
              onPress={() => loaded.steps && declineStepsTarget(loaded.steps.next)}
              style={styles.changeDismiss}
            >
              <Text style={styles.changeDismissText}>Ahora no</Text>
            </Pressable>
          </View>
        </View>
      )}

      <View style={styles.scoreRow}>
        <Text style={styles.score}>{score === null ? '—' : Math.round(score)}</Text>
        <View>
          <Text style={styles.streak}>Racha {currentStreak(scores)} días</Text>
          <Text style={styles.streakDetail}>
            Máxima {longestStreak(scores)} · promedio {average === null ? '—' : Math.round(average)}
          </Text>
        </View>
      </View>

      <View style={styles.gridHead}>
        <Text style={styles.gridLabel}>{WEEKS_SHOWN} semanas</Text>
        <Pressable
          accessibilityLabel="Ver todos los registros"
          onPress={() => onOpen('Registros')}
          style={styles.allRecords}
        >
          <Text style={styles.allRecordsText}>ver todos los registros</Text>
          <ChevronRight size={14} color={theme.accent} strokeWidth={1.75} />
        </Pressable>
      </View>

      {/* No horizontal scroller around it: twelve weeks fit across a phone, and a
          scroller here would swallow the swipe between tabs. */}
      <DisciplineGrid weeks={weeks} onOpenDay={setOpenDay} />

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

      <ModuleCard
        label="Entreno"
        icon={Dumbbell}
        value={
          loaded.today.session
            ? `${Math.round(fromKg(loaded.today.sessionVolume, loaded.unit))} ${loaded.unit} de volumen`
            : 'Sin entrenar hoy'
        }
        detail={loaded.today.session ? undefined : 'Toca para empezar'}
        onOpen={() => onOpen('Entreno')}
      />

      <ModuleCard
        label="Comida"
        icon={Utensils}
        value={
          nutrition
            ? `${Math.round(nutrition.kcal)} kcal · ${Math.round(nutrition.proteinG)} g de proteína`
            : 'Nada registrado'
        }
        detail={
          targets && band
            ? `Meta ${targets.kcal} kcal · proteína ${band.from} a ${band.to} g`
            : 'Faltan tus metas, en Ajustes'
        }
        onOpen={() => onOpen('Comida')}
      />

      <Pressable
        accessibilityLabel="Ver el resumen de la semana"
        onPress={() => onOpen('Resumen semanal')}
        style={styles.weekLink}
      >
        <Text style={styles.weekLinkText}>Resumen de la semana ›</Text>
      </Pressable>

      {/* Spec 12: the score has to be auditable, not just shown. */}
      <Pressable
        accessibilityLabel="Ver por que cuenta cada cosa"
        onPress={() => onOpen('Lecturas')}
        style={styles.weekLink}
      >
        <Text style={styles.weekLinkText}>Por qué cuenta cada cosa ›</Text>
      </Pressable>

      <ModuleCard
        label="Ofertas"
        icon={Tag}
        value={
          loaded.deals.length === 0
            ? 'Sin ofertas guardadas'
            : `${loaded.deals.length} ofertas guardadas`
        }
        detail={loaded.deals.length === 0 ? 'Toca para buscarlas' : undefined}
        onOpen={() => onOpen('Ofertas')}
      />
      <ModuleCard label="Finanzas" icon={Wallet} value="Todavía no construido" />

      {targets && <TargetsCard targets={targets} />}

      <Text style={styles.section}>Registro del día</Text>
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  change: {
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.surface,
    borderRadius: 8,
    padding: 10,
    gap: 4,
  },
  changeText: {
    fontSize: 13,
    color: theme.text,
  },
  changeRow: {
    fontSize: 11,
    color: theme.textDim,
    fontFamily: mono,
  },
  changeDismiss: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  stepsButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepsAccept: {
    borderWidth: 1,
    borderColor: theme.lineStrong,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  changeDismissText: {
    fontSize: 12,
    color: theme.textDim,
    fontFamily: mono,
  },
  weekLink: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  weekLinkText: {
    fontSize: 12,
    color: theme.textDim,
    fontFamily: mono,
  },
  banner: {
    fontSize: 13,
    color: theme.warn,
    backgroundColor: theme.warnBg,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    overflow: 'hidden',
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  score: {
    fontSize: 40,
    fontFamily: mono,
    color: theme.text,
  },
  streak: {
    fontSize: 13,
    fontFamily: mono,
    color: theme.text,
  },
  streakDetail: {
    fontSize: 11,
    color: theme.textGhost,
    fontFamily: mono,
  },
  card: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 8,
    padding: 12,
  },
  cardLabel: {
    fontSize: 11,
    color: theme.textGhost,
    fontFamily: mono,
  },
  cardValue: {
    fontSize: 14,
    fontFamily: mono,
    color: theme.text,
  },
  cardDetail: {
    fontSize: 11,
    color: theme.textGhost,
    fontFamily: mono,
  },
  gridHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  gridLabel: {
    fontSize: 11,
    color: theme.textGhost,
    fontFamily: mono,
  },
  allRecords: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 6,
  },
  allRecordsText: {
    fontSize: 12,
    color: theme.accent,
    fontFamily: mono,
  },
  cardArrow: {
    fontSize: 22,
    color: theme.textGhost,
    fontFamily: mono,
  },
  section: {
    fontSize: 14,
    marginTop: 6,
    fontFamily: mono,
    color: theme.text,
  },
});
