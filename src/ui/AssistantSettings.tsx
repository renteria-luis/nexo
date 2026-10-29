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
import { InfoDot, InfoText } from './InfoBubble.tsx';
import { TextField } from './TextField.tsx';
import { font, sheet, shape } from './theme.ts';

// Lo que antes era un parrafo debajo de las casillas: va en la (i) de la clave (2026-10-25).
const KEYS_NOTE = `${
  Platform.OS === 'web'
    ? 'En este navegador las claves duran solo hasta cerrar o recargar la pestaña.'
    : 'Las claves se quedan en este teléfono y no van en tus respaldos.'
} Usa los planes gratuitos, con el pago por uso apagado.`;

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

  // Todo se guarda solo, como el resto de Ajustes: con «Guardar configuración» aparte,
  // tocar Groq lo pintaba elegido y al salir sin el boton no quedaba nada (2026-10-24).
  const choose = (next: 'apple' | 'groq') => {
    if (next === provider || busy) return;
    setProvider(next);
    void work(() => saveAssistantCredentials({ provider: next }), 'Guardado.');
  };
  const saveKey = (service: 'Groq' | 'Tavily', text: string) => {
    if (!text.trim() || busy) return;
    void work(
      () =>
        saveAssistantCredentials(
          service === 'Groq' ? { provider, groqApiKey: text } : { tavilyApiKey: text },
        ),
      `Clave de ${service} guardada.`,
    );
  };

  return (
    // Sin titulo: la pantalla de su seccion ya se llama Asistente.
    <Card>
      <View style={styles.field}>
        <Text style={styles.label}>Interpreta tus mensajes</Text>
        <View style={styles.options}>
          <Chip
            label="Apple · en el teléfono"
            selected={provider === 'apple'}
            disabled={busy}
            onPress={() => choose('apple')}
          />
          <Chip
            label="Groq · nube gratuita"
            selected={provider === 'groq'}
            disabled={busy}
            onPress={() => choose('groq')}
          />
        </View>
      </View>
      <View style={styles.field}>
        <View style={styles.labelRow}>
          <Text style={styles.label}>Clave de Groq{status?.hasGroq ? ' · guardada' : ''}</Text>
          <InfoDot accessibilityLabel="Dónde quedan las claves">
            <InfoText>{KEYS_NOTE}</InfoText>
          </InfoDot>
        </View>
        <TextField
          value={groq}
          onChange={setGroq}
          onCommit={(text) => saveKey('Groq', text)}
          accessibilityLabel="Clave de Groq"
          placeholder={status?.hasGroq ? 'Pega otra para reemplazarla' : 'Pega tu clave de Groq'}
          autoCapitalize="none"
          secureTextEntry
          style={styles.input}
          focusedStyle={styles.writing}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>
          Clave de Tavily, para recetas{status?.hasTavily ? ' · guardada' : ''}
        </Text>
        <TextField
          value={tavily}
          onChange={setTavily}
          onCommit={(text) => saveKey('Tavily', text)}
          accessibilityLabel="Clave de Tavily"
          placeholder={
            status?.hasTavily ? 'Pega otra para reemplazarla' : 'Pega tu clave de Tavily'
          }
          autoCapitalize="none"
          secureTextEntry
          style={styles.input}
          focusedStyle={styles.writing}
        />
      </View>
      {note !== null && (
        <Text accessibilityLiveRegion="polite" style={styles.note}>
          {note}
        </Text>
      )}
      <Button
        label="Importar archivo de claves"
        accessibilityLabel="Importar archivo de claves"
        variant="secondary"
        disabled={busy}
        onPress={() =>
          work(importAssistantCredentials, 'Claves importadas. Groq está seleccionado.')
        }
      />
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
    </Card>
  );
}

const styles = sheet((theme) => ({
  note: {
    fontFamily: font.regular,
    fontSize: 12,
    color: theme.textFaint,
  },
  // Como las demas casillas de Ajustes: el nombre en mayusculas tenues, la casilla de vidrio.
  label: {
    fontFamily: font.black,
    fontSize: 12,
    letterSpacing: 0.6,
    color: theme.textFaint,
    textTransform: 'uppercase',
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
  writing: { backgroundColor: theme.surfaceHigh },
  field: { gap: 5 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  confirm: { gap: 8 },
}));
