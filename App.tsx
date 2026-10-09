import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import {
  DarkTheme,
  NavigationContainer,
  useNavigation,
  useNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Keyboard, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppDataProvider, useAppData } from './src/shell/AppData.tsx';
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
import { Dumbbell, LayoutGrid, Utensils, type LucideIcon } from './src/ui/icons.ts';

import { ArchivoBlack_400Regular } from '@expo-google-fonts/archivo-black';
import {
  Nunito_400Regular,
  Nunito_700Bold,
  Nunito_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/nunito';

import { InfoProvider } from './src/ui/InfoBubble.tsx';
import { KeyboardBar } from './src/ui/KeyboardBar.tsx';
import { Assistant } from './src/ui/Assistant.tsx';
import { goTo, nudgeDestination, type Navigate } from './src/ui/navigation.ts';
import { SidebarProvider, useSidebar } from './src/ui/Sidebar.tsx';
import { SwipeLockProvider, useSwipeLock } from './src/ui/SwipeLock.tsx';
import { FloatingBarSpace, TabBar, tabBarSpace } from './src/ui/TabBar.tsx';
import { TopBar } from './src/ui/TopBar.tsx';
import { sheet, theme } from './src/ui/theme.ts';
import { WeekSummaryScreen } from './src/ui/screens/WeekSummaryScreen.tsx';

const Tabs = createMaterialTopTabNavigator();
const RootStack = createNativeStackNavigator();

// Sin esto, React Navigation pinta sus propios fondos claros detras de cada pantalla
// y se ve un destello blanco cada vez que se abre una.
const navigationTheme = {
  ...DarkTheme,
  dark: false,
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

function TabsScreen() {
  const tabs = enabledTabs(registry);
  // Apagado mientras una pantalla arrastra algo: el gesto del carrusel es nativo y le
  // quita el toque a cualquier arrastre que no baje perfectamente recto.
  const { locked } = useSwipeLock();
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
          screenOptions={{ swipeEnabled: !locked }}
        >
          {tabs.map((tab) => (
            <Tabs.Screen
              key={tab.id}
              name={tab.label}
              options={{
                tabBarIcon: ({ color }) => {
                  const Icon = TAB_ICONS[tab.id] ?? LayoutGrid;
                  return <Icon size={21} color={color} strokeWidth={2.5} />;
                },
              }}
            >
              {() => (tab.id === 'today' ? <TodayTab /> : <tab.screen />)}
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
      onOpenExercises={() => navigation.navigate('Ejercicios')}
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
      theme={navigationTheme}
      // Cambiar de pantalla con el teclado abierto lo dejaba flotando sobre otra cosa.
      onStateChange={() => Keyboard.dismiss()}
    >
      <RootStack.Navigator
        screenOptions={{
          // Nuestra barra en lugar del encabezado nativo, que solo dejaba cambiarle el
          // color. En la pantalla principal lleva a Ajustes; en una apilada la cierra,
          // que es lo unico que se puede hacer desde ahi.
          header: ({ navigation, back, route }) =>
            back ? (
              <TopBar
                action="done"
                onPress={navigation.goBack}
                onMenu={sidebar.open}
                // En un dia suelto la fecha de arriba competiria con la del dia abierto.
                showDate={route.name !== 'Día'}
              />
            ) : (
              <TopBar
                action="settings"
                onPress={() => navigation.navigate('Ajustes')}
                onMenu={sidebar.open}
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
        {/* Ofertas dejo de ser pestana el 2026-09-28: lo que importa se avisa en Hoy y
            la lista entera vive aqui, a un toque de ese aviso. */}
        <RootStack.Screen name="Ofertas" component={DealsScreen} />
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
    ArchivoBlack_400Regular,
    Nunito_400Regular,
    Nunito_700Bold,
    Nunito_800ExtraBold,
  });
  // Arriba del navegador porque el menu lateral tambien lo necesita, y vive por fuera
  // para quedar encima de la barra de abajo y del encabezado.
  const navigation = useNavigationContainerRef();
  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <AppDataProvider>
        <SwipeLockProvider>
          <SidebarProvider navigation={navigation}>
            {/* El globito de la (i) se dibuja aqui para que no lo recorte la lista
                dentro de la que vive el boton que lo abre. */}
            <InfoProvider>
              <Navigation navigation={navigation} />
            </InfoProvider>
            {/* Encima de todo menos del menu lateral, que si la tapa. */}
            <Assistant />
          </SidebarProvider>
        </SwipeLockProvider>
        {/* La barra que corona el teclado del sistema, una sola para toda la app. */}
        <KeyboardBar />
        {/* Una sola paleta, clara: la barra de estado va siempre en oscuro. */}
        <StatusBar style="dark" />
      </AppDataProvider>
    </SafeAreaProvider>
  );
}

const styles = sheet((theme) => ({
  tabs: {
    flex: 1,
    backgroundColor: theme.bg,
  },
}));
