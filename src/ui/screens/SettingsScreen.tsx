import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { PaletteId } from '../../core/palettes.ts';
import { settingProblem, type SettingKey, type Settings } from '../../core/settings.ts';

import { PalettePicker } from '../PalettePicker.tsx';

const PHASES: { value: string; label: string }[] = [
  { value: 'recomp', label: 'Recomposición' },
  { value: 'cut', label: 'Déficit' },
  { value: 'maintain', label: 'Mantenimiento' },
  { value: 'bulk', label: 'Volumen' },
];

const FIELDS: { key: SettingKey; label: string; hint: string; keyboard: 'numeric' | 'default' }[] =
  [
    {
      key: 'height_cm',
      label: 'Estatura (cm)',
      hint: 'Necesaria para el gasto basal',
      keyboard: 'numeric',
    },
    { key: 'birth_date', label: 'Fecha de nacimiento', hint: 'AAAA-MM-DD', keyboard: 'default' },
    {
      key: 'activity_factor',
      label: 'Factor de actividad',
      hint: '1.55 a 1.60 con cinco sesiones por semana',
      keyboard: 'numeric',
    },
    {
      key: 'sleep_target_minutes',
      label: 'Meta de sueño (min)',
      hint: '420 son siete horas',
      keyboard: 'numeric',
    },
    {
      key: 'steps_target',
      label: 'Meta de pasos',
      hint: 'Sube por etapas, no de golpe',
      keyboard: 'numeric',
    },
    {
      key: 're_entry_started_on',
      label: 'Readaptación desde',
      hint: 'AAAA-MM-DD, vacío si no aplica',
      keyboard: 'default',
    },
    {
      key: 're_entry_weeks',
      label: 'Semanas de readaptación',
      hint: 'Tres por defecto',
      keyboard: 'numeric',
    },
  ];

export type SettingsScreenProps = {
  onResetDatabase: () => void;
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
  settings,
  palette,
  todayWeightKg,
  onSaveSetting,
  onClearSetting,
  onSaveWeight,
  onSelectPalette,
}: SettingsScreenProps) {
  const [confirmingReset, setConfirmingReset] = useState(false);
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
    <ScrollView style={styles.scroll} contentContainerStyle={styles.screen}>
      <Text style={styles.heading}>Perfil</Text>
      <Text style={styles.warning}>
        Estos datos solo viven en tu teléfono. No están escritos en el código ni se suben a ningún
        lado.
      </Text>

      {FIELDS.map((field) => {
        const draft = drafts[field.key] ?? settings.get(field.key) ?? '';
        const problem = draft.trim() === '' ? null : settingProblem(field.key, draft);
        return (
          <View key={field.key} style={styles.field}>
            <Text style={styles.label}>{field.label}</Text>
            <TextInput
              value={draft}
              onChangeText={(text) => setDrafts((current) => ({ ...current, [field.key]: text }))}
              onBlur={() => commit(field.key)}
              onSubmitEditing={() => commit(field.key)}
              keyboardType={field.keyboard}
              accessibilityLabel={field.label}
              style={[styles.input, problem ? styles.inputBad : null]}
            />
            <Text style={problem ? styles.problem : styles.hint}>{problem ?? field.hint}</Text>
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
        <TextInput
          value={weightDraft}
          onChangeText={setWeightDraft}
          onBlur={() => {
            const parsed = Number(weightDraft);
            if (Number.isFinite(parsed) && parsed > 0) onSaveWeight(parsed);
          }}
          keyboardType="numeric"
          accessibilityLabel="Peso de hoy"
          style={styles.input}
        />
        <Text style={styles.hint}>
          El promedio de siete días es el que manda; un día suelto es agua y comida en el estómago.
        </Text>
      </View>

      <Text style={styles.heading}>Paleta</Text>
      <PalettePicker selected={palette} onSelect={onSelectPalette} />

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
    backgroundColor: '#fff',
  },
  screen: {
    flexGrow: 1,
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 48,
    gap: 10,
  },
  heading: {
    fontSize: 14,
    marginTop: 8,
  },
  warning: {
    fontSize: 11,
    color: '#888',
  },
  field: {
    gap: 3,
  },
  label: {
    fontSize: 12,
    color: '#444',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  inputBad: {
    borderColor: '#8a1f11',
  },
  hint: {
    fontSize: 10,
    color: '#999',
  },
  problem: {
    fontSize: 10,
    color: '#8a1f11',
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  option: {
    borderWidth: 1,
    borderColor: '#e2e2e2',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  optionSelected: {
    borderColor: '#555',
    backgroundColor: '#f3f3f3',
  },
  optionText: {
    fontSize: 12,
  },
  danger: {
    borderColor: '#8a1f11',
  },
  dangerText: {
    fontSize: 12,
    color: '#8a1f11',
  },
});
