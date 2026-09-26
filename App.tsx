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
import { Pressable, StyleSheet, Text } from 'react-native';
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

import { NumberPadHost, useNumberPad } from './src/ui/NumberPadHost.tsx';
import { mono, theme } from './src/ui/theme.ts';
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
    card: theme.bg,
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
          headerStyle: { backgroundColor: theme.bg },
          headerTintColor: theme.text,
          headerTitleStyle: { fontFamily: mono, fontSize: 15 },
          contentStyle: { backgroundColor: theme.bg },
        }}
      >
        <RootStack.Screen
          name="nexo"
          component={TabsScreen}
          options={({ navigation }) => ({
            // El nombre de la ruta es el titulo, y aqui el titulo es un prompt.
            title: 'nexo:~$',
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

export default function App() {
  return (
    <SafeAreaProvider>
      <NumberPadHost>
        <AppDataProvider>
          <Navigation />
          <StatusBar style="light" />
        </AppDataProvider>
      </NumberPadHost>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: theme.bg,
    borderTopWidth: 1,
    borderTopColor: theme.line,
  },
  tabItem: {
    paddingHorizontal: 4,
    paddingTop: 7,
    paddingBottom: 8,
  },
  tabLabel: {
    fontSize: 11,
    textTransform: 'lowercase',
    fontWeight: '400',
    fontFamily: mono,
    marginTop: 4,
  },
  tabIndicator: {
    backgroundColor: theme.accent,
    height: 2,
  },
  headerButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  headerButtonText: {
    fontSize: 13,
    fontFamily: mono,
    color: theme.accent,
  },
});
