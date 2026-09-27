import { InputAccessoryView, Keyboard, Platform, Pressable, Text, View } from 'react-native';

import { Check } from './icons.ts';
import { font, hardShadow, pressed, sheet, shape, theme } from './theme.ts';

/**
 * La barra que va pegada encima del teclado de iOS.
 *
 * El teclado es el del sistema, con su autocorrector, su dictado y sus tildes, que es lo
 * que hace falta para escribir de verdad. Lo unico que le falta es una salida: el teclado
 * de numeros de Apple no trae tecla de retorno, asi que sin esto la unica forma de
 * cerrarlo es tocar fuera. Aqui va esa tecla, y aqui iran las de gimnasio el dia que
 * hagan falta (+2.5 kg, repetir serie).
 *
 * `InputAccessoryView` es de React Native y solo existe en iOS; en el navegador no se
 * dibuja nada, que es justo lo que hace falta porque ahi tampoco hay teclado que coronar.
 */
export const KEYBOARD_BAR = 'nexo-teclado';

export function KeyboardBar() {
  if (Platform.OS !== 'ios') return null;

  return (
    <InputAccessoryView nativeID={KEYBOARD_BAR} backgroundColor="transparent">
      <View style={styles.bar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cerrar el teclado"
          onPress={() => Keyboard.dismiss()}
          style={({ pressed: down }) => [styles.done, down && styles.donePressed]}
        >
          <Check size={17} color={theme.accentInk} strokeWidth={2.5} />
          <Text style={styles.label}>listo</Text>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}

const styles = sheet((theme) => ({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: theme.bg,
    borderTopWidth: shape.border,
    borderTopColor: theme.line,
  },
  done: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minHeight: 36,
    paddingHorizontal: 14,
    backgroundColor: theme.accent,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    ...hardShadow(theme, 3),
  },
  donePressed: pressed(3),
  label: {
    fontSize: 15,
    fontFamily: font.black,
    color: theme.accentInk,
  },
}));
