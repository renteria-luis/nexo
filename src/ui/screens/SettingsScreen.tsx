import { useState } from 'react';
import { Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Eye, EyeOff } from '../icons.ts';

import type { PaletteId } from '../../core/palettes.ts';
import {
  nudgesEnabled,
  nudgesOffFrom,
  settingProblem,
  themeFrom,
  type SettingKey,
  type Settings,
} from '../../core/settings.ts';
import { DEFAULT_NUDGE_RULES, type NudgeKind } from '../../core/nudges.ts';

import { isBodyWeightKg } from '../../core/daily-log.ts';
import { Button } from '../Button.tsx';
import { Chip } from '../Chip.tsx';
import { NUMBER_PAD_HEIGHT, useNumberPad } from '../NumberPadHost.tsx';
import { NumericField } from '../NumericField.tsx';
import { PalettePicker } from '../PalettePicker.tsx';
import { font, sheet, shape, theme } from '../theme.ts';

/** Spec 4.5 aparte: esto es la piel de la app, no las paletas del daltonismo. */
const THEME_MODES: { value: string; label: string }[] = [
  { value: 'claro', label: 'Claro' },
  { value: 'oscuro', label: 'Oscuro' },
  { value: 'sistema', label: 'Como el iPhone' },
  { value: 'horario', label: 'Por horario' },
];

const DARK_HOURS: { key: SettingKey; label: string }[] = [
  { key: 'theme_dark_from', label: 'Oscuro desde (hora)' },
  { key: 'theme_dark_to', label: 'Y hasta (hora)' },
];

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

