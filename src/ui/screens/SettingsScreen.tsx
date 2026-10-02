import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { todayIso } from '../../core/dates.ts';
import { type NudgeKind } from '../../core/nudges.ts';
import type { PaletteId } from '../../core/palettes.ts';
import { exportNote } from '../../shell/backup-file.ts';
import {
  nudgesEnabled,
  nudgesOffFrom,
  settingDefault,
  settingProblem,
  type SettingKey,
  type Settings,
} from '../../core/settings.ts';

import { Button } from '../Button.tsx';
import { Card } from '../Card.tsx';
import { Chip } from '../Chip.tsx';
import { ChevronRight, Eye, EyeOff } from '../icons.ts';
import { IconButton } from '../IconButton.tsx';
import { NumericField } from '../NumericField.tsx';
import { TextField } from '../TextField.tsx';
import { PalettePicker } from '../PalettePicker.tsx';
import { Toggle } from '../Toggle.tsx';
import { font, sheet, shape } from '../theme.ts';

import { Screen } from './Screen.tsx';

const PHASES: { value: string; label: string }[] = [
  { value: 'recomp', label: 'Recomposición' },
  { value: 'cut', label: 'Déficit' },
  { value: 'maintain', label: 'Mantenimiento' },
  { value: 'bulk', label: 'Volumen' },
];

type FieldSpec = {
  key: SettingKey;
  label: string;
  keyboard: 'numeric' | 'default';
  placeholder?: string;
  /** Sin esto no hay metas, y sin metas ningun dia tiene nota. Va con asterisco. */
  required?: boolean;
  /** Se tapa con puntos hasta que el toque el ojo: es suyo y de nadie mas. */
  secret?: boolean;
};

/** Lo que hace falta para calcular las metas. */
const PROFILE_FIELDS: FieldSpec[] = [
  { key: 'height_cm', label: 'Estatura (cm)', keyboard: 'numeric', required: true, secret: true },
  {
    key: 'birth_date',
    label: 'Fecha de nacimiento',
    keyboard: 'default',
    placeholder: '1999-04-27',
    required: true,
    secret: true,
  },
  { key: 'activity_factor', label: 'Factor de actividad', keyboard: 'numeric' },
];

/** Spec 6.5: volver de un paron largo no penaliza los entrenos que falten. */
const RE_ENTRY_FIELDS: FieldSpec[] = [
  { key: 're_entry_started_on', label: 'Desde', keyboard: 'default', placeholder: '2026-09-27' },
  { key: 're_entry_weeks', label: 'Semanas', keyboard: 'numeric' },
];

export type SettingsScreenProps = {
  onResetDatabase: () => void;
  /** Escribe el archivo y abre la hoja de compartir. */
  onExport: () => Promise<{ uri: string; bytes: number; shared: boolean }>;
  /** Null cuando cierra el selector sin elegir. Rechaza con el motivo si el archivo no sirve. */
  onImport: () => Promise<{ tables: number; rows: number; skipped: string[] } | null>;
  settings: Settings;
  palette: PaletteId;
  onSaveSetting: (key: SettingKey, value: string) => void;
  onClearSetting: (key: SettingKey) => void;
  onSelectPalette: (palette: PaletteId) => void;
  /** Llevan a las dos pantallas donde edita los catalogos. */
  onOpenExercises: () => void;
  onOpenFoods: () => void;
};

/** Los cinco que puede apagar por su lado. El resumen del domingo va con el cierre. */
const NUDGE_SWITCHES: { kind: NudgeKind; label: string }[] = [
  { kind: 'comida', label: 'Comida' },
  { kind: 'entreno', label: 'Entreno' },
  { kind: 'agua', label: 'Agua' },
  { kind: 'manana', label: 'Mañana' },
  { kind: 'cierre', label: 'Cierre del día' },
];

/** El nombre de un dato encima de su casilla, en mayusculas como en el catalogo. */
function Field({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label}
        {required ? ' *' : ''}
      </Text>
      {children}
    </View>
  );
}

