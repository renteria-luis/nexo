import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppDataProvider, useAppData } from './src/shell/AppData.tsx';
import { enabledTabs, type ModuleRegistry } from './src/modules/registry.ts';
import { ExperimentsScreen } from './src/ui/screens/ExperimentsScreen.tsx';
import { NutritionScreen } from './src/ui/screens/NutritionScreen.tsx';
import { PendingScreen } from './src/ui/screens/PendingScreen.tsx';
import { ReadingsScreen } from './src/ui/screens/ReadingsScreen.tsx';
import { RoutineNotesScreen } from './src/ui/screens/RoutineNotesScreen.tsx';
import { SettingsScreen } from './src/ui/screens/SettingsScreen.tsx';
import { TodayScreen } from './src/ui/screens/TodayScreen.tsx';
import { TrainingScreen } from './src/ui/screens/TrainingScreen.tsx';
import { WeekSummaryScreen } from './src/ui/screens/WeekSummaryScreen.tsx';

const Tabs = createMaterialTopTabNavigator();
const RootStack = createNativeStackNavigator();

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
      screen: () => (
        <PendingScreen
          title="Ofertas"
          note="El módulo de ofertas todavía no existe. Necesita un servicio aparte que recoja los precios de Flipp, y eso se construye después."
        />
      ),
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
  const navigation = useNavigation<{ navigate: (name: string) => void }>();
  return <TodayScreen onOpen={(name) => navigation.navigate(name)} />;
}

function TabsScreen() {
  const tabs = enabledTabs(registry);

  return (
    <Tabs.Navigator
      // The bar sits at the bottom but the pages still swipe, which bottom tabs
      // alone cannot do.
      tabBarPosition="bottom"
      screenOptions={{
        tabBarScrollEnabled: true,
        tabBarLabelStyle: styles.tabLabel,
        tabBarItemStyle: styles.tabItem,
        tabBarIndicatorStyle: styles.tabIndicator,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: '#111',
        tabBarInactiveTintColor: '#999',
      }}
    >
      {tabs.map((tab) => (
        <Tabs.Screen key={tab.id} name={tab.label}>
          {() => (tab.id === 'today' ? <TodayTab /> : <tab.screen />)}
        </Tabs.Screen>
      ))}
    </Tabs.Navigator>
  );
}

function SettingsRoute() {
  const { state, saveSetting, removeSetting, logDay, resetDatabase } = useAppData();
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
    />
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppDataProvider>
        <NavigationContainer>
          <RootStack.Navigator>
            <RootStack.Screen
              name="nexo"
              component={TabsScreen}
              options={({ navigation }) => ({
                headerRight: () => (
                  <HeaderButton label="Ajustes" onPress={() => navigation.navigate('Ajustes')} />
                ),
              })}
            />
            <RootStack.Screen
              name="Ajustes"
              component={SettingsRoute}
              options={({ navigation }) => ({
                presentation: 'modal',
                // A modal opened from a header needs its own way out; the default
                // back button here reads "nexo", which says nothing about closing.
                headerLeft: () => <HeaderButton label="Listo" onPress={navigation.goBack} />,
              })}
            />
            <RootStack.Screen
              name="Recomendaciones"
              component={RoutineNotesScreen}
              options={({ navigation }) => ({
                presentation: 'modal',
                headerLeft: () => <HeaderButton label="Listo" onPress={navigation.goBack} />,
              })}
            />
            <RootStack.Screen
              name="Experimentos"
              component={ExperimentsScreen}
              options={({ navigation }) => ({
                presentation: 'modal',
                headerLeft: () => <HeaderButton label="Listo" onPress={navigation.goBack} />,
              })}
            />
            <RootStack.Screen
              name="Lecturas"
              component={ReadingsScreen}
              options={({ navigation }) => ({
                presentation: 'modal',
                headerLeft: () => <HeaderButton label="Listo" onPress={navigation.goBack} />,
              })}
            />
            <RootStack.Screen
              name="Resumen semanal"
              component={WeekSummaryScreen}
              options={({ navigation }) => ({
                presentation: 'modal',
                headerLeft: () => <HeaderButton label="Listo" onPress={navigation.goBack} />,
              })}
            />
          </RootStack.Navigator>
        </NavigationContainer>
        <StatusBar style="auto" />
      </AppDataProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: '#fff',
  },
  tabItem: {
    width: 'auto',
    paddingHorizontal: 14,
  },
  tabLabel: {
    fontSize: 11,
    textTransform: 'none',
    fontWeight: '400',
  },
  tabIndicator: {
    backgroundColor: '#111',
    height: 2,
  },
  headerButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  headerButtonText: {
    fontSize: 13,
  },
});
