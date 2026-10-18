import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import {
  DarkTheme,
  NavigationContainer,
  useNavigation,
  useNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Keyboard, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppDataProvider, useAppData } from './src/shell/AppData.tsx';
import { TransitJourneyProvider } from './src/shell/TransitJourney.tsx';
import { TransitTravelSettings } from './src/ui/TransitJourneyCard.tsx';
import { listenToTransitReminders, type TransitResponse } from './src/shell/notifications.ts';
import { enabledTabs, type ModuleRegistry } from './src/modules/registry.ts';
import { DealsScreen } from './src/ui/screens/DealsScreen.tsx';
import { ExerciseScreen, ExercisesScreen } from './src/ui/screens/ExercisesScreen.tsx';
import { ExperimentsScreen } from './src/ui/screens/ExperimentsScreen.tsx';
import { NutritionScreen } from './src/ui/screens/NutritionScreen.tsx';
import { PantryScreen } from './src/ui/screens/PantryScreen.tsx';
import { RecipesScreen } from './src/ui/screens/RecipesScreen.tsx';
import { PendingScreen } from './src/ui/screens/PendingScreen.tsx';
import { ReadingsScreen } from './src/ui/screens/ReadingsScreen.tsx';
import { ChartsScreen } from './src/ui/screens/ChartsScreen.tsx';
import { DayScreen } from './src/ui/screens/DayScreen.tsx';
import { FoodsScreen } from './src/ui/screens/FoodsScreen.tsx';
import { RecordsScreen } from './src/ui/screens/RecordsScreen.tsx';
import { RoutineNotesScreen } from './src/ui/screens/RoutineNotesScreen.tsx';
import { SettingsScreen } from './src/ui/screens/SettingsScreen.tsx';
import { TodayScreen } from './src/ui/screens/TodayScreen.tsx';
import { TrainingScreen } from './src/ui/screens/TrainingScreen.tsx';
import { TransitScreen } from './src/ui/screens/TransitScreen.tsx';
import { TRANSIT_ENABLED } from './src/transit/index.ts';
import { Dumbbell, LayoutGrid, Utensils, type LucideIcon } from './src/ui/icons.ts';

import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';

import { InfoProvider } from './src/ui/InfoBubble.tsx';
import { KeyboardBar } from './src/ui/KeyboardBar.tsx';
import { Assistant } from './src/ui/Assistant.tsx';
import { AssistantDockProvider, AssistantDockSlot } from './src/ui/assistant-dock.tsx';
import { goTo, nudgeDestination, type Navigate } from './src/ui/navigation.ts';
import { SidebarProvider, useSidebar } from './src/ui/Sidebar.tsx';
import { SwipeLockProvider, useSwipeLocked } from './src/ui/SwipeLock.tsx';
import { Backdrop, PagerPositionProvider } from './src/ui/Backdrop.tsx';
import { BackgroundEditorPanel } from './src/ui/BackgroundEditor.tsx';
import { BackgroundEditingProvider } from './src/ui/background-editing.tsx';
import { BackgroundsScreen } from './src/ui/screens/BackgroundsScreen.tsx';
import { FloatingBarSpace, TabBar, tabBarSpace } from './src/ui/TabBar.tsx';
import { TopBar, topBarHeight } from './src/ui/TopBar.tsx';
import { sheet, theme } from './src/ui/theme.ts';
import { WeekSummaryScreen } from './src/ui/screens/WeekSummaryScreen.tsx';

const Tabs = createMaterialTopTabNavigator();
const RootStack = createNativeStackNavigator();

// Sin esto, React Navigation pinta sus propios fondos claros detras de cada pantalla
// y se ve un destello blanco cada vez que se abre una.
const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: theme.bg,
    card: theme.surface,
    text: theme.text,
    border: theme.line,
    primary: theme.accent,
    notification: theme.danger,
  },
};

/**
 * Spec 17.3: every module declares its own slot and its own flag. Deals and Finance
 * have their tabs but not their modules yet, and say so rather than opening empty.
 */
const registry: ModuleRegistry = {
  tabs: [
    { id: 'today', label: 'Hoy', enabled: true, screen: () => null },
    { id: 'training', label: 'Entreno', enabled: true, screen: TrainingScreen },
    { id: 'nutrition', label: 'Comida', enabled: true, screen: NutritionScreen },
  ],
};

