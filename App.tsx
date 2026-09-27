import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import {
  DarkTheme,
  NavigationContainer,
  useNavigation,
  useNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppDataProvider, useAppData } from './src/shell/AppData.tsx';
import { enabledTabs, type ModuleRegistry } from './src/modules/registry.ts';
import { DealsScreen } from './src/ui/screens/DealsScreen.tsx';
import { ExerciseScreen, ExercisesScreen } from './src/ui/screens/ExercisesScreen.tsx';
import { ExperimentsScreen } from './src/ui/screens/ExperimentsScreen.tsx';
import { NutritionScreen } from './src/ui/screens/NutritionScreen.tsx';
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
import { Dumbbell, LayoutGrid, Tag, Utensils, Wallet, type LucideIcon } from './src/ui/icons.ts';

import { ArchivoBlack_400Regular } from '@expo-google-fonts/archivo-black';
import {
  Nunito_400Regular,
  Nunito_700Bold,
  Nunito_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/nunito';

import { NumberPadHost, useNumberPad } from './src/ui/NumberPadHost.tsx';
import { SwipeLockProvider, useSwipeLock } from './src/ui/SwipeLock.tsx';
import { FloatingBarSpace, TabBar, tabBarSpace } from './src/ui/TabBar.tsx';
import { TopBar } from './src/ui/TopBar.tsx';
import { font, sheet, theme } from './src/ui/theme.ts';
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
    {
      id: 'deals',
      label: 'Ofertas',
      enabled: true,
      screen: DealsScreen,
    },
    {
      id: 'finance',
      label: 'Finanzas',
      enabled: true,
      screen: () => (
        <PendingScreen
          title="Finanzas"
          note="El módulo de finanzas todavía no existe. Entra al final, y compartirá el motor de puntuación y la cuadrícula con el resto."
        />
      ),
    },
  ],
};

/** Un icono por pestana: a un metro de distancia se reconoce antes que la palabra. */
const TAB_ICONS: Record<string, LucideIcon> = {
  today: LayoutGrid,
  training: Dumbbell,
  nutrition: Utensils,
  deals: Tag,
  finance: Wallet,
};

function HeaderButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityLabel={label} onPress={onPress} style={styles.headerButton}>
      <Text style={styles.headerButtonText}>{label}</Text>
    </Pressable>
  );
}

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
  const navigation = useNavigation<{ navigate: (name: string) => void }>();
  // La barra de abajo flota encima de las paginas, asi que el hueco que tapa lo tiene
  // que dejar libre cada pantalla al final de su contenido.
  const insets = useSafeAreaInsets();

  return (
    // La barra de arriba vive fuera del carrusel para quedarse quieta mientras las
    // paginas se deslizan por debajo.
    <View style={styles.tabs}>
      <TopBar onSettings={() => navigation.navigate('Ajustes')} />
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
  const { state, saveSetting, removeSetting, logDay, resetDatabase, exportData, importData } =
    useAppData();
  const navigation = useNavigation<{ navigate: (name: string) => void }>();
  if (state.phase !== 'ready') return null;

  return (
    <SettingsScreen
      onOpenExercises={() => navigation.navigate('Ejercicios')}
      settings={state.loaded.settings}
      palette={state.loaded.palette}
      todayWeightKg={state.loaded.today.log?.weight_kg ?? null}
      onSaveSetting={saveSetting}
      onClearSetting={removeSetting}
      onSaveWeight={(weightKg) => logDay({ weightKg })}
      onSelectPalette={(next) => saveSetting('palette', next)}
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
/** A donde lleva cada aviso al tocarlo: spec 18 pide que caiga donde se anota eso. */
const NUDGE_ROUTES: Record<string, string> = {
  comida: 'Comida',
  entreno: 'Entreno',
  agua: 'Hoy',
  manana: 'Hoy',
  cierre: 'Hoy',
  semana: 'Resumen semanal',
};

function Navigation() {
  const pad = useNumberPad();
  const { nudgeTarget, clearNudgeTarget } = useAppData();
  const navigation = useNavigationContainerRef();

  useEffect(() => {
    if (nudgeTarget === null) return;
    const route = NUDGE_ROUTES[nudgeTarget];
    if (route && navigation.isReady()) navigation.navigate(route as never);
    clearNudgeTarget();
  }, [nudgeTarget, clearNudgeTarget, navigation]);

  return (
    <NavigationContainer ref={navigation} theme={navigationTheme} onStateChange={pad.close}>
      <RootStack.Navigator
        screenOptions={{
          // El encabezado nativo solo deja cambiarle el color: la raya negra de
          // debajo la pone el borde de arriba de cada pantalla.
          headerStyle: { backgroundColor: theme.bg },
          headerShadowVisible: false,
          headerTintColor: theme.text,
          headerTitleStyle: { fontFamily: font.display, fontSize: 18, color: theme.text },
          contentStyle: { backgroundColor: theme.bg },
        }}
      >
        <RootStack.Screen name="nexo" component={TabsScreen} options={{ headerShown: false }} />
        <RootStack.Screen
          name="Ajustes"
          component={SettingsRoute}
          options={({ navigation }) => ({
            // Nada de modales: un modal de iOS se presenta en su propia ventana y el
            // teclado de la app, que vive en la raiz, quedaba debajo y sin poder
            // tocarse. Apilada, la pantalla comparte arbol con el teclado.
            headerLeft: () => <HeaderButton label="Listo" onPress={navigation.goBack} />,
          })}
        />
        <RootStack.Screen
          name="Día"
          component={DayScreen}
          options={({ navigation }) => ({
            headerLeft: () => <HeaderButton label="Listo" onPress={navigation.goBack} />,
          })}
        />
        <RootStack.Screen
          name="Gráficas"
          component={ChartsScreen}
          options={({ navigation }) => ({
            headerLeft: () => <HeaderButton label="Listo" onPress={navigation.goBack} />,
          })}
        />
        <RootStack.Screen
          name="Ejercicios"
          component={ExercisesScreen}
          options={({ navigation }) => ({
            headerLeft: () => <HeaderButton label="Listo" onPress={navigation.goBack} />,
          })}
        />
        {/* La ficha es su propia pantalla: asi el gesto de volver regresa a la lista. */}
        <RootStack.Screen name="Ejercicio" component={ExerciseScreen} />
        <RootStack.Screen
          name="Alimentos"
          component={FoodsScreen}
          options={({ navigation }) => ({
            headerLeft: () => <HeaderButton label="Listo" onPress={navigation.goBack} />,
          })}
        />
        <RootStack.Screen
          name="Registros"
          component={RecordsScreen}
          options={({ navigation }) => ({
            headerLeft: () => <HeaderButton label="Listo" onPress={navigation.goBack} />,
          })}
        />
        <RootStack.Screen
          name="Recomendaciones"
          component={RoutineNotesScreen}
          options={({ navigation }) => ({
            headerLeft: () => <HeaderButton label="Listo" onPress={navigation.goBack} />,
          })}
        />
        <RootStack.Screen
          name="Experimentos"
          component={ExperimentsScreen}
          options={({ navigation }) => ({
            headerLeft: () => <HeaderButton label="Listo" onPress={navigation.goBack} />,
          })}
        />
        <RootStack.Screen
          name="Lecturas"
          component={ReadingsScreen}
          options={({ navigation }) => ({
            headerLeft: () => <HeaderButton label="Listo" onPress={navigation.goBack} />,
          })}
        />
        <RootStack.Screen
          name="Resumen semanal"
          component={WeekSummaryScreen}
          options={({ navigation }) => ({
            headerLeft: () => <HeaderButton label="Listo" onPress={navigation.goBack} />,
          })}
        />
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
  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <NumberPadHost>
        <AppDataProvider>
          <SwipeLockProvider>
            <Navigation />
          </SwipeLockProvider>
          {/* Una sola paleta, clara: la barra de estado va siempre en oscuro. */}
          <StatusBar style="dark" />
        </AppDataProvider>
      </NumberPadHost>
    </SafeAreaProvider>
  );
}

const styles = sheet((theme) => ({
  tabs: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  // Texto pelado y nada detras: iOS pone su propio fondo redondo a los botones de la
  // barra del sistema, y con el recuadro encima se veian dos fondos, uno dentro del
  // otro. El relieve de este estilo vive en la barra propia de la pantalla principal.
  headerButton: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  headerButtonText: {
    fontSize: 16,
    fontFamily: font.black,
    color: theme.text,
  },
}));
