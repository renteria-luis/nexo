import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { PaletteId } from '../../core/palettes.ts';
import { settingProblem, type SettingKey, type Settings } from '../../core/settings.ts';

import { NUMBER_PAD_HEIGHT, useNumberPad } from '../NumberPadHost.tsx';
import { NumericField } from '../NumericField.tsx';
import { PalettePicker } from '../PalettePicker.tsx';
import { mono, theme } from '../theme.ts';

const PHASES: { value: string; label: string }[] = [
  { value: 'recomp', label: 'Recomposición' },
  { value: 'cut', label: 'Déficit' },
  { value: 'maintain', label: 'Mantenimiento' },
  { value: 'bulk', label: 'Volumen' },
];

// Cada campo dice para que sirve y que pasa si se deja vacio, porque son datos que
// se llenan una vez y despues no se vuelven a mirar en meses.
const FIELDS: {
  key: SettingKey;
  label: string;
  hint: string;
  keyboard: 'numeric' | 'default';
  required?: boolean;
}[] = [
  {
    key: 'height_cm',
    label: 'Estatura (cm)',
    hint: 'Con tu peso y tu edad sale cuantas calorias quemas en reposo. Sin esto no hay metas y los dias salen sin nota.',
    keyboard: 'numeric',
    required: true,
  },
  {
    key: 'birth_date',
    label: 'Fecha de nacimiento',
    hint: 'AAAA-MM-DD, por ejemplo 1999-04-27. La edad entra en la misma cuenta que la estatura.',
    keyboard: 'default',
    required: true,
  },
  {
    key: 'activity_factor',
    label: 'Factor de actividad',
    hint: 'Cuanto te mueves fuera del gym. 1.55 con cinco entrenos por semana y trabajo sentado; 1.7 si ademas caminas todo el dia.',
    keyboard: 'numeric',
  },
  {
    key: 'sleep_target_minutes',
    label: 'Meta de sueño (min)',
    hint: 'En minutos: 420 son siete horas, 450 siete y media. Es contra lo que se puntua tu sueño.',
    keyboard: 'numeric',
  },
  {
    key: 'steps_target',
    label: 'Meta de pasos',
    hint: 'Los pasos del dia que cuentan como cumplido. La app te propone subirla sola cuando la cumples tres semanas seguidas.',
    keyboard: 'numeric',
  },
  {
    key: 're_entry_started_on',
    label: 'Readaptación desde',
    hint: 'Solo si volviste de un parón largo: mientras dura, no te penaliza los entrenos que faltes. Vacío si no aplica.',
    keyboard: 'default',
  },
  {
    key: 're_entry_weeks',
    label: 'Semanas de readaptación',
    hint: 'Cuanto dura esa readaptación. Tres es lo normal.',
    keyboard: 'numeric',
  },
];

export type SettingsScreenProps = {
  onResetDatabase: () => void;
  /** Escribe el archivo y abre la hoja de compartir. */
  onExport: () => Promise<{ uri: string; bytes: number; shared: boolean }>;
  /** Null cuando cierra el selector sin elegir. Rechaza con el motivo si el archivo no sirve. */
  onImport: () => Promise<{ tables: number; rows: number; skipped: string[] } | null>;
  settings: Settings;
  palette: PaletteId;
  todayWeightKg: number | null;
  onSaveSetting: (key: SettingKey, value: string) => void;
  onClearSetting: (key: SettingKey) => void;
  onSaveWeight: (weightKg: number) => void;
  onSelectPalette: (palette: PaletteId) => void;
};