/** Las pestanas comparten la pantalla `nexo`, y su fondo es el de cada una fundido. */
const TAB_SCREENS = enabledTabs(registry).map((tab) => tab.label);
const ROUTE_SCREENS = new Map<string, readonly string[]>([['nexo', TAB_SCREENS]]);

/** De que pantallas es el fondo de una ruta, siempre la misma lista para la misma ruta. */
function screensOf(route: string): readonly string[] {
  let screens = ROUTE_SCREENS.get(route);
  if (!screens) {
    screens = [route];
    ROUTE_SCREENS.set(route, screens);
  }
  return screens;
}

/** Un icono por pestana: a un metro de distancia se reconoce antes que la palabra. */
const TAB_ICONS: Record<string, LucideIcon> = {
  today: LayoutGrid,
  training: Dumbbell,
  nutrition: Utensils,
};

/**
 * The cards on Hoy open tabs, and a tab only exists inside the tab navigator: an
 * action the stack above does not know cannot reach down into it. From here it goes
 * the other way, and the weekly summary, which is not a tab, bubbles up to the stack.
 */
function TodayTab() {
  const navigation = useNavigation<{
    navigate: (name: string, params?: { date: string }) => void;
  }>();
  return (
    <TodayScreen
      onOpen={(name) => navigation.navigate(name)}
      onOpenDay={(date) => navigation.navigate('Día', { date })}
    />
  );
}

/**
 * Lo que va dentro de cada pestana, hecho una sola vez. El carrusel se redibuja cada vez
 * que una pantalla apaga o enciende su deslizamiento, y con una pestana nueva en cada
 * dibujo se redibujaban tambien las tres pantallas enteras: era lo que tardaba en
 * despegarse una fila del orden de Entreno (2026-10-10).
 */
const TAB_CONTENT = new Map(
  enabledTabs(registry).map((tab) => [tab.id, tab.id === 'today' ? <TodayTab /> : <tab.screen />]),
);

function TabsScreen() {
  const tabs = enabledTabs(registry);
  // Apagado mientras una pantalla arrastra algo: el gesto del carrusel es nativo y le
  // quita el toque a cualquier arrastre que no baje perfectamente recto.
  const locked = useSwipeLocked();
  // La barra de abajo flota encima de las paginas, asi que el hueco que tapa lo tiene
  // que dejar libre cada pantalla al final de su contenido.
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.tabs}>
      <FloatingBarSpace.Provider value={tabBarSpace(insets.bottom)}>
        <Tabs.Navigator
          // La barra va abajo aunque las paginas sean un pager: es donde llega el pulgar.
          tabBarPosition="bottom"
          tabBar={(props) => <TabBar {...props} />}
          // Transparentes: las paginas se deslizan encima del fondo, que se queda quieto.
          screenOptions={{ swipeEnabled: !locked, sceneStyle: styles.clear }}
        >
          {tabs.map((tab) => (
            <Tabs.Screen
              key={tab.id}
              name={tab.label}
              options={{
                tabBarIcon: ({ color }) => {
                  const Icon = TAB_ICONS[tab.id] ?? LayoutGrid;
                  return <Icon size={22} color={color} strokeWidth={2} />;
                },
              }}
            >
              {() => TAB_CONTENT.get(tab.id)}
            </Tabs.Screen>
          ))}
        </Tabs.Navigator>
      </FloatingBarSpace.Provider>
    </View>
  );
}

function SettingsRoute() {
  const {
    state,
    saveSetting,
    saveScoreScale,
    removeSetting,
    resetDatabase,
    exportData,
    importData,
  } = useAppData();
  const navigation = useNavigation<{ navigate: (name: string) => void }>();
  if (state.phase !== 'ready') return null;

  return (
    <SettingsScreen
      transitSettings={TRANSIT_ENABLED ? <TransitTravelSettings /> : undefined}
      onOpenExercises={() => navigation.navigate('Ejercicios')}
      onOpenBackgrounds={() => navigation.navigate('Fondos')}
      onOpenFoods={() => navigation.navigate('Alimentos')}
      settings={state.loaded.settings}
      onSaveScoreScale={saveScoreScale}
      onSaveSetting={saveSetting}
      onClearSetting={removeSetting}
      onResetDatabase={resetDatabase}
      onExport={exportData}
      onImport={importData}
    />
  );
}

