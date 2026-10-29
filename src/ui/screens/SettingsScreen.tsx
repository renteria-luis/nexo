import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { todayIso } from '../../core/dates.ts';
import { scoreScaleFrom, type ScoreScaleOptions } from '../../core/palettes.ts';
import { type NudgeKind } from '../../core/nudges.ts';
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
import { AssistantSettings } from '../AssistantSettings.tsx';
import { Card } from '../Card.tsx';
import { Chip } from '../Chip.tsx';
import {
  Bell,
  Bot,
  ChevronRight,
  Database,
  Eye,
  EyeOff,
  Palette,
  Tag,
  UserRound,
  type LucideIcon,
} from '../icons.ts';
import { IconButton } from '../IconButton.tsx';
import { InfoDot, InfoText } from '../InfoBubble.tsx';
import { NumericField } from '../NumericField.tsx';
import { TextField } from '../TextField.tsx';
import { ScoreScale } from '../ScoreScale.tsx';
import { Toggle } from '../Toggle.tsx';
import { font, rowBleed, sheet, shape, theme } from '../theme.ts';

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
  /** Lo que es, en la (i) y no debajo: un parrafo bajo cada casilla llenaba la pagina. */
  info?: string;
};

/** Lo que hace falta para calcular las metas. */
const PROFILE_FIELDS: FieldSpec[] = [
  { key: 'height_cm', label: 'Estatura (cm)', keyboard: 'numeric', required: true, secret: true },
  {
    key: 'birth_date',
    label: 'Fecha de nacimiento',
    keyboard: 'default',
    placeholder: 'aaaa-mm-dd',
    required: true,
    secret: true,
  },
  {
    key: 'activity_factor',
    label: 'Factor de actividad',
    keyboard: 'numeric',
    placeholder: 'Por defecto: 1.58',
    info: 'Cuánto te mueves en el día. Multiplica lo que gastas en reposo para calcular tus calorías: con trabajo de escritorio y cinco entrenos a la semana va de 1.55 a 1.60. Vacío, usa 1.58.',
  },
];

/** Spec 6.5: volver de un paron largo no penaliza los entrenos que falten. */
const RE_ENTRY_FIELDS: FieldSpec[] = [
  { key: 're_entry_started_on', label: 'Desde', keyboard: 'default', placeholder: 'aaaa-mm-dd' },
  { key: 're_entry_weeks', label: 'Semanas', keyboard: 'numeric' },
];

export type SettingsScreenProps = {
  transitSettings?: React.ReactNode;
  onResetDatabase: () => void;
  /** Escribe el archivo y abre la hoja de compartir. */
  onExport: () => Promise<{ uri: string; bytes: number; shared: boolean }>;
  /** Null cuando cierra el selector sin elegir. Rechaza con el motivo si el archivo no sirve. */
  onImport: () => Promise<{ tables: number; rows: number; skipped: string[] } | null>;
  settings: Settings;
  onSaveScoreScale: (scale: ScoreScaleOptions) => Promise<void>;
  onSaveSetting: (key: SettingKey, value: string) => void;
  onClearSetting: (key: SettingKey) => void;
  onOpenBackgrounds: () => void;
  /** La seccion abierta; sin ella, la lista de secciones. */
  section?: SettingsSection;
  onOpenSection: (section: SettingsSection) => void;
};

export type SettingsSection =
  'perfil' | 'avisos' | 'asistente' | 'ofertas' | 'apariencia' | 'datos';

/**
 * Ajustes por tipo de ajuste, como los de iOS: una lista corta que abre cada seccion. En una
 * sola pagina eran once tarjetas seguidas sin indice (2026-10-25, a peticion suya). El
 * catalogo ya no esta aqui: es del menu.
 */
export const SETTINGS_SECTIONS: { id: SettingsSection; title: string; icon: LucideIcon }[] = [
  { id: 'perfil', title: 'Perfil y metas', icon: UserRound },
  { id: 'avisos', title: 'Avisos', icon: Bell },
  { id: 'asistente', title: 'Asistente', icon: Bot },
  { id: 'ofertas', title: 'Ofertas', icon: Tag },
  { id: 'apariencia', title: 'Apariencia', icon: Palette },
  { id: 'datos', title: 'Respaldo y datos', icon: Database },
];

