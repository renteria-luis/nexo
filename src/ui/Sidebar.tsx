import type { NavigationContainerRef, ParamListBase } from '@react-navigation/native';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  LayoutAnimation,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  BookOpen,
  CalendarDays,
  Carrot,
  ChefHat,
  ChartLine,
  ChevronDown,
  ChevronRight,
  Dumbbell,
  FlaskConical,
  GraduationCap,
  History,
  LayoutGrid,
  Library,
  Refrigerator,
  Lightbulb,
  List,
  Settings,
  Tag,
  Utensils,
  Wallet,
  type LucideIcon,
} from './icons.ts';
import { font, hardShadow, sheet, shape, theme } from './theme.ts';
import { goTo, type Navigate } from './navigation.ts';

/**
 * El menu lateral: todo lo que la app sabe hacer, ordenado, sin gastar sitio abajo.
 *
 * La barra de abajo es para el pulgar y para lo de todos los dias, asi que solo lleva
 * tres. Lo demas vive aqui con la forma del sidebar de la referencia: titulo de seccion
 * en versalitas, una fila por sitio con su icono, y los grupos que se pliegan con una
 * raya vertical que ata a los hijos con su padre.
 *
 * No lleva boton de cerrar: se cierra tocando fuera, deslizando a la izquierda o
 * eligiendo algo, que son tres formas y ninguna gasta sitio en la cabecera.
 *
 * Escrito a mano y no con el cajon de React Navigation, que pide
 * `react-native-reanimated` y esa es la libreria que tumbo la app el 21 de septiembre
 * (docs/sliders.md). Son treinta lineas de Animated y un PanResponder: entra
 * desplazandose por el hilo nativo y el fondo se oscurece con el.
 */
type Entry = {
  label: string;
  icon: LucideIcon;
  /** La pantalla apilada a la que lleva, o la pestana de abajo si es una de esas. */
  route: string;
  tab?: boolean;
};

type Folder = { label: string; icon: LucideIcon; children: Entry[] };
type Node = Entry | Folder;

const isFolder = (node: Node): node is Folder => 'children' in node;

type Section = { title: string; nodes: Node[] };

const SECTIONS: Section[] = [
  {
    title: 'Día a día',
    nodes: [
      { label: 'Hoy', icon: LayoutGrid, route: 'Hoy', tab: true },
      { label: 'Entreno', icon: Dumbbell, route: 'Entreno', tab: true },
      { label: 'Comida', icon: Utensils, route: 'Comida', tab: true },
    ],
  },
  {
    title: 'Lo demás',
    nodes: [
      {
        label: 'Historial',
        icon: History,
        children: [
          { label: 'Registros', icon: List, route: 'Registros' },
          { label: 'Resumen semanal', icon: CalendarDays, route: 'Resumen semanal' },
          { label: 'Gráficas', icon: ChartLine, route: 'Gráficas' },
        ],
      },
      {
        label: 'Catálogo',
        icon: Library,
        children: [
          { label: 'Ejercicios', icon: Dumbbell, route: 'Ejercicios' },
          { label: 'Alimentos', icon: Carrot, route: 'Alimentos' },
        ],
      },
      {
        label: 'Saber',
        icon: GraduationCap,
        children: [
          { label: 'Lecturas', icon: BookOpen, route: 'Lecturas' },
          { label: 'Recomendaciones', icon: Lightbulb, route: 'Recomendaciones' },
          { label: 'Experimentos', icon: FlaskConical, route: 'Experimentos' },
        ],
      },
      {
        label: 'Cocina',
        icon: ChefHat,
        children: [
          { label: 'Recetas', icon: ChefHat, route: 'Recetas' },
          { label: 'Despensa', icon: Refrigerator, route: 'Despensa' },
        ],
      },
      { label: 'Ofertas', icon: Tag, route: 'Ofertas' },
    ],
  },
];

