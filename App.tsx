import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import Ionicons from '@expo/vector-icons/Ionicons';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { store } from './src/lib/store';
import { User } from './src/types';
import { colors } from './src/theme';

import AuthScreen from './src/screens/AuthScreen';
import HomeScreen from './src/screens/HomeScreen';
import AnalyzeScreen from './src/screens/AnalyzeScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import SubscriptionScreen from './src/screens/SubscriptionScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import AdminScreen from './src/screens/AdminScreen';
import FloatingAssistant from './src/components/FloatingAssistant';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const navTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.surface, border: colors.border, primary: colors.primary, text: colors.text },
};

const ICONS: Record<string, any> = {
  HomeTab: 'home', AnalyzeTab: 'scan', HistoryTab: 'time', ProfileTab: 'person',
};

function Tabs({ user, onUserChange }: { user: User; onUserChange: (u: User) => void }) {
  const [overlay, setOverlay] = useState(false);
  return (
    <View style={{ flex: 1 }}>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Ionicons name={ICONS[route.name] ?? 'ellipse'} size={size} color={color} />,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textFaint,
          tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 62, paddingBottom: 8, paddingTop: 7 },
          tabBarLabelStyle: { fontSize: 10.5, fontWeight: '700' },
        })}
      >
        <Tab.Screen name="HomeTab">
          {(props) => <HomeScreen user={user} onUserChange={onUserChange} assistantOn={overlay} onAssistantToggle={setOverlay} onNavigate={(r) => props.navigation.navigate(r as any)} />}
        </Tab.Screen>
        <Tab.Screen name="AnalyzeTab" options={{ title: 'تحليل' }}>
          {(props) => <AnalyzeScreen user={user} onUserChange={onUserChange} onNavigate={(r) => props.navigation.navigate(r as any)} />}
        </Tab.Screen>
        <Tab.Screen name="HistoryTab" options={{ title: 'السجل' }}>
          {() => <HistoryScreen user={user} />}
        </Tab.Screen>
        <Tab.Screen name="ProfileTab" options={{ title: 'ملفي' }}>
          {() => <ProfileScreen user={user} onUserChange={onUserChange} />}
        </Tab.Screen>
      </Tab.Navigator>
      <FloatingAssistant active={(user.role === 'admin' || store.isSubscriptionActive(user)) && overlay} onPress={() => setOverlay(false)} />
    </View>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({ ...Ionicons.font });
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    (async () => {
      await store.init();
      try {
        const sessionUser = await store.session();
        setUser(sessionUser);
      } catch {
        // Keep the sign-in screen usable if the backend is temporarily unreachable.
        setUser(null);
      } finally { setReady(true); }
    })();
  }, []);

  const onUserChange = useCallback((u: User) => setUser({ ...u }), []);
  const logout = useCallback(async () => { await store.logout(); setUser(null); }, []);

  if (!fontsLoaded || !ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <NavigationContainer theme={navTheme}>
          {!user ? (
            <AuthScreen onDone={(u) => setUser(u)} />
          ) : (
            <Stack.Navigator
              screenOptions={{
                headerStyle: { backgroundColor: colors.surface },
                headerTintColor: colors.text,
                headerTitleStyle: { fontWeight: '800' },
                contentStyle: { backgroundColor: colors.bg },
              }}
            >
              <Stack.Screen name="Main" options={{ headerShown: false }}>
                {() => <Tabs user={user} onUserChange={onUserChange} />}
              </Stack.Screen>
              <Stack.Screen name="Subscription" options={{ title: 'الاشتراك', headerBackTitle: 'رجوع' }}>
                {() => <SubscriptionScreen user={user} onUserChange={onUserChange} />}
              </Stack.Screen>
              <Stack.Screen name="Settings" options={{ title: 'الإعدادات', headerBackTitle: 'رجوع' }}>
                {() => <SettingsScreen user={user} onLogout={logout} />}
              </Stack.Screen>
              <Stack.Screen name="Admin" options={{ title: 'لوحة الإدارة', headerBackTitle: 'رجوع' }}>
                {() => <AdminScreen user={user} />}
              </Stack.Screen>
            </Stack.Navigator>
          )}
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
