import { useNavigation } from '@react-navigation/native';
import { useMemo, useState } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';

import {
  backgroundFor,
  backgroundsFrom,
  GENERAL,
  type Background,
} from '../../core/backgrounds.ts';
import { useAppData } from '../../shell/AppData.tsx';
import { TRANSIT_ENABLED } from '../../transit/index.ts';
import { BackgroundView } from '../Backdrop.tsx';
import { useBackgroundEditing } from '../background-editing.tsx';
import { Card } from '../Card.tsx';
import { ChevronRight } from '../icons.ts';
import { goTo, type Navigate } from '../navigation.ts';
import { font, glass, pressed as pressedInto, sheet, theme } from '../theme.ts';

import { Screen } from './Screen.tsx';

/** Las pestanas se abren dentro del carrusel; las demas, apiladas encima. */
const TABS = new Set(['Hoy', 'Entreno', 'Comida']);

/**
 * The screens a background can be tried on. A day and an exercise need to know which one
 * to open, so they are left to the general background.
 */
const SCREENS = [
  'Hoy',
  'Entreno',
  'Comida',
  ...(TRANSIT_ENABLED ? ['Transit'] : []),
  'Registros',
  'Resumen semanal',
  'Gráficas',
  'Ejercicios',
  'Alimentos',
  'Recetas',
  'Despensa',
  'Lecturas',
  'Recomendaciones',
  'Experimentos',
  'Ofertas',
  'Finanzas',
  'Ajustes',
  'Fondos',
];

const KIND_ES: Record<Background['kind'], string> = {
  blobs: 'Manchas',
  color: 'Color',
  gradient: 'Degradado',
  photo: 'Foto',
};

/** Lo ancha que es la muestra de cada fila; lo alto sale de la forma de la pantalla. */
const THUMB = 34;

/**
 * Fondos: la lista de pantallas con el fondo que tiene cada una. Tocar una lleva a esa
 * pantalla con el editor abierto abajo, y el fondo se prueba ahi, en la pantalla de
 * verdad. El general se prueba en Hoy.
 */
export function BackgroundsScreen() {
  const { state } = useAppData();
  const navigation = useNavigation<{ navigate: (...args: Navigate) => void }>();
  const { begin } = useBackgroundEditing();
  const window = useWindowDimensions();
  const raw = state.phase === 'ready' ? state.loaded.settings.get('backgrounds') : undefined;
  const all = useMemo(() => backgroundsFrom(raw), [raw]);

  const open = (screen: string) => {
    const shown = screen === GENERAL ? 'Hoy' : screen;
    begin(screen, shown);
    if (shown === 'Fondos') return;
    navigation.navigate(...goTo(shown, TABS.has(shown)));
  };

  return (
    <Screen title="Fondos">
      <Card>
        <Text style={styles.note}>
          Toca una pantalla para cambiar su fondo encima de ella misma. Las que no tienen uno propio
          usan el general.
        </Text>
      </Card>
      {[GENERAL, ...SCREENS].map((screen) => (
        <Row
          key={screen}
          name={screen === GENERAL ? 'General' : screen}
          detail={
            screen === GENERAL
              ? `${KIND_ES[backgroundFor(all, GENERAL).kind]} · el de las demás`
              : Object.hasOwn(all, screen)
                ? `${KIND_ES[all[screen].kind]} · propio`
                : 'Usa el general'
          }
          background={backgroundFor(all, screen)}
          ratio={window.height / window.width}
          scale={THUMB / window.width}
          onPress={() => open(screen)}
        />
      ))}
    </Screen>
  );
}

function Row({
  name,
  detail,
  background,
  ratio,
  scale,
  onPress,
}: {
  name: string;
  detail: string;
  background: Background;
  ratio: number;
  scale: number;
  onPress: () => void;
}) {
  const [missing, setMissing] = useState(false);
  const height = Math.round(THUMB * ratio);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Cambiar el fondo de ${name}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={[styles.thumb, { height }]}>
        <BackgroundView
          background={background}
          width={THUMB}
          height={height}
          scale={scale}
          onMissing={() => setMissing(true)}
        />
      </View>
      <View style={styles.text}>
        <Text style={styles.name}>{name}</Text>
        <Text style={missing ? styles.error : styles.detail}>
          {missing ? 'No encuentro la foto en este teléfono' : detail}
        </Text>
      </View>
      <ChevronRight size={18} color={theme.textFaint} strokeWidth={2.25} />
    </Pressable>
  );
}

const styles = sheet((theme) => ({
  note: {
    fontSize: 13,
    fontFamily: font.regular,
    color: theme.textDim,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 12,
    borderWidth: 1,
    borderRadius: 20,
    borderCurve: 'continuous',
    ...glass.control,
  },
  pressed: pressedInto(),
  thumb: {
    width: THUMB,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.line,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 15,
    fontFamily: font.black,
    color: theme.text,
  },
  detail: {
    fontSize: 12,
    fontFamily: font.regular,
    color: theme.textFaint,
  },
  error: {
    fontSize: 12,
    fontFamily: font.bold,
    color: theme.danger,
  },
}));