const FOOT: Entry[] = [
  { label: 'Finanzas', icon: Wallet, route: 'Finanzas' },
  { label: 'Ajustes', icon: Settings, route: 'Ajustes' },
];

/** Lo que mide el panel: casi toda la pantalla, pero dejando ver que hay algo detras. */
const WIDTH = 300;
const RISE_MS = 220;
const FALL_MS = 180;

type SidebarApi = { open: () => void; close: () => void; isOpen: boolean };

const Context = createContext<SidebarApi>({
  open: () => undefined,
  close: () => undefined,
  isOpen: false,
});

export function useSidebar(): SidebarApi {
  return useContext(Context);
}

export function SidebarProvider({
  navigation,
  children,
}: {
  navigation: NavigationContainerRef<ParamListBase>;
  children: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  const [slide] = useState(() => new Animated.Value(0));
  // Que grupos estan abiertos sobrevive a cerrar el menu: si abrio Historial, lo de
  // Historial es lo que esta mirando esta semana.
  const [unfolded, setUnfolded] = useState<string[]>([]);
  // La pantalla en la que esta, para marcarla. Se lee al abrir y no en cada cuadro.
  const [here, setHere] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const close = useCallback(() => {
    Animated.timing(slide, {
      toValue: 0,
      duration: FALL_MS,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setShown(false);
    });
  }, [slide]);

  const open = useCallback(() => {
    setHere(navigation.isReady() ? (navigation.getCurrentRoute()?.name ?? null) : null);
    setShown(true);
    slide.setValue(0);
    Animated.timing(slide, {
      toValue: 1,
      duration: RISE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [navigation, slide]);

  const api = useMemo(() => ({ open, close, isOpen: shown }), [open, close, shown]);

  // Arrastrar desde el borde izquierdo lo abre, y solo ahi: en Hoy, que es la primera
  // pestana y la unica donde ese gesto no es el del carrusel, y empezando dentro del
  // 15% izquierdo de la pantalla. Se toma en la fase de captura, asi que un toque normal
  // sigue llegando a lo que haya debajo.
  const edge = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_event, gesture) =>
          !shown &&
          navigation.isReady() &&
          navigation.getCurrentRoute()?.name === 'Hoy' &&
          gesture.x0 < width * 0.15 &&
          gesture.dx > 12 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
        onPanResponderGrant: () => open(),
      }),
    [navigation, open, shown, width],
  );

  // Deslizar el panel hacia la izquierda lo cierra, que es el gesto que ya espera
  // cualquiera que haya abierto uno de estos.
  const drag = useMemo(() => {
    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_event, gesture) =>
        gesture.dx < -6 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderMove: (_event, gesture) =>
        slide.setValue(Math.min(1, Math.max(0, 1 + gesture.dx / WIDTH))),
      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dx < -WIDTH / 3 || gesture.vx < -0.8) close();
        else Animated.spring(slide, { toValue: 1, useNativeDriver: true, bounciness: 0 }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(slide, { toValue: 1, useNativeDriver: true, bounciness: 0 }).start();
      },
    });
  }, [close, slide]);

  const go = (entry: Entry) => {
    close();
    // El tipado del ref es generico y no conoce los nombres de las pantallas.
    const navigate = navigation.navigate as (...args: Navigate) => void;
    navigate(...goTo(entry.route, entry.tab === true));
  };

  const fold = (label: string) => {
    // La unica animacion de la app que no es Animated: plegar mide alto, y el alto no
    // pasa por el hilo nativo. LayoutAnimation lo resuelve en una linea.
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setUnfolded((open_) =>
      open_.includes(label) ? open_.filter((it) => it !== label) : [...open_, label],
    );
  };

  const panel = (
    <Animated.View
      style={[
        styles.panel,
        {
          width: WIDTH,
          paddingTop: insets.top + 10,
          paddingBottom: insets.bottom + 10,
          transform: [
            { translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [-WIDTH, 0] }) },
          ],
        },
      ]}
      {...drag.panHandlers}
    >
      <View style={styles.head}>
        <View style={styles.brand}>
          <Text style={styles.brandText}>nexo</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {SECTIONS.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {section.nodes.map((node) =>
              isFolder(node) ? (
                <View key={node.label}>
                  <Row
                    icon={node.icon}
                    label={node.label}
                    chevron={unfolded.includes(node.label) ? ChevronDown : ChevronRight}
                    onPress={() => fold(node.label)}
                  />
                  {unfolded.includes(node.label) && (
                    <View style={styles.children}>
                      {node.children.map((child) => (
                        <Row
                          key={child.route}
                          icon={child.icon}
                          label={child.label}
                          here={child.route === here}
                          onPress={() => go(child)}
                        />
                      ))}
                    </View>
                  )}
                </View>
              ) : (
                <Row
                  key={node.route}
                  icon={node.icon}
                  label={node.label}
                  here={node.route === here}
                  onPress={() => go(node)}
                />
              ),
            )}
          </View>
        ))}
      </ScrollView>

      <View style={styles.foot}>
        {FOOT.map((entry) => (
          <Row
            key={entry.route}
            icon={entry.icon}
            label={entry.label}
            here={entry.route === here}
            onPress={() => go(entry)}
          />
        ))}
      </View>
    </Animated.View>
  );

  return (
    <Context.Provider value={api}>
      <View style={styles.app} {...edge.panHandlers}>
        {children}
      </View>
      {shown && (
        <View style={StyleSheet.absoluteFill}>
          <Animated.View style={[styles.scrim, { opacity: slide }]}>
            <Pressable
              accessibilityLabel="Cerrar el menú"
              onPress={close}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
          {panel}
        </View>
      )}
    </Context.Provider>
  );
}