/** Los cinco que puede apagar por su lado. El resumen del domingo va con el cierre. */
const NUDGE_SWITCHES: { kind: NudgeKind; label: string; info: string }[] = [
  {
    kind: 'comida',
    label: 'Comida',
    info: '40 minutos después de la hora a la que sueles anotar cada comida, si ese espacio sigue vacío.',
  },
  {
    kind: 'entreno',
    label: 'Entreno',
    info: 'A la hora a la que sueles entrenar, si hoy no entrenaste y te faltan sesiones para las cinco de la semana.',
  },
  {
    kind: 'agua',
    label: 'Agua',
    info: 'A las 16:30, si llevas menos de la mitad del agua del día.',
  },
  {
    kind: 'manana',
    label: 'Mañana',
    info: 'Media hora después de lo primero que sueles anotar en el día, si todavía falta el sueño o el peso.',
  },
  {
    kind: 'cierre',
    label: 'Cierre del día',
    info: 'A las 21:00, si el día tiene menos de tres cosas anotadas. Los domingos trae el resumen de la semana.',
  },
  {
    kind: 'creatina',
    label: 'Creatina',
    info: 'A las 11:30 y a las 22:00, mientras no anotes la creatina del día.',
  },
];

/** El nombre de un dato encima de su casilla, en mayusculas como en el catalogo. */
function Field({
  label,
  required = false,
  info,
  children,
}: {
  label: string;
  required?: boolean;
  info?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>
          {label}
          {required ? ' *' : ''}
        </Text>
        {info && (
          <InfoDot accessibilityLabel={`Qué es ${label.toLowerCase()}`}>
            <InfoText>{info}</InfoText>
          </InfoDot>
        )}
      </View>
      {children}
    </View>
  );
}

/** El titulo de una cartilla con su interruptor o su boton al lado. */
function Head({
  title,
  info,
  children,
}: {
  title: string;
  info?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.head}>
      <View style={styles.labelRow}>
        <Text style={styles.headTitle}>{title}</Text>
        {info && (
          <InfoDot accessibilityLabel={`Qué es ${title.toLowerCase()}`}>
            <InfoText>{info}</InfoText>
          </InfoDot>
        )}
      </View>
      {children}
    </View>
  );
}

