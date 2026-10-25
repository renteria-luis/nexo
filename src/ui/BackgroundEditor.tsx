import Slider from '@react-native-community/slider';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  backgroundFor,
  backgroundsFrom,
  clampPhoto,
  DEFAULT_BACKGROUND,
  GENERAL,
  MAX_BLUR,
  MAX_DIM,
  movePhoto,
  type Background,
  type Backgrounds,
  type Direction,
  type Photo,
} from '../core/backgrounds.ts';
import { useAppData } from '../shell/AppData.tsx';
import { pickBackgroundPhoto, prunePhotos } from '../shell/background-photos.ts';
import { useBackgroundEditing, useEditingBackground } from './background-editing.tsx';
import { Button } from './Button.tsx';
import { Chip } from './Chip.tsx';
import { useTouchLock } from './SwipeLock.tsx';
import { font, glass, sheet, theme } from './theme.ts';

const SWATCHES = [
  '#17110D',
  '#2A1D14',
  '#3A3A3E',
  '#0B1A2E',
  '#1F3D2B',
  '#FF9646',
  '#FFB36B',
  '#F2C14E',
  '#D65878',
  '#E0475B',
  '#7C5CFF',
  '#5484C4',
  '#A9C4FF',
  '#2BB3A3',
  '#8FDCA6',
  '#FFFFFF',
];

const KINDS: { kind: Background['kind']; label: string }[] = [
  { kind: 'blobs', label: 'Manchas' },
  { kind: 'color', label: 'Color' },
  { kind: 'gradient', label: 'Degradado' },
  { kind: 'photo', label: 'Foto' },
];

const DIRECTIONS: { direction: Direction; label: string }[] = [
  { direction: 'down', label: 'Hacia abajo' },
  { direction: 'diagonal', label: 'En diagonal' },
  { direction: 'across', label: 'De lado' },
];

function without(all: Backgrounds, screen: string): Backgrounds {
  const next = { ...all };
  delete next[screen];
  return next;
}

/**
 * El panel de abajo con el que se cambia el fondo, y encima de la pantalla una capa que
 * recibe el dedo cuando el fondo es una foto: un dedo la mueve, dos la acercan o alejan.
 * Todo lo que se toca aqui apaga el carrusel y el menu lateral, que si no se llevaban el
 * deslizador o el arrastre de la foto.
 */
