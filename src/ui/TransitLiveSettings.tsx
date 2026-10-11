import { useState } from 'react';
import { Platform, Text, View } from 'react-native';

import type { TransitLiveConfig } from '../shell/transit-live.ts';
import { Button } from './Button.tsx';
import { Card } from './Card.tsx';
import { TextField } from './TextField.tsx';
import { font, shape, sheet } from './theme.ts';

export function TransitLiveSettings({
  config,
  error,
  onSave,
  onClear,
}: {
  config: TransitLiveConfig | null;
  error: string | null;
  onSave: (config: TransitLiveConfig) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [endpoint, setEndpoint] = useState('');
  const [credential, setCredential] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await onSave({ endpoint: endpoint.trim(), credential: credential.trim() });
      setCredential('');
      setEditing(false);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title="Conexión en vivo"
      action={
        <Button
          label={editing ? 'Cerrar' : config ? 'Cambiar' : 'Configurar'}
          variant="ghost"
          disabled={busy}
          onPress={() => {
            setEndpoint(config?.endpoint ?? '');
            setCredential('');
            setProblem(null);
            setEditing(!editing);
          }}
        />
      }
    >
      <Text style={styles.note}>
        {config
          ? 'Conexión configurada. Se consulta mientras ves Transit.'
          : 'Sin conexión configurada. Los horarios guardados siguen disponibles.'}
      </Text>
      {(problem || error) && <Text style={styles.error}>{problem || error}</Text>}
      {editing && (
        <View style={styles.fields}>
          <TextField
            accessibilityLabel="URL del servicio Transit"
            placeholder="https://tu-proyecto.vercel.app/api/live"
            value={endpoint}
            onChange={setEndpoint}
            autoCapitalize="none"
            style={styles.input}
          />
          <TextField
            accessibilityLabel="Clave de conexión Transit"
            placeholder="Clave de instalación"
            value={credential}
            onChange={setCredential}
            autoCapitalize="none"
            secureTextEntry
            style={styles.input}
          />
          <Text style={styles.note}>
            {Platform.OS === 'web'
              ? 'La conexión se conserva solo durante esta sesión del navegador.'
              : 'La clave se guarda en el almacenamiento seguro del iPhone.'}
          </Text>
          <Button label="Guardar conexión" loading={busy} onPress={() => void save()} />
          {config && (
            <Button
              label="Desconectar"
              disabled={busy}
              onPress={() => {
                setBusy(true);
                void onClear()
                  .then(() => {
                    setCredential('');
                    setEditing(false);
                  })
                  .catch((error) =>
                    setProblem(error instanceof Error ? error.message : String(error)),
                  )
                  .finally(() => setBusy(false));
              }}
            />
          )}
        </View>
      )}
    </Card>
  );
}

const styles = sheet((theme) => ({
  note: { fontFamily: font.regular, fontSize: 12, color: theme.textFaint },
  error: { fontFamily: font.bold, fontSize: 13, color: theme.danger },
  fields: { gap: 8 },
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