function Row({
  icon: Icon,
  label,
  onPress,
  here = false,
  chevron: Chevron,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  here?: boolean;
  chevron?: LucideIcon;
}) {
  const ink = here ? theme.accentInk : theme.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        here && styles.rowHere,
        pressed && !here && styles.rowPressed,
      ]}
    >
      <Icon size={17} color={ink} strokeWidth={2.5} />
      <Text style={[styles.label, here && styles.labelHere]}>{label}</Text>
      {Chevron ? <Chevron size={15} color={theme.textFaint} strokeWidth={2.5} /> : null}
    </Pressable>
  );
}

const styles = sheet((theme) => ({
  app: {
    flex: 1,
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
  },
  panel: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    backgroundColor: theme.bg,
    borderRightWidth: shape.border,
    borderRightColor: theme.line,
    paddingHorizontal: 12,
    gap: 10,
    ...hardShadow(theme),
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 10,
    borderBottomWidth: shape.border,
    borderBottomColor: theme.line,
  },
  brand: {
    backgroundColor: theme.accent,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  brandText: {
    fontSize: 20,
    lineHeight: 26,
    fontFamily: font.display,
    letterSpacing: -0.5,
    color: theme.accentInk,
  },
  list: {
    paddingBottom: 12,
    gap: 16,
  },
  section: {
    gap: 2,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: font.black,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: theme.textFaint,
    marginBottom: 4,
  },
  // La raya que ata los hijos a su padre, como en la referencia.
  children: {
    marginLeft: 16,
    paddingLeft: 10,
    borderLeftWidth: shape.border,
    borderLeftColor: theme.line,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 40,
    paddingHorizontal: 8,
    borderWidth: shape.border,
    borderColor: 'transparent',
    borderRadius: shape.radiusSmall,
  },
  rowHere: {
    backgroundColor: theme.accent,
    borderColor: theme.line,
  },
  rowPressed: {
    backgroundColor: theme.surfaceHigh,
  },
  label: {
    flex: 1,
    fontSize: 15,
    fontFamily: font.black,
    color: theme.text,
  },
  labelHere: {
    color: theme.accentInk,
  },
  foot: {
    borderTopWidth: shape.border,
    borderTopColor: theme.line,
    paddingTop: 8,
  },
}));