/** El titulo de una cartilla con su interruptor o su boton al lado. */
function Head({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.head}>
      <Text style={styles.headTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function SettingsScreen({
  onResetDatabase,
  onExport,
  onImport,
  settings,
  palette,
  onSaveSetting,
  onClearSetting,
  onSelectPalette,
  onOpenExercises,
  onOpenFoods,
}: SettingsScreenProps) {
  const [confirmingReset, setConfirmingReset] = useState(false);
  // Lo que no paso la validacion, para que no parezca guardado.
  const [refused, setRefused] = useState<Partial<Record<SettingKey, string>>>({});
  const nudgesOn = nudgesEnabled(settings);
  const nudgesOff = nudgesOffFrom(settings);
  // Su estatura y su fecha de nacimiento no tienen por que verse desde el asiento de
  // al lado. Tapar con puntos lo que esta escribiendo en ese momento seria escribir a
  // ciegas, asi que el campo abierto se ve y se vuelve a tapar al salir de el.
  const [hidden, setHidden] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmingImport, setConfirmingImport] = useState(false);
  // Cual de las dos esta trabajando, para que gire solo el boton que se toco.
  const [busy, setBusy] = useState<'exportar' | 'importar' | null>(null);
  const [backupNote, setBackupNote] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<SettingKey, string>>>({});

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

  // La casilla de un ajuste, y debajo solo el motivo si algo no se pudo guardar.
  const renderField = (field: FieldSpec) => {
    const draft = drafts[field.key] ?? settings.get(field.key) ?? '';
    const problem = draft.trim() === '' ? null : settingProblem(field.key, draft);
    const masked =
      field.secret === true &&
      hidden &&
      editing !== field.key &&
      draft.trim() !== '' &&
      !refused[field.key] &&
      problem === null;

    return (
      <Field key={field.key} label={field.label} required={field.required}>
        {masked ? (
          <Pressable
            accessibilityLabel={`Mostrar ${field.label}`}
            onPress={() => setHidden(false)}
            style={({ pressed }) => [styles.input, pressed && styles.inputPressed]}
          >
            <Text style={styles.masked}>{'•'.repeat(Math.min(10, draft.trim().length))}</Text>
          </Pressable>
        ) : field.keyboard === 'numeric' ? (
          <NumericField
            value={draft}
            onChange={(text) => setDrafts((current) => ({ ...current, [field.key]: text }))}
            allowDecimal
            accessibilityLabel={field.label}
            placeholder={field.placeholder ?? settingDefault(field.key) ?? undefined}
            onCommit={() => commit(field.key)}
            onFocus={() => setEditing(field.key)}
            onBlur={() => setEditing(null)}
            style={[styles.input, problem ? styles.inputBad : null]}
            focusedStyle={styles.inputWriting}
          />
        ) : (
          <TextField
            value={draft}
            onChange={(text) => setDrafts((current) => ({ ...current, [field.key]: text }))}
            onFocus={() => setEditing(field.key)}
            onBlur={() => setEditing(null)}
            onCommit={() => commit(field.key)}
            autoCapitalize="none"
            accessibilityLabel={field.label}
            placeholder={field.placeholder ?? settingDefault(field.key) ?? undefined}
            style={[styles.input, problem ? styles.inputBad : null]}
            focusedStyle={styles.inputWriting}
          />
        )}
        {(problem ?? refused[field.key]) && (
          <Text style={styles.problem}>
            {refused[field.key] ? `Sin guardar: ${refused[field.key]}` : problem}
          </Text>
        )}
      </Field>
    );
  };

  const phase = settings.get('phase') ?? 'recomp';
  const readapting = (settings.get('re_entry_started_on') ?? '') !== '';

  // La meta de sueno se guarda en minutos, pero nadie piensa en minutos: se escribe
  // en horas y minutos y se suma al guardar.
  const storedSleep = Number(
    settings.get('sleep_target_minutes') ?? settingDefault('sleep_target_minutes'),
  );
  const [sleepHours, setSleepHours] = useState(String(Math.floor(storedSleep / 60)));
  // En blanco cuando son cero: el 0 lo escribia la app al guardar y el no lo habia
  // tecleado. Vacio y cero son lo mismo al sumar, y el gris de la casilla lo dice.
  const [sleepMinutes, setSleepMinutes] = useState(
    storedSleep % 60 === 0 ? '' : String(storedSleep % 60),
  );
  const commitSleep = () => {
    const total = (Number(sleepHours) || 0) * 60 + (Number(sleepMinutes) || 0);
    const problem = settingProblem('sleep_target_minutes', String(total));
    setRefused((current) => ({ ...current, sleep_target_minutes: problem ?? undefined }));
    if (problem === null) onSaveSetting('sleep_target_minutes', String(total));
  };

  return (
    <Screen title="Ajustes">
      <Card>
        <Head title="Perfil">
          <IconButton
            icon={hidden ? Eye : EyeOff}
            accessibilityLabel={hidden ? 'Mostrar mis datos' : 'Ocultar mis datos'}
            selected={!hidden}
            onPress={() => setHidden((value) => !value)}
          />
        </Head>

        {PROFILE_FIELDS.map(renderField)}

        <Field label="Fase">
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
        </Field>

        <Field label="Unidad de peso">
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
        </Field>
      </Card>

      <Card title="Metas">
        <Field label="Sueño">
          <View style={styles.row}>
            <NumericField
              value={sleepHours}
              onChange={setSleepHours}
              accessibilityLabel="Horas de sueño"
              onCommit={commitSleep}
              onFocus={() => setEditing('sleep')}
              onBlur={() => setEditing(null)}
              style={[styles.input, styles.short]}
              focusedStyle={styles.inputWriting}
            />
            <Text style={styles.unit}>h</Text>
            <NumericField
              value={sleepMinutes}
              onChange={setSleepMinutes}
              placeholder="0"
              accessibilityLabel="Minutos de sueño"
              onCommit={commitSleep}
              onFocus={() => setEditing('sleep')}
              onBlur={() => setEditing(null)}
              style={[styles.input, styles.short]}
              focusedStyle={styles.inputWriting}
            />
            <Text style={styles.unit}>min</Text>
          </View>
          {refused.sleep_target_minutes && (
            <Text style={styles.problem}>Sin guardar: {refused.sleep_target_minutes}</Text>
          )}
        </Field>

        {renderField({ key: 'steps_target', label: 'Pasos', keyboard: 'numeric' })}
      </Card>

      {/* Cartilla con interruptor, como las paletas: el interruptor es el dato. Con el
          apagado no hay readaptacion que configurar, asi que los campos no estan. */}
      <Card>
        <Head title="Readaptación">
          <Toggle
            value={readapting}
            accessibilityLabel={readapting ? 'Terminar la readaptación' : 'Estoy readaptando'}
            onChange={(next) => {
              if (next) onSaveSetting('re_entry_started_on', todayIso());
              else onClearSetting('re_entry_started_on');
              setDrafts((current) => ({ ...current, re_entry_started_on: undefined }));
            }}
          />
        </Head>
        {readapting && RE_ENTRY_FIELDS.map(renderField)}
      </Card>

      <Card title="Avisos">
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Todos los avisos</Text>
          <Toggle
            value={nudgesOn}
            accessibilityLabel={nudgesOn ? 'Apagar todos los avisos' : 'Encender los avisos'}
            onChange={(next) => onSaveSetting('nudges_enabled', next ? 'true' : 'false')}
          />
        </View>
        {/* Con el interruptor general apagado se quedan a la vista pero muertos: asi
            se sabe que existen y la lista no salta de alto al prenderlos. */}
        {NUDGE_SWITCHES.map((nudge) => {
          const on = !nudgesOff.includes(nudge.kind);
          return (
            <View key={nudge.kind} style={[styles.switchRow, styles.switchRuled]}>
              <Text style={[styles.switchLabel, !nudgesOn && styles.switchLabelOff]}>
                {nudge.label}
              </Text>
              <Toggle
                value={on}
                disabled={!nudgesOn}
                accessibilityLabel={`${on ? 'Apagar' : 'Encender'} los avisos de ${nudge.label.toLowerCase()}`}
                onChange={(next) =>
                  onSaveSetting(
                    'nudges_off',
                    (next
                      ? nudgesOff.filter((kind) => kind !== nudge.kind)
                      : [...nudgesOff, nudge.kind]
                    ).join(','),
                  )
                }
              />
            </View>
          );
        })}
      </Card>

      <Card title="Ofertas">
        <Field label="Palabras que vigilo">
          <TextField
            value={settings.get('deal_watchlist') ?? settingDefault('deal_watchlist') ?? ''}
            onChange={(text) => onSaveSetting('deal_watchlist', text)}
            accessibilityLabel="Palabras que vigilo en las ofertas"
            placeholder="chicken, eggs, milk"
            autoCapitalize="none"
            style={styles.input}
            focusedStyle={styles.inputWriting}
          />
        </Field>
        <Text style={styles.note}>
          Separadas por coma. Si la palabra aparece en el nombre o en la letra chica, la oferta te
          sale al abrir la app.
        </Text>

        <Field label="Palabras que ignoro">
          <TextField
            value={settings.get('deal_blocklist') ?? settingDefault('deal_blocklist') ?? ''}
            onChange={(text) => onSaveSetting('deal_blocklist', text)}
            accessibilityLabel="Palabras que ignoro en las ofertas"
            placeholder="chocolate, coconut, condensed"
            autoCapitalize="none"
            style={styles.input}
            focusedStyle={styles.inputWriting}
          />
        </Field>
        <Text style={styles.note}>
          Estas mandan: una oferta con una de ellas no sale, aunque vigiles otra que sí tenga.
        </Text>
      </Card>

      <Card title="Catálogo">
        <Button
          label="Ejercicios"
          accessibilityLabel="Editar los ejercicios"
          icon={ChevronRight}
          block
          onPress={onOpenExercises}
        />
        <Button
          label="Comidas"
          accessibilityLabel="Editar los alimentos"
          icon={ChevronRight}
          block
          onPress={onOpenFoods}
        />
      </Card>

      {/* Sin cartilla alrededor: cada paleta ya es una, y una cartilla dentro de otra
          se lee como un error de dibujo. */}
      <Text style={styles.heading}>Paleta</Text>
      <PalettePicker selected={palette} onSelect={onSelectPalette} />

      <Card title="Respaldo">
        <View style={styles.options}>
          <Button
            label="Exportar"
            accessibilityLabel="Exportar todo a un archivo"
            loading={busy === 'exportar'}
            disabled={busy !== null}
            style={styles.grow}
            onPress={() => {
              setBusy('exportar');
              setBackupNote('Escribiendo…');
              onExport()
                .then((outcome) => setBackupNote(exportNote(outcome)))
                .catch((error: unknown) => {
                  setBackupNote(error instanceof Error ? error.message : String(error));
                })
                .finally(() => setBusy(null));
            }}
          />

          {confirmingImport ? (
            <>
              <Button
                label="Sí, reemplazar lo que hay"
                accessibilityLabel="Confirmar importación"
                variant="danger"
                loading={busy === 'importar'}
                disabled={busy !== null}
                block
                onPress={() => {
                  setConfirmingImport(false);
                  setBusy('importar');
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
                    .finally(() => setBusy(null));
                }}
              />
              <Button
                label="Cancelar"
                accessibilityLabel="Cancelar importación"
                block
                onPress={() => setConfirmingImport(false)}
              />
            </>
          ) : (
            <Button
              label="Importar"
              accessibilityLabel="Importar desde un archivo"
              loading={busy === 'importar'}
              disabled={busy !== null}
              style={styles.grow}
              onPress={() => setConfirmingImport(true)}
            />
          )}
        </View>
        {backupNote && <Text style={styles.note}>{backupNote}</Text>}
      </Card>

      <Card title="Base de datos">
        {confirmingReset ? (
          <>
            <Button
              label="Sí, borrar todo lo registrado"
              accessibilityLabel="Confirmar borrado"
              variant="danger"
              block
              onPress={() => {
                setConfirmingReset(false);
                onResetDatabase();
              }}
            />
            <Button
              label="Cancelar"
              accessibilityLabel="Cancelar borrado"
              block
              onPress={() => setConfirmingReset(false)}
            />
          </>
        ) : (
          <Button
            label="Borrar y empezar de cero"
            accessibilityLabel="Borrar la base de datos"
            block
            onPress={() => setConfirmingReset(true)}
          />
        )}
      </Card>
    </Screen>
  );
}

const styles = sheet((theme) => ({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 34,
  },
  headTitle: {
    fontSize: 16,
    fontFamily: font.black,
    color: theme.text,
  },
  heading: {
    fontSize: 16,
    fontFamily: font.black,
    color: theme.text,
    marginTop: 4,
  },
  field: {
    gap: 5,
  },
  label: {
    fontSize: 12,
    fontFamily: font.black,
    letterSpacing: 0.6,
    color: theme.textFaint,
    textTransform: 'uppercase',
  },
  masked: {
    fontSize: 15,
    color: theme.textFaint,
    fontFamily: font.black,
    letterSpacing: 2,
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
  short: {
    width: 72,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  unit: {
    fontSize: 13,
    fontFamily: font.bold,
    color: theme.textFaint,
  },
  inputWriting: {
    backgroundColor: theme.surfaceHigh,
  },
  inputPressed: {
    opacity: 0.6,
  },
  inputBad: {
    borderColor: theme.danger,
  },
  note: {
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
  grow: {
    flexGrow: 1,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 44,
  },
  switchRuled: {
    borderTopWidth: shape.border,
    borderTopColor: theme.line,
    paddingTop: 6,
  },
  switchLabel: {
    flexShrink: 1,
    fontSize: 15,
    fontFamily: font.bold,
    color: theme.text,
  },
  switchLabelOff: {
    color: theme.textGhost,
  },
}));
