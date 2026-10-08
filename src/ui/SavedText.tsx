import { useState } from 'react';
import { Text, View } from 'react-native';
import { autosave, type SaveState } from '../core/autosave.ts';
import { Button } from './Button.tsx';
import { TextField, type TextFieldProps } from './TextField.tsx';
import { font, sheet } from './theme.ts';

export function SavedText({
  value,
  onSave,
  ...props
}: Omit<TextFieldProps, 'value' | 'defaultValue' | 'onChange' | 'onCommit'> & {
  value: string;
  onSave: (text: string) => Promise<void>;
}) {
  const [state, setState] = useState<SaveState>({ status: 'saved' });
  const [writer] = useState(() => autosave(value, onSave, setState));
  return (
    <View style={styles.field}>
      <TextField
        {...props}
        defaultValue={value}
        onChange={(text) => {
          void writer.change(text);
        }}
      />
      <Text accessibilityLiveRegion="polite" style={styles.status}>
        {state.status === 'saved'
          ? 'Guardado'
          : state.status === 'saving'
            ? 'Guardando…'
            : `Sin guardar: ${state.error}`}
      </Text>
      {state.status === 'error' && (
        <Button
          label="Reintentar guardado"
          variant="ghost"
          onPress={() => {
            void writer.retry();
          }}
        />
      )}
    </View>
  );
}

const styles = sheet((theme) => ({
  field: { gap: 4 },
  status: { fontSize: 12, fontFamily: font.regular, color: theme.textDim },
}));