/**
 * Vive dentro del anfitrion del teclado para poder cerrarlo al cambiar de pestana:
 * deslizar a otra pantalla con el teclado abierto lo dejaba flotando sobre una
 * pantalla que ya no era la suya.
 */
function Navigation({ navigation }: { navigation: ReturnType<typeof useNavigationContainerRef> }) {
  const { nudgeTarget, clearNudgeTarget, healthArrival } = useAppData();
  const sidebar = useSidebar();
  const [navigationReady, setNavigationReady] = useState(false);
  const [travelTarget, setTravelTarget] = useState<TransitResponse | null>(null);
  const handledTravel = useRef<TransitResponse | null>(null);
  useEffect(() => (TRANSIT_ENABLED ? listenToTransitReminders(setTravelTarget) : undefined), []);
  useEffect(() => {
    if (!navigationReady || !travelTarget || handledTravel.current === travelTarget) return;
    handledTravel.current = travelTarget;
    sidebar.close();
    const navigate = navigation.navigate as (...args: Navigate) => void;
    navigate('Transit', { reminder: travelTarget }, { pop: true });
  }, [travelTarget, navigationReady, navigation, sidebar]);

  useEffect(() => {
    if (nudgeTarget === null) return;
    // El tipado del ref es generico y no conoce los nombres de las pantallas.
    const navigate = navigation.navigate as (...args: Navigate) => void;
    if (navigation.isReady()) navigate(...nudgeDestination(nudgeTarget));
    clearNudgeTarget();
  }, [nudgeTarget, clearNudgeTarget, navigation]);

  // Lo que manda el Atajo se cuenta en Hoy, donde quedan el sueno y los pasos. Una vez por
  // enlace: contestar un choque cambia lo que dice, no lo vuelve a llevar a Hoy.
  const arrivalShown = useRef<number | null>(null);
  const arrivalId = healthArrival?.id ?? null;
  useEffect(() => {
    if (arrivalId === null || arrivalId === arrivalShown.current) return;
    arrivalShown.current = arrivalId;
    const navigate = navigation.navigate as (...args: Navigate) => void;
    if (navigation.isReady()) navigate(...goTo('Hoy', true));
  }, [arrivalId, navigation]);

  return (
    <NavigationContainer
      ref={navigation}
      onReady={() => setNavigationReady(true)}
      theme={navigationTheme}
      // Cambiar de pantalla con el teclado abierto lo dejaba flotando sobre otra cosa.
      onStateChange={() => Keyboard.dismiss()}
    >
      <RootStack.Navigator
        screenLayout={({ children, route }) => (
          <ScreenFrame screens={screensOf(route.name)}>{children}</ScreenFrame>
        )}
        screenOptions={{
          // Nuestra barra en lugar del encabezado nativo, que solo dejaba cambiarle el
          // color. En la pantalla principal lleva a Ajustes; en una apilada la cierra,
          // que es lo unico que se puede hacer desde ahi.
          header: ({ navigation, back, route, options }) =>
            back ? (
              <TopBar
                action="done"
                onPress={navigation.goBack}
                onMenu={sidebar.open}
                // En un dia suelto la fecha de arriba competiria con la del dia abierto.
                showDate={route.name !== 'Día'}
                actions={options.headerRight?.({ canGoBack: !!back })}
                screens={screensOf(route.name)}
              />
            ) : (
              <TopBar
                screens={screensOf(route.name)}
                action="settings"
                onPress={() => navigation.navigate('Ajustes')}
                onMenu={sidebar.open}
                dock={<AssistantDockSlot navigation={navigation} />}
              />
            ),
          contentStyle: { backgroundColor: theme.bg },
        }}
      >
        {/* Nada de modales: un modal de iOS se presenta en su propia ventana y el
            teclado de la app, que vive en la raiz, quedaba debajo y sin poder tocarse.
            Apiladas, las pantallas comparten arbol con el teclado. */}
        <RootStack.Screen name="nexo" component={TabsScreen} />
        <RootStack.Screen name="Ajustes" component={SettingsRoute} />
        <RootStack.Screen name="Fondos" component={BackgroundsScreen} />
        {/* Ofertas dejo de ser pestana el 2026-09-28: lo que importa se avisa en Hoy y
            la lista entera vive aqui, a un toque de ese aviso. */}
        <RootStack.Screen name="Ofertas" component={DealsScreen} />
        {TRANSIT_ENABLED && (
          <RootStack.Screen
            name="Transit"
            component={TransitScreen}
            options={{ gestureEnabled: false }}
          />
        )}
        <RootStack.Screen name="Finanzas">
          {() => (
            <PendingScreen
              title="Finanzas"
              note="El módulo de finanzas todavía no existe. Entra al final, y compartirá el motor de puntuación y la cuadrícula con el resto."
            />
          )}
        </RootStack.Screen>
        <RootStack.Screen name="Día" component={DayScreen} />
        <RootStack.Screen name="Gráficas" component={ChartsScreen} />
        <RootStack.Screen name="Ejercicios" component={ExercisesScreen} />
        {/* La ficha es su propia pantalla: asi el gesto de volver regresa a la lista. */}
        <RootStack.Screen name="Ejercicio" component={ExerciseScreen} />
        <RootStack.Screen name="Alimentos" component={FoodsScreen} />
        <RootStack.Screen name="Despensa" component={PantryScreen} />
        <RootStack.Screen name="Recetas" component={RecipesScreen} />
        <RootStack.Screen name="Registros" component={RecordsScreen} />
        <RootStack.Screen name="Recomendaciones" component={RoutineNotesScreen} />
        <RootStack.Screen name="Experimentos" component={ExperimentsScreen} />
        <RootStack.Screen name="Lecturas" component={ReadingsScreen} />
        <RootStack.Screen name="Resumen semanal" component={WeekSummaryScreen} />
      </RootStack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  // Sin la fuente cargada el primer cuadro sale con la del sistema y salta a la
  // buena, que se ve peor que esperar dos parpadeos.
  const [ready] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });
  // Arriba del navegador porque el menu lateral tambien lo necesita, y vive por fuera
  // para quedar encima de la barra de abajo y del encabezado.
  const navigation = useNavigationContainerRef();
  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <AppDataProvider>
        <TransitJourneyProvider>
          <SwipeLockProvider>
            <SidebarProvider navigation={navigation}>
              <BackgroundEditingProvider>
                {/* La barra de arriba aparta el hueco donde se guarda la bola, y la bola
                  vive por fuera del navegador: los dos se hablan por aqui. */}
                <AssistantDockProvider>
                  {/* El globito de la (i) se dibuja aqui para que no lo recorte la lista
                    dentro de la que vive el boton que lo abre. */}
                  <InfoProvider>
                    <PagerPositionProvider>
                      <Navigation navigation={navigation} />
                    </PagerPositionProvider>
                  </InfoProvider>
                  {/* Encima de todo menos del menu lateral, que si la tapa. */}
                  <Assistant />
                </AssistantDockProvider>
                {/* Y el editor de fondos encima de la bola, sobre la pantalla que prueba. */}
                <BackgroundEditorPanel />
              </BackgroundEditingProvider>
            </SidebarProvider>
          </SwipeLockProvider>
          {/* La barra que corona el teclado del sistema, una sola para toda la app. */}
          <KeyboardBar />
          {/* Una sola paleta, oscura: la barra de estado va siempre en claro. */}
          <StatusBar style="light" />
        </TransitJourneyProvider>
      </AppDataProvider>
    </SafeAreaProvider>
  );
}

/**
 * Cada pantalla apilada lleva su propio fondo, opaco: con uno solo detras de todas, la
 * pantalla de abajo se veia a traves de la nueva mientras entraba deslizandose. Es el
 * resto del mismo fondo que lleva la barra de arriba, cortado justo donde ella acaba.
 */
function ScreenFrame({ children, screens }: { children: ReactNode; screens: readonly string[] }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.frame}>
      <Backdrop screens={screens} offset={topBarHeight(insets.top)} />
      {children}
    </View>
  );
}

const styles = sheet((theme) => ({
  tabs: {
    flex: 1,
  },
  clear: {
    backgroundColor: 'transparent',
  },
  frame: {
    flex: 1,
    backgroundColor: theme.bg,
  },
}));
