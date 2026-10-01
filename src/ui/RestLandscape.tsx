import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { clock, Elapsed } from './Elapsed.tsx';
import { font, sheet, shape } from './theme.ts';

/**
 * Lo que se ve al girar el telefono en pleno entreno: el descanso, en grande.
 *
 * Es la unica pantalla de la app que rota, y rota porque entre serie y serie el telefono
 * esta apoyado en el banco o en la maquina y lo que hace falta mirar es un numero, de
 * lejos y sin tocar nada. Tres cosas y ninguna mas: cuanto lleva descansando, que
 * ejercicio esta haciendo y que hizo en la serie anterior.
 *
 * Nada aqui se toca: para anotar se vuelve a poner el telefono de pie.
 */
export function RestLandscape({
  exerciseName,
  since,
  suggestedRestSeconds,
  lastSet,
  setNumber,
}: {
  exerciseName: string;
  /** Cuando anoto la ultima serie, que es cuando empezo a descansar de verdad. */
  since: number | null;
  suggestedRestSeconds: number | null;
  /** La serie anterior, ya escrita: "60 kg × 8". */
  lastSet: string | null;
  setNumber: number | null;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.frame, { paddingLeft: insets.left + 24, paddingRight: insets.right + 24 }]}>
      <View style={styles.side}>
        <Text style={styles.exercise} numberOfLines={3}>
          {exerciseName}
        </Text>
        {lastSet !== null && (
          <View style={styles.last}>
            <Text style={styles.lastLabel}>
              {setNumber === null ? 'SERIE ANTERIOR' : `SERIE ${setNumber}`}
            </Text>
            <Text style={styles.lastValue}>{lastSet}</Text>
          </View>
        )}
      </View>

      <View style={styles.clockSide}>
        <Text style={styles.label}>DESCANSANDO</Text>
        <Text style={styles.clock}>{since === null ? '0:00' : <Elapsed since={since} />}</Text>
        {suggestedRestSeconds !== null && (
          <Text style={styles.suggested}>de {clock(suggestedRestSeconds)} sugeridos</Text>
        )}
      </View>
    </View>
  );
}

const styles = sheet((theme) => ({
  frame: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
    paddingVertical: 20,
    backgroundColor: theme.bg,
  },
  side: {
    flex: 1,
    gap: 14,
  },
  exercise: {
    fontSize: 30,
    lineHeight: 34,
    fontFamily: font.display,
    letterSpacing: -0.5,
    color: theme.text,
  },
  last: {
    alignSelf: 'flex-start',
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  lastLabel: {
    fontSize: 11,
    fontFamily: font.black,
    letterSpacing: 1,
    color: theme.textFaint,
  },
  lastValue: {
    fontSize: 20,
    fontFamily: font.black,
    color: theme.text,
    fontVariant: ['tabular-nums'],
  },
  clockSide: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusLarge,
    backgroundColor: theme.accent,
    paddingHorizontal: 28,
    paddingVertical: 18,
  },
  label: {
    fontSize: 12,
    fontFamily: font.black,
    letterSpacing: 1.4,
    color: theme.accentInkSoft,
  },
  clock: {
    fontSize: 96,
    lineHeight: 104,
    fontFamily: font.display,
    color: theme.accentInk,
    fontVariant: ['tabular-nums'],
  },
  suggested: {
    fontSize: 13,
    fontFamily: font.bold,
    color: theme.accentInkSoft,
  },
}));
