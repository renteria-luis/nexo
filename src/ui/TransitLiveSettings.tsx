import { useState, type ReactNode } from 'react';
import { Platform, Text, View } from 'react-native';

import type { TransitLiveConfig } from '../shell/transit-live.ts';
import { liveFreshness, type TransitLiveState } from '../transit/realtime.ts';
import { Button } from './Button.tsx';
import { IconButton } from './IconButton.tsx';
import { Eye, EyeOff, X } from './icons.ts';
import { PopupSheet } from './PopupSheet.tsx';
import { TextField } from './TextField.tsx';
import { useLiveClock } from './TransitDepartures.tsx';
import { LiveDot, NotLiveDot } from './TransitStatus.tsx';
import { font, shape, sheet } from './theme.ts';

export function TransitLiveSettings({
  config,
  error,
  state,
  active,
  onSave,
  onClear,
  onClose,
  children,
}: {
  config: TransitLiveConfig | null;
  error: string | null;
  state: TransitLiveState;
  active: boolean;
  onSave: (config: TransitLiveConfig) => Promise<void>;
  onClear: () => Promise<void>;
  onClose: () => void;
  /** More about where Transit's data comes from, below the connection. */
  children?: ReactNode;
}) {
  const [endpoint, setEndpoint] = useState(config?.endpoint ?? '');
  const [credential, setCredential] = useState(config?.credential ?? '');
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const now = useLiveClock(active, state.snapshot);
  const connected =
    !!config &&
    !error &&
    !state.reason &&
    !!state.lastSuccessAt &&
    !!state.snapshot &&
    (['trips', 'vehicles'] as const).every((source) =>
      liveFreshness(state.snapshot!, source, state.snapshot!.health[source].feedTimestamp, now),
    );
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    setSaved(false);
    try {
      await onSave({ endpoint: endpoint.trim(), credential: credential.trim() });
      setRevealed(false);
      setSaved(true);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <PopupSheet>
      <View style={styles.row}>
        <Text style={styles.title}>Conexión en vivo</Text>
        {connected ? <LiveDot /> : <NotLiveDot />}
        <View style={styles.grow} />
        <IconButton
          icon={X}
          accessibilityLabel="Cerrar conexión en vivo"
          onPress={onClose}
          disabled={busy}
        />
      </View>
      <Text style={styles.note}>
        {connected
          ? 'Recibiendo tiempos y buses en vivo.'
          : state.loading
            ? 'Comprobando conexión…'
            : config
              ? 'Sin datos en vivo actuales. Revisa la conexión.'
              : 'Configura el servicio para ver tiempos y buses en vivo.'}
      </Text>
      {(problem || error || (config && state.reason)) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {problem || error || state.reason}
        </Text>
      )}
      <Text style={styles.label}>Enlace</Text>
      <TextField
        accessibilityLabel="URL del servicio Transit"
        placeholder="https://tu-proyecto.vercel.app/api/live"
        value={endpoint}
        onChange={(value) => {
          setEndpoint(value);
          setSaved(false);
        }}
        autoCapitalize="none"
        style={styles.input}
      />
      <Text style={styles.label}>Clave</Text>
      <View style={styles.row}>
        <TextField
          accessibilityLabel="Clave de conexión Transit"
          placeholder="Clave de instalación"
          value={credential}
          onChange={(value) => {
            setCredential(value);
            setSaved(false);
          }}
          autoCapitalize="none"
          secureTextEntry={!revealed}
          style={[styles.input, styles.grow]}
        />
        <IconButton
          icon={revealed ? EyeOff : Eye}
          accessibilityLabel={revealed ? 'Ocultar clave' : 'Mostrar clave'}
          onPress={() => setRevealed(!revealed)}
        />
      </View>
      <Text style={styles.note}>
        {Platform.OS === 'web'
          ? 'La conexión se conserva solo durante esta sesión del navegador.'
          : 'La clave se guarda en el almacenamiento seguro del iPhone.'}
      </Text>
      {saved && <Text style={styles.note}>Conexión guardada.</Text>}
      <Button
        label="Guardar conexión"
        variant="primary"
        loading={busy}
        onPress={() => void save()}
      />
      {config && (
        <Button
          label="Desconectar"
          variant="ghost"
          disabled={busy}
          onPress={() => {
            setBusy(true);
            setProblem(null);
            void onClear()
              .then(() => {
                setEndpoint('');
                setCredential('');
                setRevealed(false);
                setSaved(false);
              })
              .catch((error) => setProblem(error instanceof Error ? error.message : String(error)))
              .finally(() => setBusy(false));
          }}
        />
      )}
      {children}
    </PopupSheet>
  );
}

const styles = sheet((theme) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1, minWidth: 0 },
  title: { fontFamily: font.black, fontSize: 18, color: theme.text },
  label: { fontFamily: font.bold, fontSize: 13, color: theme.text },
  note: { fontFamily: font.regular, fontSize: 12, color: theme.textFaint },
  error: { fontFamily: font.bold, fontSize: 13, color: theme.danger },
  input: {
    fontFamily: font.regular,
    fontSize: 14,
    color: theme.text,
    borderWidth: shape.border,
    borderColor: theme.lineSoft,
    borderRadius: shape.radiusSmall,
    padding: 10,
    minHeight: 44,
    backgroundColor: theme.surface,
  },
}));