export function BackgroundEditorPanel({ onDone }: { onDone: () => void }) {
  const session = useEditingBackground();
  const { change, end } = useBackgroundEditing();
  const { state, saveSetting } = useAppData();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const { lock, unlock } = useTouchLock();
  const [slot, setSlot] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const raw = state.phase === 'ready' ? state.loaded.settings.get('backgrounds') : undefined;
  const all = useMemo(() => backgroundsFrom(raw), [raw]);

  // El gesto de la foto se arma una vez y lee el borrador de ahora de aqui: rearmarlo a
  // medio arrastre le borra la cuenta de cuanto se ha movido el dedo.
  const live = useRef({ draft: session?.draft, window });
  useEffect(() => {
    live.current = { draft: session?.draft, window };
  });
  const grip = useRef<{ fingers: number; start: Photo; dx: number; dy: number; distance: number }>(
    null,
  );
  const grab = useCallback(() => {
    grip.current = null;
    lock();
  }, [lock]);
  const drag = useCallback(
    (event: GestureResponderEvent, gesture: PanResponderGestureState) => {
      const { draft: photo, window: size } = live.current;
      if (photo?.kind !== 'photo') return;
      const touches = event.nativeEvent.touches;
      const fingers = touches.length >= 2 ? 2 : 1;
      const distance =
        fingers === 2
          ? Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY)
          : 0;
      // Al pasar de uno a dos dedos, lo hecho se queda y el tramo nuevo arranca de ahi.
      if (grip.current === null || grip.current.fingers !== fingers) {
        grip.current = { fingers, start: photo, dx: gesture.dx, dy: gesture.dy, distance };
        return;
      }
      const { start } = grip.current;
      const next =
        fingers === 2
          ? clampPhoto({ ...start, zoom: (start.zoom * distance) / grip.current.distance }, size)
          : movePhoto(start, size, gesture.dx - grip.current.dx, gesture.dy - grip.current.dy);
      live.current = { ...live.current, draft: next };
      change(next);
    },
    [change],
  );

  if (!session) return null;
  const { draft, screen, label } = session;
  const saved = backgroundFor(all, screen);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const own = Object.hasOwn(all, screen);
  const colors =
    draft.kind === 'blobs' || draft.kind === 'gradient'
      ? draft.colors
      : draft.kind === 'color'
        ? [draft.color]
        : [];

  const save = (next: Backgrounds) => {
    saveSetting('backgrounds', JSON.stringify(next));
    const inUse = Object.values(next).flatMap((background) =>
      background.kind === 'photo' ? [background.uri] : [],
    );
    prunePhotos(new Set(inUse));
    unlock();
    end();
    onDone();
  };

  const choosePhoto = async () => {
    setProblem(null);
    try {
      const picked = await pickBackgroundPhoto();
      if (!picked) return;
      change({ kind: 'photo', ...picked, zoom: 1, x: 0.5, y: 0.5, dim: 0.3, blur: 10 });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  };

  const pickKind = (kind: Background['kind']) => {
    if (kind === 'photo') {
      void choosePhoto();
      return;
    }
    if (kind === draft.kind) return;
    setSlot(0);
    change(
      kind === 'blobs'
        ? DEFAULT_BACKGROUND
        : kind === 'color'
          ? { kind: 'color', color: '#17110D' }
          : { kind: 'gradient', colors: ['#5484C4', '#17110D'], direction: 'down' },
    );
  };

  const paint = (color: string) => {
    if (draft.kind === 'color') change({ ...draft, color });
    if (draft.kind === 'blobs' || draft.kind === 'gradient') {
      change({
        ...draft,
        colors: draft.colors.map((old, index) => (index === slot ? color : old)),
      });
    }
  };

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {draft.kind === 'photo' && <PhotoGrip onGrab={grab} onMove={drag} onDrop={unlock} />}
      <View
        style={[styles.panel, { paddingBottom: insets.bottom + 12 }]}
        onTouchStart={lock}
        onTouchEnd={unlock}
        onTouchCancel={unlock}
      >
        <View style={styles.head}>
          <Text style={styles.title}>
            Fondo de {screen === GENERAL ? 'las demás pantallas' : label}
          </Text>
          {draft.kind === 'photo' && (
            <Text style={styles.note}>Arrastra la foto para moverla, pellizca para acercarla.</Text>
          )}
          {screen === GENERAL && Object.hasOwn(all, label) && (
            <Text style={styles.note}>
              {label} tiene su propio fondo: el general se ve en las que no tienen uno.
            </Text>
          )}
        </View>

        <View style={styles.chips}>
          {KINDS.map(({ kind, label: name }) => (
            <Chip
              key={kind}
              label={kind === 'photo' && draft.kind === 'photo' ? 'Otra foto' : name}
              selected={draft.kind === kind}
              onPress={() => pickKind(kind)}
            />
          ))}
        </View>

        {colors.length > 1 && (
          <View style={styles.chips}>
            {colors.map((_, index) => (
              <Chip
                key={index}
                label={`Color ${index + 1}`}
                selected={slot === index}
                onPress={() => setSlot(index)}
              />
            ))}
            {draft.kind === 'gradient' && (
              <Chip
                label={colors.length === 3 ? 'Quitar el tercero' : 'Un tercero'}
                onPress={() => {
                  setSlot(0);
                  change({
                    ...draft,
                    colors:
                      draft.colors.length === 3
                        ? draft.colors.slice(0, 2)
                        : [...draft.colors, '#D65878'],
                  });
                }}
              />
            )}
          </View>
        )}

        {colors.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.swatches}
          >
            {SWATCHES.map((color) => (
              <Pressable
                key={color}
                accessibilityRole="button"
                accessibilityLabel={`Color ${color}`}
                accessibilityState={{ selected: colors[slot] === color }}
                onPress={() => paint(color)}
                style={[
                  styles.swatch,
                  { backgroundColor: color },
                  colors[slot] === color && styles.swatchOn,
                ]}
              />
            ))}
          </ScrollView>
        )}

        {draft.kind === 'gradient' && (
          <View style={styles.chips}>
            {DIRECTIONS.map(({ direction, label: name }) => (
              <Chip
                key={direction}
                label={name}
                selected={draft.direction === direction}
                onPress={() => change({ ...draft, direction })}
              />
            ))}
          </View>
        )}

        {draft.kind === 'photo' && (
          <>
            <Text style={styles.label}>Oscurecer · {Math.round(draft.dim * 100)}%</Text>
            <Slider
              accessibilityLabel="Oscurecer la foto"
              value={draft.dim}
              minimumValue={0}
              maximumValue={MAX_DIM}
              step={0.05}
              minimumTrackTintColor={theme.accent}
              maximumTrackTintColor={theme.surfaceHigh}
              onValueChange={(dim) => change({ ...draft, dim })}
            />
            <Text style={styles.label}>
              Desenfocar · {Math.round((draft.blur / MAX_BLUR) * 100)}%
            </Text>
            <Slider
              accessibilityLabel="Desenfocar la foto"
              value={draft.blur}
              minimumValue={0}
              maximumValue={MAX_BLUR}
              step={2}
              minimumTrackTintColor={theme.accent}
              maximumTrackTintColor={theme.surfaceHigh}
              onValueChange={(blur) => change({ ...draft, blur })}
            />
          </>
        )}

        {problem && <Text style={styles.error}>No se pudo abrir la foto: {problem}</Text>}

        <View style={styles.actions}>
          <Button
            label="Cancelar"
            style={styles.action}
            onPress={() => {
              unlock();
              end();
              onDone();
            }}
          />
          {own && (
            <Button
              label={screen === GENERAL ? 'De fábrica' : 'Usar el general'}
              style={styles.action}
              onPress={() => save(without(all, screen))}
            />
          )}
          <Button
            label="Guardar"
            variant="primary"
            style={styles.action}
            disabled={!dirty}
            onPress={() => save({ ...all, [screen]: draft })}
          />
        </View>
      </View>
    </View>
  );
}

