import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppData, WEEKS_SHOWN } from '../../shell/AppData.tsx';
import { addDays, todayIso, weekStart } from '../../core/dates.ts';
import { currentStreak, longestStreak } from '../../core/discipline.ts';
import { averageScore, buildGrid } from '../../core/heatmap.ts';
import type { TargetChange } from '../../core/snapshots.ts';
import { proteinBand } from '../../core/targets.ts';
import { fromKg } from '../../core/units.ts';
import { DisciplineGrid } from '../DisciplineGrid.tsx';
import { TargetsCard } from '../TargetsCard.tsx';
import { TodayLog } from '../TodayLog.tsx';

import { Screen } from './Screen.tsx';

/** A one line read on a module, with the way into it. */
function ModuleCard({
  label,
  value,
  detail,
  onOpen,
}: {
  label: string;
  value: string;
  detail?: string;
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
      {onOpen ? <Text style={styles.cardArrow}>›</Text> : null}
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

export function TodayScreen({ onOpen }: { onOpen: (tab: string) => void }) {
  const { state, logDay, dismissTargetChange, raiseStepsTarget, declineStepsTarget } = useAppData();
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

      {/* No horizontal scroller around it: twelve weeks fit across a phone, and a
          scroller here would swallow the swipe between tabs. */}
      <DisciplineGrid weeks={weeks} />

      <ModuleCard
        label="Entreno"
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

      <ModuleCard label="Ofertas" value="Todavía no construido" />
      <ModuleCard label="Finanzas" value="Todavía no construido" />

      {targets && <TargetsCard targets={targets} />}

      <Text style={styles.section}>Registro del día</Text>
      <TodayLog
        log={loaded.today.log}
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
    borderColor: '#d9e3f0',
    backgroundColor: '#f4f8fc',
    borderRadius: 8,
    padding: 10,
    gap: 4,
  },
  changeText: {
    fontSize: 13,
  },
  changeRow: {
    fontSize: 11,
    color: '#555',
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
    borderColor: '#555',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  changeDismissText: {
    fontSize: 12,
    color: '#555',
  },
  weekLink: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  weekLinkText: {
    fontSize: 12,
    color: '#555',
  },
  banner: {
    fontSize: 13,
    color: '#5a4a00',
    backgroundColor: '#fdf3d0',
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
  },
  streak: {
    fontSize: 13,
  },
  streakDetail: {
    fontSize: 11,
    color: '#888',
  },
  card: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 8,
    padding: 12,
  },
  cardLabel: {
    fontSize: 11,
    color: '#888',
  },
  cardValue: {
    fontSize: 14,
  },
  cardDetail: {
    fontSize: 11,
    color: '#999',
  },
  cardArrow: {
    fontSize: 22,
    color: '#bbb',
  },
  section: {
    fontSize: 14,
    marginTop: 6,
  },
});
