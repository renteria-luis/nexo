import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import {
  DarkTheme,
  NavigationContainer,
  useNavigation,
  useNavigationContainerRef,
  type NavigationState,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Pressable, Text } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppDataProvider, useAppData } from './src/shell/AppData.tsx';
import { enabledTabs, type ModuleRegistry } from './src/modules/registry.ts';
import { DealsScreen } from './src/ui/screens/DealsScreen.tsx';
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
import { Dumbbell, LayoutGrid, Tag, Utensils, Wallet, type LucideIcon } from 'lucide-react-native';

import {
  Nunito_400Regular,
  Nunito_700Bold,
  Nunito_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/nunito';

import { NumberPadHost, useNumberPad } from './src/ui/NumberPadHost.tsx';
import { ThemeSkin } from './src/ui/ThemeSkin.tsx';
import { DARK, font, sheet, shape, theme } from './src/ui/theme.ts';
import { WeekSummaryScreen } from './src/ui/screens/WeekSummaryScreen.tsx';

const Tabs = createMaterialTopTabNavigator();
const RootStack = createNativeStackNavigator();

// Sin esto, React Navigation pinta sus propios fondos claros detras de cada pantalla
// y se ve un destello blanco cada vez que se abre una.
// Se llama al montar, que es justo cuando la piel acaba de cambiar de paleta.
function navigationTheme() {
  return {
    ...DarkTheme,
    dark: theme === DARK,
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
}

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
  // La raya del gestor de iOS se dibuja encima de todo, asi que la barra se levanta
  // por encima de ella en vez de compartirle el sitio.
  const insets = useSafeAreaInsets();

  return (
    <Tabs.Navigator
      // La barra va abajo aunque las paginas sean un pager: es donde llega el pulgar.
      tabBarPosition="bottom"
      screenOptions={{
        // Sin scroll: cinco pestanas caben en un telefono y con scroll quedaban
        // apretadas a la izquierda con un hueco muerto a la derecha.
        tabBarScrollEnabled: false,
        tabBarShowIcon: true,
        tabBarLabelStyle: styles.tabLabel,
        tabBarItemStyle: styles.tabItem,
        tabBarIndicatorStyle: styles.tabIndicator,
        tabBarStyle: [styles.tabBar, { paddingBottom: insets.bottom }],
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textGhost,
        tabBarPressColor: theme.surfaceHigh,
      }}
    >
      {tabs.map((tab) => (
        <Tabs.Screen
          key={tab.id}
          name={tab.label}
          options={{
            tabBarIcon: ({ color }) => {
              const Icon = TAB_ICONS[tab.id] ?? LayoutGrid;
              return <Icon size={20} color={color} strokeWidth={1.75} />;
            },
          }}
        >
          {() => (tab.id === 'today' ? <TodayTab /> : <tab.screen />)}
        </Tabs.Screen>
      ))}
    </Tabs.Navigator>
  );
}

function SettingsRoute() {
  const { state, saveSetting, removeSetting, logDay, resetDatabase, exportData, importData } =
    useAppData();
  if (state.phase !== 'ready') return null;

  return (
    <SettingsScreen
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

function Navigation({
  initialState,
  onState,
}: {
  initialState: NavigationState | undefined;
  onState: (state: NavigationState | undefined) => void;
}) {
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
    <NavigationContainer
      ref={navigation}
      theme={navigationTheme()}
      initialState={initialState}
      onStateChange={(state) => {
        onState(state);
        pad.close();
      }}
    >
      <RootStack.Navigator
        screenOptions={{
          // El encabezado nativo solo deja cambiarle el color: la raya negra de
          // debajo la pone el borde de arriba de cada pantalla.
          headerStyle: { backgroundColor: theme.surface },
          headerShadowVisible: false,
          headerTintColor: theme.text,
          headerTitleStyle: { fontFamily: font.black, fontSize: 19, color: theme.text },
          contentStyle: { backgroundColor: theme.bg },
        }}
      >
        <RootStack.Screen
          name="nexo"
          component={TabsScreen}
          options={({ navigation }) => ({
            title: 'nexo',
            headerRight: () => (
              <HeaderButton label="Ajustes" onPress={() => navigation.navigate('Ajustes')} />
            ),
          })}
        />
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

/**
 * La piel lee de los ajustes si toca claro u oscuro. Vive dentro del proveedor de
 * datos porque de ahi salen los ajustes, y por fuera de la navegacion porque al
 * cambiar de paleta monta el arbol de nuevo.
 */
/**
 * Donde estaba parado, para devolverlo ahi cuando la piel cambia.
 *
 * Cambiar de modo monta la navegacion de nuevo para que todo se pinte con la paleta
 * nueva, y eso la devolveria al inicio: cambiar el modo desde Ajustes lo echaba a
 * Hoy. Vive fuera del componente porque el componente es justo lo que se desmonta.
 */
let place: NavigationState | undefined;

function Skin() {
  const { state } = useAppData();
  const skin = state.phase === 'ready' ? state.loaded.skin : DEFAULT_SKIN;

  return (
    <ThemeSkin mode={skin.mode} darkFrom={skin.darkFrom} darkTo={skin.darkTo}>
      <Navigation
        initialState={place}
        onState={(next) => {
          place = next;
        }}
      />
      <StatusBar style={theme === DARK ? 'light' : 'dark'} />
    </ThemeSkin>
  );
}

const DEFAULT_SKIN = { mode: 'claro' as const, darkFrom: 20, darkTo: 7 };

export default function App() {
  // Sin la fuente cargada el primer cuadro sale con la del sistema y salta a la
  // buena, que se ve peor que esperar dos parpadeos.
  const [ready] = useFonts({ Nunito_400Regular, Nunito_700Bold, Nunito_800ExtraBold });
  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <NumberPadHost>
        <AppDataProvider>
          <Skin />
        </AppDataProvider>
      </NumberPadHost>
    </SafeAreaProvider>
  );
}

const styles = sheet((theme) => ({
  tabBar: {
    backgroundColor: theme.surface,
    borderTopWidth: shape.border,
    borderTopColor: theme.line,
  },
  tabItem: {
    paddingHorizontal: 4,
    paddingTop: 8,
    paddingBottom: 8,
  },
  tabLabel: {
    fontSize: 11,
    textTransform: 'lowercase',
    fontFamily: font.bold,
    marginTop: 4,
  },
  // Con la barra abajo la raya sale arriba, encima del borde: es la pestana activa.
  tabIndicator: {
    backgroundColor: theme.accent,
    height: 4,
  },
  // Texto pelado y nada detras: iOS pone su propio fondo redondo a los botones de la
  // barra, y con el recuadro amarillo encima se veian dos fondos, uno dentro del otro.
  // El peso del diseno va en el contenido, no en la barra del sistema.
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