export function SettingsScreen({
  onResetDatabase,
  onExport,
  onImport,
  settings,
  onSaveScoreScale,
  onSaveSetting,
  onClearSetting,
  onOpenBackgrounds,
  transitSettings,
  section,
  onOpenSection,
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
      <Field key={field.key} label={field.label} required={field.required} info={field.info}>
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

  const missingProfile = PROFILE_FIELDS.filter(
    (field) => field.required === true && (settings.get(field.key) ?? '').trim() === '',
  ).map((field) => field.label.replace(/ \(.*\)$/, '').toLowerCase());

  if (section === undefined) {
    return (
      <Screen title="Ajustes">
        <Card>
          {SETTINGS_SECTIONS.map((one, index) => {
            const Icon = one.icon;
            const detail =
              one.id === 'perfil' && missingProfile.length > 0
                ? `Falta${missingProfile.length > 1 ? 'n' : ''} ${missingProfile.join(' y ')}`
                : null;
            return (
              <Pressable
                key={one.id}
                accessibilityRole="button"
                accessibilityLabel={detail ? `${one.title}, ${detail}` : one.title}
                onPress={() => onOpenSection(one.id)}
                style={({ pressed }) => [
                  styles.sectionRow,
                  index > 0 && styles.switchRuled,
                  pressed && styles.inputPressed,
                ]}
              >
                <View style={styles.sectionIcon}>
                  <Icon size={18} color={theme.text} strokeWidth={2.25} />
                </View>
                <View style={styles.fill}>
                  <Text style={styles.switchLabel}>{one.title}</Text>
                  {detail && <Text style={styles.warnNote}>{detail}</Text>}
                </View>
                <ChevronRight size={18} color={theme.textFaint} strokeWidth={2.5} />
              </Pressable>
            );
          })}
        </Card>
      </Screen>
    );
  }

  const title = SETTINGS_SECTIONS.find((one) => one.id === section)?.title ?? 'Ajustes';
  return (
    <Screen title={title}>
      {section === 'perfil' && (
        <>
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

            <Field
              label="Fase"
              info="Cuántas calorías te tocan: recomposición come un 8% menos de lo que gastas, déficit un 20% menos, mantenimiento lo mismo y volumen un 10% más."
            >
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

            <Field
              label="Unidad de peso"
              info="La de las cargas del gym. Tu peso corporal va siempre en kilos."
            >
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

            {renderField({
              key: 'steps_target',
              label: 'Pasos',
              keyboard: 'numeric',
              placeholder: 'Por defecto: 7 000',
            })}
          </Card>

          {/* Cartilla con interruptor, como las paletas: el interruptor es el dato. Con el
          apagado no hay readaptacion que configurar, asi que los campos no estan. */}
          <Card>
            <Head
              title="Readaptación"
              info="Para volver después de una pausa. Mientras dura, tus series se comparan solo con las de este periodo, no hay avisos de récords y faltar a un entreno no resta."
            >
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
        </>
      )}
      {section === 'avisos' && (
        <>
          <Card>
            {/* El interruptor de todos va en el titulo, como Readaptación: en su propia fila
            decia «Avisos de salud y creatina» debajo de «Avisos de salud» y encima de
            «Creatina». */}
            <Head title="Avisos de salud">
              <Toggle
                value={nudgesOn}
                accessibilityLabel={
                  nudgesOn ? 'Apagar todos los avisos de salud' : 'Encender los avisos de salud'
                }
                onChange={(next) => onSaveSetting('nudges_enabled', next ? 'true' : 'false')}
              />
            </Head>
            {/* Con el interruptor general apagado se quedan a la vista pero muertos: asi
            se sabe que existen y la lista no salta de alto al prenderlos. */}
            {NUDGE_SWITCHES.map((nudge) => {
              const on = !nudgesOff.includes(nudge.kind);
              return (
                <View key={nudge.kind} style={[styles.switchRow, styles.switchRuled]}>
                  <View style={styles.labelRow}>
                    <Text style={[styles.switchLabel, !nudgesOn && styles.switchLabelOff]}>
                      {nudge.label}
                    </Text>
                    <InfoDot accessibilityLabel={`Cuándo avisa ${nudge.label.toLowerCase()}`}>
                      <InfoText>{nudge.info}</InfoText>
                    </InfoDot>
                  </View>
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

          {transitSettings}
        </>
      )}
      {section === 'asistente' && <AssistantSettings />}
      {section === 'ofertas' && (
        <>
          {/* Sin titulo: la seccion ya se llama Ofertas. */}
          <Card>
            {/* Varias lineas: en una sola la lista corria de lado y casi toda quedaba fuera
                de la vista (2026-10-25). */}
            <Field
              label="Palabras que vigilo"
              info="Separadas por coma. Si la palabra aparece en el nombre o en la letra chica, la oferta te sale al abrir la app."
            >
              <TextField
                value={settings.get('deal_watchlist') ?? settingDefault('deal_watchlist') ?? ''}
                onChange={(text) => onSaveSetting('deal_watchlist', text)}
                accessibilityLabel="Palabras que vigilo en las ofertas"
                placeholder="chicken, eggs, milk"
                autoCapitalize="none"
                multiline
                style={[styles.input, styles.words]}
                focusedStyle={styles.inputWriting}
              />
            </Field>
            <Field
              label="Palabras que ignoro"
              info="Estas mandan: una oferta con una de ellas no sale, aunque vigiles otra que sí tenga."
            >
              <TextField
                value={settings.get('deal_blocklist') ?? settingDefault('deal_blocklist') ?? ''}
                onChange={(text) => onSaveSetting('deal_blocklist', text)}
                accessibilityLabel="Palabras que ignoro en las ofertas"
                placeholder="chocolate, coconut, condensed"
                autoCapitalize="none"
                multiline
                style={[styles.input, styles.words]}
                focusedStyle={styles.inputWriting}
              />
            </Field>
          </Card>
        </>
      )}
      {section === 'apariencia' && (
        <>
          <Card
            title="Fondos"
            action={
              <InfoDot accessibilityLabel="Qué son los fondos">
                <InfoText>Un color, un degradado o una foto tuya detrás de cada pantalla.</InfoText>
              </InfoDot>
            }
          >
            <Button
              label="Elegir fondos"
              accessibilityLabel="Elegir los fondos de las pantallas"
              block
              onPress={onOpenBackgrounds}
            />
          </Card>

          <ScoreScale
            value={scoreScaleFrom(settings.get('score_scale'))}
            onSave={onSaveScoreScale}
          />
        </>
      )}
      {section === 'datos' && (
        <>
          <Card title="Respaldo">
            {/* Confirmando, Exportar no tiene que ver: con el, "Cancelar" quedaba solo en
            otro renglon. Apiladas, como las de borrar todo (2026-10-24). */}
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
                          'Respaldo importado.' +
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

                <Button
                  label="Importar"
                  accessibilityLabel="Importar desde un archivo"
                  loading={busy === 'importar'}
                  disabled={busy !== null}
                  style={styles.grow}
                  onPress={() => setConfirmingImport(true)}
                />
              </View>
            )}
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
        </>
      )}
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
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  // Las palabras se leen enteras y la casilla crece con ellas, hasta unas seis lineas.
  words: {
    minHeight: 44,
    maxHeight: 140,
    textAlignVertical: 'top',
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
  // Una fila por seccion, del ancho de la tarjeta para que el toque llegue a la orilla.
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingVertical: 6,
    ...rowBleed,
  },
  sectionIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: shape.border,
    borderColor: theme.line,
    backgroundColor: theme.surfaceHigh,
  },
  fill: {
    flex: 1,
  },
  warnNote: {
    fontSize: 12,
    fontFamily: font.bold,
    color: theme.warn,
  },
}));
