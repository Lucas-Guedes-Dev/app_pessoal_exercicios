import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, AppState, StyleSheet, Text, View } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { closeDb, getDb, getProfile, useDatabase } from './src/db/database';
import { requestNotificationPermission, scheduleDailyReminders } from './src/notifications';
import { syncExercises } from './src/services/sync';
import { getSavedUser, signOut as authSignOut } from './src/services/auth';
import { databaseFileFor } from './src/services/account';
import { SessionContext } from './src/services/session-context';
import AuthScreen from './src/screens/AuthScreen';
import HomeScreen from './src/screens/HomeScreen';
import ExerciseFormScreen from './src/screens/ExerciseFormScreen';
import AllExercisesScreen from './src/screens/AllExercisesScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import WeekSettingsScreen from './src/screens/WeekSettingsScreen';
import EvolutionScreen from './src/screens/EvolutionScreen';
import ProfileFormScreen from './src/screens/ProfileFormScreen';
import CheckInScreen from './src/screens/CheckInScreen';
import GamesScreen from './src/screens/GamesScreen';
import GameFormScreen from './src/screens/GameFormScreen';
import GameLogScreen from './src/screens/GameLogScreen';
import FoodDiaryScreen from './src/screens/FoodDiaryScreen';
import FoodSearchScreen from './src/screens/FoodSearchScreen';
import FoodAmountScreen from './src/screens/FoodAmountScreen';
import CustomFoodScreen from './src/screens/CustomFoodScreen';
import ReportScreen from './src/screens/ReportScreen';
import { colors } from './src/theme';

const Stack = createNativeStackNavigator();
const navigationRef = createNavigationContainerRef();

// Abre a avaliação quando o lembrete do jogo é tocado
function openFromNotification(response) {
  const data = response?.notification?.request?.content?.data;
  if (data?.type === 'game' && data.gameId && navigationRef.isReady()) {
    navigationRef.navigate('GameLog', { gameId: data.gameId, date: data.date });
  }
}

// Primeiro login num aparelho que já tinha dados de antes das contas
function askClaimLegacyData() {
  return new Promise((resolve) => {
    Alert.alert(
      'Dados deste celular',
      'Encontramos treinos, histórico e alimentação salvos neste celular de antes das contas. Eles são seus?',
      [
        { text: 'Não, começar do zero', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Sim, são meus', onPress: () => resolve(true) },
      ],
      { cancelable: false }
    );
  });
}

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = verificando; null = sem conta
  const [ready, setReady] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);
  const [error, setError] = useState(null);

  // Abre a conta: escolhe o SQLite dela e segue o fluxo de sempre
  const openAccount = useCallback(async (account) => {
    setError(null);
    setReady(false);
    try {
      useDatabase(await databaseFileFor(account, askClaimLegacyData), account.id);
      await getDb(); // cria tabelas e migra se necessário
      setHasProfile(!!(await getProfile())); // sem perfil = primeira abertura
      setUser(account);
      setReady(true);
    } catch (e) {
      setUser(account);
      setError(String(e));
      return;
    }

    try {
      const granted = await requestNotificationPermission();
      if (granted) await scheduleDailyReminders();
    } catch (e) {
      console.warn('Falha ao configurar notificações:', e);
    }

    // Busca os dados do Supabase (sem internet, segue com o SQLite)
    await syncExercises();
  }, []);

  // Última conta usada neste aparelho: abre direto, mesmo sem internet
  useEffect(() => {
    getSavedUser().then((saved) => (saved ? openAccount(saved) : setUser(null)));
  }, [openAccount]);

  const signOut = useCallback(async () => {
    setReady(false);
    // os lembretes eram da conta que saiu
    await Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
    await authSignOut();
    await closeDb();
    setHasProfile(false);
    setError(null);
    setUser(null);
  }, []);

  const session = useMemo(() => ({ user, signOut }), [user, signOut]);

  // Volta do segundo plano: sincroniza de novo
  useEffect(() => {
    if (!ready) return;
    let previous = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && previous !== 'active') syncExercises();
      previous = next;
    });
    return () => sub.remove();
  }, [ready]);

  // Toque na notificação: com o app aberto ou vindo do segundo plano
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(openFromNotification);
    return () => sub.remove();
  }, []);

  // Toque que abriu o app do zero
  useEffect(() => {
    if (!ready) return;
    Notifications.getLastNotificationResponseAsync().then(openFromNotification).catch(() => {});
  }, [ready]);

  if (user === null) return <AuthScreen onSignedIn={openAccount} />;

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>Erro ao abrir o banco de dados:</Text>
        <Text>{error}</Text>
        <Text style={styles.link} onPress={signOut}>
          Sair da conta
        </Text>
      </View>
    );
  }

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <SessionContext.Provider value={session}>
      <NavigationContainer ref={navigationRef} key={user.id}>
        <StatusBar style="light" />
        <Stack.Navigator
          initialRouteName={hasProfile ? 'Home' : 'ProfileSetup'}
          screenOptions={{
            headerStyle: { backgroundColor: colors.primary },
            headerTintColor: '#fff',
            headerTitleStyle: { fontWeight: '700' },
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen
            name="ProfileSetup"
            component={ProfileFormScreen}
            initialParams={{ onboarding: true }}
            options={{ headerBackVisible: false, gestureEnabled: false }}
          />
          <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Treino de Hoje' }} />
          <Stack.Screen name="Evolution" component={EvolutionScreen} options={{ title: 'Minha Evolução' }} />
          <Stack.Screen name="Games" component={GamesScreen} options={{ title: 'Meus Jogos' }} />
          <Stack.Screen name="GameForm" component={GameFormScreen} options={{ title: 'Novo Jogo' }} />
          <Stack.Screen name="GameLog" component={GameLogScreen} options={{ title: 'Avaliar Jogo' }} />
          <Stack.Screen name="Food" component={FoodDiaryScreen} options={{ title: 'Alimentação' }} />
          <Stack.Screen name="FoodSearch" component={FoodSearchScreen} options={{ title: 'Adicionar' }} />
          <Stack.Screen name="FoodAmount" component={FoodAmountScreen} options={{ title: 'Quantidade' }} />
          <Stack.Screen name="CustomFood" component={CustomFoodScreen} options={{ title: 'Novo alimento' }} />
          <Stack.Screen name="Report" component={ReportScreen} options={{ title: 'Relatório em PDF' }} />
          <Stack.Screen name="EditProfile" component={ProfileFormScreen} />
          <Stack.Screen
            name="CheckIn"
            component={CheckInScreen}
            options={{ presentation: 'modal' }}
          />
          <Stack.Screen
            name="AllExercises"
            component={AllExercisesScreen}
            options={{ title: 'Treinos' }}
          />
          <Stack.Screen name="History" component={HistoryScreen} options={{ title: 'Histórico' }} />
          <Stack.Screen
            name="WeekSettings"
            component={WeekSettingsScreen}
            options={{ title: 'Semanas do Ciclo' }}
          />
          <Stack.Screen
            name="AddExercise"
            component={ExerciseFormScreen}
            options={{ title: 'Novo Exercício' }}
          />
          <Stack.Screen
            name="EditExercise"
            component={ExerciseFormScreen}
            options={{ title: 'Editar Exercício' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SessionContext.Provider>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: colors.background,
  },
  error: { fontWeight: '700', marginBottom: 8, color: colors.danger },
  link: { color: colors.primary, fontWeight: '700', marginTop: 20, padding: 8 },
});
