import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Command as CommandIcon } from './icons.ts';

import { COMMAND_HELP, parseCommand, type Command } from '../core/commands.ts';
import { toKg } from '../core/units.ts';
import { useAppData } from '../shell/AppData.tsx';

import { Button } from './Button.tsx';
import { font, hardShadow, sheet, shape, theme } from './theme.ts';

/**
 * El prompt del nucleo. Todo lo que hay aqui se puede hacer tocando botones; esto es
 * el atajo para cuando ya sabes que quieres escribir, que es casi siempre.
 *
 * Lo que devuelve cada comando es una frase que dice que quedo guardado, con el total
 * despues de guardarlo. Un "listo" a secas no deja comprobar nada.
 */
export function CommandBar() {
  const { state, exerciseId, logDay, logSet } = useAppData();
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  if (state.phase !== 'ready') return null;
  const { loaded } = state;

  const run = (command: Command): string => {
    switch (command.kind) {
      case 'help':
        setShowHelp(true);
        return 'Esto es lo que entiendo.';
      case 'water': {
        const total = (loaded.today.log?.water_ml ?? 0) + command.ml;
        logDay({ waterMl: total });
        return `Agua +${command.ml} ml, van ${(total / 1000).toFixed(2)} L`;
      }
      case 'weight':
        logDay({ weightKg: command.value });
        return `Peso de hoy ${command.value} kg`;
      case 'steps':
        logDay({ steps: command.steps });
        return `${command.steps} pasos`;
      case 'sleep':
        logDay({
          sleepMinutes: command.minutes,
          sleepSource: loaded.today.log?.sleep_source ?? 'manual',
        });
        return `Sueño ${Math.floor(command.minutes / 60)} h ${command.minutes % 60} min`;
      case 'creatine':
        logDay({ creatineTaken: command.taken });
        return command.taken ? 'Creatina tomada' : 'Creatina no tomada';
      case 'set': {
        if (loaded.today.session === null) return 'No hay entreno abierto, no anoté nada.';
        if (exerciseId === null) return 'Elige el ejercicio en Entreno y repite el comando.';
        logSet(toKg(command.weight, loaded.unit), command.reps, { rpe: command.rpe });
        return `Serie de ${command.weight} ${loaded.unit} por ${command.reps} anotada`;
      }
    }
  };

  const submit = () => {
    const parsed = parseCommand(draft);
    if (!parsed.ok) {
      // El texto se queda para corregirlo, que es mas rapido que volver a escribirlo.
      setNote(parsed.reason);
      return;
    }
    if (parsed.command.kind !== 'help') setShowHelp(false);
    setNote(run(parsed.command));
    setDraft('');
  };

  return (
    <View style={styles.wrapper}>
      <View style={styles.line}>
        <View style={styles.badge}>
          <CommandIcon size={14} color={theme.accentInk} strokeWidth={2.5} />
        </View>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={submit}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="send"
          accessibilityLabel="Comando"
          placeholder='agua 710, serie 65x8, "ayuda"'
          placeholderTextColor={theme.textGhost}
          style={styles.input}
        />
      </View>

      {note && <Text style={styles.note}>{note}</Text>}

      {showHelp && (
        <View style={styles.help}>
          {COMMAND_HELP.map((row) => (
            <Text key={row} style={styles.helpRow}>
              {row}
            </Text>
          ))}
          <Button
            label="Cerrar"
            accessibilityLabel="Cerrar la ayuda"
            variant="ghost"
            onPress={() => setShowHelp(false)}
            style={styles.close}
          />
        </View>
      )}
    </View>
  );
}

const styles = sheet((theme) => ({
  wrapper: {
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radius,
    backgroundColor: theme.surface,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
    ...hardShadow(theme),
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.accent,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
  },
  input: {
    flex: 1,
    fontSize: 14,
    fontFamily: font.bold,
    color: theme.text,
    paddingVertical: 6,
  },
  note: {
    fontSize: 12,
    fontFamily: font.bold,
    color: theme.textFaint,
  },
  help: {
    gap: 3,
    borderTopWidth: shape.border,
    borderTopColor: theme.line,
    paddingTop: 8,
  },
  helpRow: {
    fontSize: 12,
    fontFamily: font.regular,
    color: theme.textDim,
  },
  close: {
    alignSelf: 'flex-start',
  },
}));