/** La capa encima de la pantalla que recibe el dedo cuando el fondo es una foto. */
function PhotoGrip({
  onGrab,
  onMove,
  onDrop,
}: {
  onGrab: () => void;
  onMove: (event: GestureResponderEvent, gesture: PanResponderGestureState) => void;
  onDrop: () => void;
}) {
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: onGrab,
        onPanResponderMove: onMove,
        onPanResponderRelease: onDrop,
        onPanResponderTerminate: onDrop,
      }),
    [onGrab, onMove, onDrop],
  );
  return <View style={StyleSheet.absoluteFill} {...responder.panHandlers} />;
}

const styles = sheet((theme) => ({
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: 12,
    paddingTop: 16,
    paddingHorizontal: 16,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderCurve: 'continuous',
    borderWidth: 1,
    ...glass.panel,
    backgroundColor: theme.surfaceSolid,
  },
  head: {
    gap: 4,
  },
  title: {
    fontSize: 17,
    fontFamily: font.black,
    color: theme.text,
  },
  note: {
    fontSize: 12,
    fontFamily: font.regular,
    color: theme.textFaint,
  },
  label: {
    fontSize: 13,
    fontFamily: font.bold,
    color: theme.textFaint,
    marginBottom: -6,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  swatches: {
    gap: 10,
    paddingVertical: 4,
  },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  swatchOn: {
    borderColor: theme.text,
    transform: [{ scale: 1.12 }],
  },
  error: {
    fontSize: 13,
    fontFamily: font.bold,
    color: theme.danger,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  action: {
    flex: 1,
    paddingHorizontal: 8,
  },
}));