/** Los cuatro que puede apagar por su lado. El resumen del domingo va con el cierre. */
const NUDGE_SWITCHES: { kind: NudgeKind; label: string }[] = [
  { kind: 'comida', label: 'comida' },
  { kind: 'entreno', label: 'entreno' },
  { kind: 'agua', label: 'agua' },
  { kind: 'manana', label: 'mañana' },
  { kind: 'cierre', label: 'cierre del día' },
];

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
  // Lo que no paso la validacion, para que no parezca guardado.
  const [refused, setRefused] = useState<Partial<Record<SettingKey, string>>>({});
  // Estatura, fecha de nacimiento y peso son datos que no quiere a la vista de nadie
  // que le mire el telefono por encima del hombro.
  const nudgesOn = nudgesEnabled(settings);
  const nudgesOff = nudgesOffFrom(settings);
  const [hidden, setHidden] = useState(true);
  // Tapar con puntos lo que esta escribiendo en ese momento es como escribir a
  // ciegas: el campo abierto se ve, y se vuelve a tapar al salir de el.
  const [editing, setEditing] = useState<string | null>(null);
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
      setRefused((current) => ({ ...current, [key]: undefined }));
      return;
    }

    const problem = settingProblem(key, draft);
    if (problem !== null) {
      // Antes se descartaba en silencio: el campo se veia lleno, no se guardaba
      // nada, y al volver a entrar el dato habia "desaparecido".
      setRefused((current) => ({ ...current, [key]: problem }));
      return;
    }

    setRefused((current) => ({ ...current, [key]: undefined }));
    onSaveSetting(key, draft.trim());
  };

  const phase = settings.get('phase') ?? 'recomp';
  const skin = themeFrom(settings);

  return (
    // Scrolls on its own rather than through the shared Screen frame: this one is
    // pushed as a modal and has no tab bar under it.
    <ScrollView
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      style={styles.scroll}
      contentContainerStyle={[styles.screen, pad.isOpen && { paddingBottom: NUMBER_PAD_HEIGHT }]}
    >
      <View style={styles.headingRow}>
        <Text style={styles.heading}>Perfil</Text>
        <Pressable
          accessibilityLabel={hidden ? 'Mostrar mis datos' : 'Ocultar mis datos'}
          onPress={() => setHidden((value) => !value)}
          style={styles.reveal}
        >
          {hidden ? (
            <Eye size={16} color={theme.textFaint} strokeWidth={1.75} />
          ) : (
            <EyeOff size={16} color={theme.textFaint} strokeWidth={1.75} />
          )}
          <Text style={styles.revealText}>{hidden ? 'mostrar' : 'ocultar'}</Text>
        </Pressable>
      </View>
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
            {/* Un valor que no se guardo nunca se tapa: hay que poder ver que tiene
                de malo para arreglarlo. */}
            {hidden &&
            editing !== field.key &&
            draft.trim() !== '' &&
            !refused[field.key] &&
            problem === null ? (
              <Pressable
                accessibilityLabel={`Mostrar ${field.label}`}
                onPress={() => setHidden(false)}
                style={styles.input}
              >
                <Text style={styles.masked}>{'•'.repeat(Math.min(10, draft.trim().length))}</Text>
              </Pressable>
            ) : field.keyboard === 'numeric' ? (
              <NumericField
                value={draft}
                onChange={(text) => setDrafts((current) => ({ ...current, [field.key]: text }))}
                allowDecimal
                accessibilityLabel={field.label}
                onCommit={() => commit(field.key)}
                onFocus={() => setEditing(field.key)}
                onBlur={() => setEditing(null)}
                style={[styles.input, problem ? styles.inputBad : null]}
              />
            ) : (
              <TextInput
                value={draft}
                onChangeText={(text) => setDrafts((current) => ({ ...current, [field.key]: text }))}
                onFocus={() => setEditing(field.key)}
                onBlur={() => {
                  setEditing(null);
                  commit(field.key);
                }}
                onSubmitEditing={() => commit(field.key)}
                accessibilityLabel={field.label}
                style={[styles.input, problem ? styles.inputBad : null]}
              />
            )}
            <Text style={(problem ?? refused[field.key]) ? styles.problem : styles.hint}>
              {refused[field.key] ? `Sin guardar: ${refused[field.key]}` : (problem ?? field.hint)}
              {field.required && draft.trim() === '' ? ' Falta este.' : ''}
            </Text>
          </View>
        );
      })}

      <View style={styles.field}>
        <Text style={styles.label}>Fase</Text>
        <View style={styles.options}>
          {PHASES.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              selected={option.value === phase}
              onPress={() => onSaveSetting('phase', option.value)}
            />
          ))}
        </View>
      </View>

      <Text style={styles.heading}>Unidad de peso</Text>
      <View style={styles.options}>
        {(['lb', 'kg'] as const).map((option) => (
          <Chip
            key={option}
            label={option === 'lb' ? 'Libras' : 'Kilos'}
            selected={(settings.get('weight_unit') ?? 'lb') === option}
            onPress={() => onSaveSetting('weight_unit', option)}
          />
        ))}
      </View>
      <Text style={styles.hint}>
        Cómo ves y escribes el peso que levantas. Se guarda siempre igual por dentro, así que
        cambiarlo no altera nada de lo ya registrado. Tu peso corporal va aparte, en kilos.
      </Text>

      <Text style={styles.heading}>Peso de hoy</Text>
      <View style={styles.field}>
        {hidden && editing !== 'weight' && weightDraft.trim() !== '' ? (
          <Pressable
            accessibilityLabel="Mostrar el peso de hoy"
            onPress={() => setHidden(false)}
            style={styles.input}
          >
            <Text style={styles.masked}>{'•'.repeat(Math.min(10, weightDraft.trim().length))}</Text>
          </Pressable>
        ) : (
          <NumericField
            value={weightDraft}
            onChange={setWeightDraft}
            allowDecimal
            accessibilityLabel="Peso de hoy"
            onFocus={() => setEditing('weight')}
            onBlur={() => setEditing(null)}
            onCommit={() => {
              const parsed = Number(weightDraft);
              if (isBodyWeightKg(parsed)) onSaveWeight(parsed);
            }}
            style={styles.input}
          />
        )}
        <Text style={styles.hint}>
          El promedio de siete días es el que manda; un día suelto es agua y comida en el estómago.
        </Text>
      </View>

      <Text style={styles.heading}>Avisos</Text>
      <Text style={styles.hint}>
        Solo te avisa de lo que falta y nunca de lo que ya anotaste. Máximo{' '}
        {DEFAULT_NUDGE_RULES.maxPerDay} al día, nada entre las 21:30 y las 7:30, y el tipo de aviso
        que ignores tres veces seguidas se calla una semana solo.
      </Text>
      <View style={styles.options}>
        <Chip
          label={nudgesOn ? 'Encendidos' : 'Apagados'}
          accessibilityLabel={nudgesOn ? 'Apagar todos los avisos' : 'Encender los avisos'}
          selected={nudgesOn}
          onPress={() => onSaveSetting('nudges_enabled', nudgesOn ? 'false' : 'true')}
        />
      </View>
      {nudgesOn && (
        <View style={styles.options}>
          {NUDGE_SWITCHES.map((nudge) => {
            const on = !nudgesOff.includes(nudge.kind);
            return (
              <Chip
                key={nudge.kind}
                label={nudge.label}
                accessibilityLabel={`${on ? 'Apagar' : 'Encender'} los avisos de ${nudge.label}`}
                selected={on}
                onPress={() =>
                  onSaveSetting(
                    'nudges_off',
                    (on
                      ? [...nudgesOff, nudge.kind]
                      : nudgesOff.filter((kind) => kind !== nudge.kind)
                    ).join(','),
                  )
                }
              />
            );
          })}
        </View>
      )}

      <Text style={styles.heading}>Apariencia</Text>
      <View style={styles.options}>
        {THEME_MODES.map((option) => (
          <Chip
            key={option.value}
            label={option.label}
            accessibilityLabel={`Ver la app en modo ${option.label}`}
            selected={option.value === skin.mode}
            onPress={() => onSaveSetting('theme_mode', option.value)}
          />
        ))}
      </View>
      <Text style={styles.hint}>
        Claro es como se diseñó la app. Oscuro es la misma cosa con la tinta al revés. Como el
        iPhone sigue lo que tengas puesto en el sistema, y por horario lo cambia solo a las horas
        que digas.
      </Text>
      {skin.mode === 'horario' &&
        DARK_HOURS.map((hour) => {
          const draft = drafts[hour.key] ?? settings.get(hour.key) ?? '';
          return (
            <View key={hour.key} style={styles.field}>
              <Text style={styles.label}>{hour.label}</Text>
              <NumericField
                value={draft}
                onChange={(text) => setDrafts((current) => ({ ...current, [hour.key]: text }))}
                accessibilityLabel={hour.label}
                onCommit={() => commit(hour.key)}
                onFocus={() => setEditing(hour.key)}
                onBlur={() => setEditing(null)}
                style={[styles.input, refused[hour.key] ? styles.inputBad : null]}
              />
              {refused[hour.key] ? (
                <Text style={styles.problem}>Sin guardar: {refused[hour.key]}</Text>
              ) : null}
            </View>
          );
        })}

      <Text style={styles.heading}>Paleta</Text>
      <Text style={styles.hint}>
        Solo para los cuadritos de la cuadrícula. El resto de la app no cambia de color con esto.
      </Text>
      <PalettePicker selected={palette} onSelect={onSelectPalette} />

      <Text style={styles.heading}>Respaldo</Text>
      <Text style={styles.hint}>
        Un solo archivo JSON con todo lo registrado. Sirve para volver si se borra la app o cambias
        de teléfono, y es el mismo archivo que usarás para entrenar un modelo más adelante.
      </Text>
      <View style={styles.options}>
        <Button
          label="Exportar"
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
        />

        {confirmingImport ? (
          <>
            <Button
              label="Sí, reemplazar lo que hay"
              accessibilityLabel="Confirmar importación"
              variant="danger"
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
            />
            <Button
              label="Cancelar"
              accessibilityLabel="Cancelar importación"
              onPress={() => setConfirmingImport(false)}
            />
          </>
        ) : (
          <Button
            label="Importar"
            accessibilityLabel="Importar desde un archivo"
            disabled={busy}
            onPress={() => setConfirmingImport(true)}
          />
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
          <Button
            label="Sí, borrar todo lo registrado"
            accessibilityLabel="Confirmar borrado"
            variant="danger"
            onPress={() => {
              setConfirmingReset(false);
              onResetDatabase();
            }}
          />
          <Button
            label="Cancelar"
            accessibilityLabel="Cancelar borrado"
            onPress={() => setConfirmingReset(false)}
          />
        </View>
      ) : (
        <Button
          label="Borrar la base de datos"
          accessibilityLabel="Borrar la base de datos"
          onPress={() => setConfirmingReset(true)}
        />
      )}
    </ScrollView>
  );
}

const styles = sheet((theme) => ({
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
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reveal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  revealText: {
    fontSize: 12,
    color: theme.textFaint,
    fontFamily: font.bold,
  },
  masked: {
    fontSize: 15,
    color: theme.textFaint,
    fontFamily: font.black,
    letterSpacing: 2,
  },
  heading: {
    fontSize: 19,
    marginTop: 14,
    fontFamily: font.black,
    color: theme.text,
  },
  warning: {
    fontSize: 12,
    color: theme.textFaint,
    fontFamily: font.bold,
  },
  field: {
    gap: 4,
  },
  label: {
    fontSize: 13,
    color: theme.text,
    fontFamily: font.bold,
  },
  input: {
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.surface,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 15,
    fontFamily: font.bold,
    color: theme.text,
  },
  inputBad: {
    borderColor: theme.danger,
  },
  hint: {
    fontSize: 12,
    color: theme.textFaint,
    fontFamily: font.regular,
  },
  problem: {
    fontSize: 12,
    color: theme.danger,
    fontFamily: font.bold,
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
}));
