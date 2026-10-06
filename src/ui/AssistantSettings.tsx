import { useEffect, useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';

import type { CredentialStatus } from '../core/cloud-credentials.ts';
import {
  assistantCredentialStatus,
  clearAssistantCredentials,
  importAssistantCredentials,
  saveAssistantCredentials,
} from '../shell/assistant-credentials.ts';

import { Button } from './Button.tsx';
import { Card } from './Card.tsx';
import { Chip } from './Chip.tsx';
import { TextField } from './TextField.tsx';
import { font, sheet, shape } from './theme.ts';

export function AssistantSettings() {
  const [status, setStatus] = useState<CredentialStatus | null>(null);
  const [provider, setProvider] = useState<'apple' | 'groq'>('apple');
  const [groq, setGroq] = useState('');
  const [tavily, setTavily] = useState('');
  const [busy, setBusy] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const active = useRef(true);
  const running = useRef(false);

  useEffect(() => {
    active.current = true;
    assistantCredentialStatus().then(
      (saved) => {
        if (!active.current) return;
        setStatus(saved);
        setProvider(saved.provider);
        setBusy(false);
      },
      () => {
        if (!active.current) return;
        setNote('No pude leer la configuración. Puedes volver a importar las claves.');
        setBusy(false);
      },
    );
    return () => {
      active.current = false;
    };
  }, []);

  const work = async (action: () => Promise<CredentialStatus | null>, success: string) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setNote(null);
    try {
      const saved = await action();
      if (!active.current || saved === null) return;
      setStatus(saved);
      setProvider(saved.provider);
      setGroq('');
      setTavily('');
      setRemoving(false);
      setNote(success);
    } catch (error) {
      if (active.current) {
        const known =
          error instanceof Error &&
          /^(Falta|Agrega|La clave|No pude|Usa el archivo|Ese archivo|Las claves|Elige)/.test(
            error.message,
          );
        setNote(
          known ? (error as Error).message : 'No pude completar el cambio. Inténtalo otra vez.',
        );
      }
    } finally {
      running.current = false;
      if (active.current) setBusy(false);
    }
  };

  return (
    <Card title="Asistente">
      <Text style={styles.note}>
        Tus registros se consultan sin conexión. Elige cómo interpretar los mensajes más abiertos.
      </Text>
      <View style={styles.options}>
        <Chip
          label="Apple · en el teléfono"
          selected={provider === 'apple'}
          disabled={busy}
          onPress={() => setProvider('apple')}
        />
        <Chip
          label="Groq · nube gratuita"
          selected={provider === 'groq'}
          disabled={busy}
          onPress={() => setProvider('groq')}
        />
      </View>
      <Text style={styles.note}>
        Las recetas investigadas usan Groq y Tavily para buscar fuentes y comparar ingredientes con
        tu despensa.
      </Text>
      <Text style={styles.label}>Clave de Groq{status?.hasGroq ? ' · guardada' : ''}</Text>
      <TextField
        value={groq}
        onChange={setGroq}
        accessibilityLabel="Clave de Groq"
        placeholder={status?.hasGroq ? 'Pega otra para reemplazarla' : 'Pega tu clave de Groq'}
        autoCapitalize="none"
        secureTextEntry
        style={styles.input}
      />
      <Text style={styles.label}>Clave de Tavily{status?.hasTavily ? ' · guardada' : ''}</Text>
      <TextField
        value={tavily}
        onChange={setTavily}
        accessibilityLabel="Clave de Tavily"
        placeholder={status?.hasTavily ? 'Pega otra para reemplazarla' : 'Pega tu clave de Tavily'}
        autoCapitalize="none"
        secureTextEntry
        style={styles.input}
      />
      <Button
        label={busy ? 'Un momento…' : 'Guardar configuración'}
        accessibilityLabel="Guardar configuración del asistente"
        disabled={busy}
        onPress={() =>
          work(
            () =>
              saveAssistantCredentials({
                provider,
                ...(groq.trim() ? { groqApiKey: groq } : {}),
                ...(tavily.trim() ? { tavilyApiKey: tavily } : {}),
              }),
            'Configuración guardada.',
          )
        }
      />
      <Button
        label="Importar archivo de claves"
        accessibilityLabel="Importar archivo de claves"
        variant="secondary"
        disabled={busy}
        onPress={() =>
          work(importAssistantCredentials, 'Claves importadas. Groq está seleccionado.')
        }
      />
      <Text style={styles.note}>
        {Platform.OS === 'web'
          ? 'En este navegador las claves duran solo hasta cerrar o recargar la pestaña.'
          : 'Las claves se guardan de forma segura en este teléfono y no se incluyen en tus respaldos.'}{' '}
        Usa los planes gratuitos de ambos servicios con el pago por uso desactivado.
      </Text>
      {(status?.hasGroq || status?.hasTavily || removing) &&
        (removing ? (
          <View style={styles.confirm}>
            <Text style={styles.note}>¿Borrar las dos claves de este dispositivo?</Text>
            <Button
              label="Sí, borrar claves"
              disabled={busy}
              onPress={() =>
                work(clearAssistantCredentials, 'Claves borradas. Apple está seleccionado.')
              }
            />
            <Button
              label="Cancelar"
              variant="secondary"
              disabled={busy}
              onPress={() => setRemoving(false)}
            />
          </View>
        ) : (
          <Button
            label="Borrar claves guardadas"
            variant="secondary"
            disabled={busy}
            onPress={() => setRemoving(true)}
          />
        ))}
      {note !== null && (
        <Text accessibilityLiveRegion="polite" style={styles.note}>
          {note}
        </Text>
      )}
    </Card>
  );
}

const styles = sheet((theme) => ({
  note: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 19,
    color: theme.textFaint,
    marginBottom: 10,
  },
  label: { fontFamily: font.bold, fontSize: 12, color: theme.text, marginBottom: 5, marginTop: 8 },
  input: {
    fontFamily: font.regular,
    fontSize: 14,
    color: theme.text,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: shape.radius,
    padding: 10,
    marginBottom: 10,
  },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  confirm: { gap: 8 },
}));