export function SettingsScreen({
  onResetDatabase,
  onExport,
  onImport,
  settings,
  palette,
  todayWeightKg,
  onSaveSetting,
  onClearSetting,
  onSaveWeight,
  onSelectPalette,
}: SettingsScreenProps) {
  const pad = useNumberPad();
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [confirmingImport, setConfirmingImport] = useState(false);
  const [busy, setBusy] = useState(false);
  const [backupNote, setBackupNote] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<SettingKey, string>>>({});
  const [weightDraft, setWeightDraft] = useState(
    todayWeightKg === null ? '' : String(todayWeightKg),
  );

  const commit = (key: SettingKey) => {
    const draft = drafts[key];
    if (draft === undefined) return;
    if (draft.trim() === '') {
      onClearSetting(key);
      setDrafts((current) => ({ ...current, [key]: undefined }));
      return;
    }
    if (settingProblem(key, draft) !== null) return;
    onSaveSetting(key, draft.trim());
  };

  const phase = settings.get('phase') ?? 'recomp';

  return (
    // Scrolls on its own rather than through the shared Screen frame: this one is
    // pushed as a modal and has no tab bar under it.
    <ScrollView
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      style={styles.scroll}
      contentContainerStyle={[styles.screen, pad.isOpen && { paddingBottom: NUMBER_PAD_HEIGHT }]}
    >
      <Text style={styles.heading}>Perfil</Text>
      <Text style={styles.warning}>
        Estos datos solo viven en tu teléfono. No están escritos en el código ni se suben a ningún
        lado.
      </Text>
      <Text style={styles.hint}>
        Solo los dos primeros son obligatorios: sin estatura y fecha de nacimiento no se pueden
        calcular tus metas, y sin metas ningún día tiene nota. El resto ya viene con un valor
        razonable y lo puedes dejar como está.
      </Text>

      {FIELDS.map((field) => {
        const draft = drafts[field.key] ?? settings.get(field.key) ?? '';
        const problem = draft.trim() === '' ? null : settingProblem(field.key, draft);
        return (
          <View key={field.key} style={styles.field}>
            <Text style={styles.label}>{field.label}</Text>
            {field.keyboard === 'numeric' ? (
              <NumericField
                value={draft}
                onChange={(text) => setDrafts((current) => ({ ...current, [field.key]: text }))}
                allowDecimal
                accessibilityLabel={field.label}
                onCommit={() => commit(field.key)}
                style={[styles.input, problem ? styles.inputBad : null]}
              />
            ) : (
              <TextInput
                value={draft}
                onChangeText={(text) => setDrafts((current) => ({ ...current, [field.key]: text }))}
                onBlur={() => commit(field.key)}
                onSubmitEditing={() => commit(field.key)}
                accessibilityLabel={field.label}
                style={[styles.input, problem ? styles.inputBad : null]}
              />
            )}
            <Text style={problem ? styles.problem : styles.hint}>
              {problem ?? field.hint}
              {field.required && draft.trim() === '' ? ' Falta este.' : ''}
            </Text>
          </View>
        );
      })}

      <View style={styles.field}>
        <Text style={styles.label}>Fase</Text>
        <View style={styles.options}>
          {PHASES.map((option) => (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              onPress={() => onSaveSetting('phase', option.value)}
              style={[styles.option, option.value === phase && styles.optionSelected]}
            >
              <Text style={styles.optionText}>{option.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <Text style={styles.heading}>Unidad de peso</Text>
      <View style={styles.options}>
        {(['lb', 'kg'] as const).map((option) => (
          <Pressable
            key={option}
            accessibilityRole="radio"
            onPress={() => onSaveSetting('weight_unit', option)}
            style={[
              styles.option,
              (settings.get('weight_unit') ?? 'lb') === option && styles.optionSelected,
            ]}
          >
            <Text style={styles.optionText}>{option === 'lb' ? 'Libras' : 'Kilos'}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.hint}>
        Cómo ves y escribes el peso que levantas. Se guarda siempre igual por dentro, así que
        cambiarlo no altera nada de lo ya registrado. Tu peso corporal va aparte, en kilos.
      </Text>

      <Text style={styles.heading}>Peso de hoy</Text>
      <View style={styles.field}>
        <NumericField
          value={weightDraft}
          onChange={setWeightDraft}
          allowDecimal
          accessibilityLabel="Peso de hoy"
          onCommit={() => {
            const parsed = Number(weightDraft);
            if (Number.isFinite(parsed) && parsed > 0) onSaveWeight(parsed);
          }}
          style={styles.input}
        />
        <Text style={styles.hint}>
          El promedio de siete días es el que manda; un día suelto es agua y comida en el estómago.
        </Text>
      </View>

      <Text style={styles.heading}>Paleta</Text>
      <PalettePicker selected={palette} onSelect={onSelectPalette} />

      <Text style={styles.heading}>Respaldo</Text>
      <Text style={styles.hint}>
        Un solo archivo JSON con todo lo registrado. Sirve para volver si se borra la app o cambias
        de teléfono, y es el mismo archivo que usarás para entrenar un modelo más adelante.
      </Text>
      <View style={styles.options}>
        <Pressable
          accessibilityLabel="Exportar todo a un archivo"
          disabled={busy}
          onPress={() => {
            setBusy(true);
            setBackupNote('Escribiendo…');
            onExport()
              .then((outcome) => {
                setBackupNote(
                  outcome.shared
                    ? `Listo, ${Math.round(outcome.bytes / 1024)} KB.`
                    : `Guardado en el teléfono, ${Math.round(outcome.bytes / 1024)} KB: ${outcome.uri}`,
                );
              })
              .catch((error: unknown) => {
                setBackupNote(error instanceof Error ? error.message : String(error));
              })
              .finally(() => setBusy(false));
          }}
          style={styles.option}
        >
          <Text style={styles.optionText}>Exportar</Text>
        </Pressable>

        {confirmingImport ? (
          <>
            <Pressable
              accessibilityLabel="Confirmar importación"
              disabled={busy}
              onPress={() => {
                setConfirmingImport(false);
                setBusy(true);
                setBackupNote('Leyendo el archivo…');
                onImport()
                  .then((result) => {
                    if (result === null) {
                      setBackupNote('No elegiste ningún archivo.');
                      return;
                    }
                    setBackupNote(
                      `Restaurado: ${result.rows} filas en ${result.tables} tablas.` +
                        (result.skipped.length > 0
                          ? ` Quedaron fuera ${result.skipped.join(', ')}, que esta versión ya no tiene.`
                          : ''),
                    );
                  })
                  .catch((error: unknown) => {
                    setBackupNote(error instanceof Error ? error.message : String(error));
                  })
                  .finally(() => setBusy(false));
              }}
              style={[styles.option, styles.danger]}
            >
              <Text style={styles.dangerText}>Sí, reemplazar lo que hay</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Cancelar importación"
              onPress={() => setConfirmingImport(false)}
              style={styles.option}
            >
              <Text style={styles.optionText}>Cancelar</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            accessibilityLabel="Importar desde un archivo"
            disabled={busy}
            onPress={() => setConfirmingImport(true)}
            style={styles.option}
          >
            <Text style={styles.optionText}>Importar</Text>
          </Pressable>
        )}
      </View>
      {backupNote && <Text style={styles.hint}>{backupNote}</Text>}

      <Text style={styles.heading}>Base de datos</Text>
      <Text style={styles.hint}>
        Mientras el esquema siga cambiando, una versión nueva de la app puede no entenderse con una
        base creada antes. Borrarla la reconstruye desde cero.
      </Text>
      {confirmingReset ? (
        <View style={styles.options}>
          <Pressable
            accessibilityLabel="Confirmar borrado"
            onPress={() => {
              setConfirmingReset(false);
              onResetDatabase();
            }}
            style={[styles.option, styles.danger]}
          >
            <Text style={styles.dangerText}>Sí, borrar todo lo registrado</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Cancelar borrado"
            onPress={() => setConfirmingReset(false)}
            style={styles.option}
          >
            <Text style={styles.optionText}>Cancelar</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          accessibilityLabel="Borrar la base de datos"
          onPress={() => setConfirmingReset(true)}
          style={styles.option}
        >
          <Text style={styles.optionText}>Borrar la base de datos</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  screen: {
    flexGrow: 1,
    backgroundColor: theme.bg,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 48,
    gap: 10,
  },
  heading: {
    fontSize: 14,
    marginTop: 8,
    fontFamily: mono,
    color: theme.text,
  },
  warning: {
    fontSize: 11,
    color: theme.textGhost,
  },
  field: {
    gap: 3,
  },
  label: {
    fontSize: 12,
    color: theme.textDim,
    fontFamily: mono,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.lineSoft,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    fontFamily: mono,
    color: theme.text,
  },
  inputBad: {
    borderColor: theme.danger,
  },
  hint: {
    fontSize: 10,
    color: theme.textGhost,
  },
  problem: {
    fontSize: 10,
    color: theme.danger,
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  option: {
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  optionSelected: {
    borderColor: theme.lineStrong,
    backgroundColor: theme.surfaceHigh,
  },
  optionText: {
    fontSize: 12,
    fontFamily: mono,
    color: theme.text,
  },
  danger: {
    borderColor: theme.danger,
  },
  dangerText: {
    fontSize: 12,
    color: theme.danger,
    fontFamily: mono,
  },
});
