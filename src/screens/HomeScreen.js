import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Checkbox from '../components/Checkbox';
import {
  deleteExercise,
  getCurrentWeek,
  getExercisesForDay,
  getGameLogs,
  getGames,
  getGamesForDate,
  getPendingCheckInCycle,
  setCompletion,
} from '../db/database';
import { getDailyEnergy } from '../db/energy';
import { getEntriesForDate } from '../db/food';
import { isCheckInDismissed } from '../db/progress';
import { scheduleDailyReminders } from '../notifications';
import { onExercisesSynced, syncExercises } from '../services/sync';
import { colors } from '../theme';
import { formatDateBR, toDateKey, weekdayCode, weekdayName } from '../utils/dates';
import { formatKcal, sumNutrients } from '../utils/food';
import { pendingEvaluations } from '../utils/games';
import { lettersFor } from '../utils/weeks';

export default function HomeScreen({ navigation }) {
  const [today, setToday] = useState(() => new Date());
  const [week, setWeek] = useState(null);
  const [exercises, setExercises] = useState([]);
  const [games, setGames] = useState([]);
  const [pendingGames, setPendingGames] = useState(0);
  const [food, setFood] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => navigation.navigate('AddExercise')}
          hitSlop={10}
          style={({ pressed }) => pressed && { opacity: 0.6 }}
        >
          <Text style={styles.headerButtonText}>+ Novo</Text>
        </Pressable>
      ),
    });
  }, [navigation]);

  const load = useCallback(async () => {
    const now = new Date(); // recalcula o dia a cada carga (app pode ficar aberto após meia-noite)
    const current = await getCurrentWeek();
    const dateKey = toDateKey(now);
    const [rows, todayGames, allGames, allLogs, foodEntries] = await Promise.all([
      getExercisesForDay(weekdayCode(now), current.letter, dateKey),
      getGamesForDate(weekdayCode(now), dateKey),
      getGames(),
      getGameLogs(),
      getEntriesForDate(dateKey),
    ]);
    const spent = await getDailyEnergy(dateKey, dateKey);
    setFood({ ...sumNutrients(foodEntries), items: foodEntries.length, spent: spent.byDate.get(dateKey)?.total ?? null });
    setPendingGames(pendingEvaluations(allGames, allLogs).length);
    setToday(now);
    setWeek(current);
    setExercises(rows);
    setGames(todayGames);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load()
        .catch((e) => Alert.alert('Erro', String(e)))
        .finally(() => setLoading(false));

      // Ciclo de semanas encerrado e sem medição no ciclo novo: pede as medidas
      let active = true;
      getPendingCheckInCycle()
        .then((endedCycle) => {
          if (active && endedCycle && !isCheckInDismissed()) {
            navigation.navigate('CheckIn', { endedCycle });
          }
        })
        .catch(() => {});
      return () => {
        active = false;
      };
    }, [load, navigation])
  );

  // Sincronização em segundo plano (ex.: app voltou do background) trouxe mudanças
  useEffect(() => onExercisesSynced(() => load().catch(() => {})), [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await syncExercises();
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const toggle = async (item) => {
    const newDone = item.done ? 0 : 1;
    // atualização otimista
    setExercises((prev) => prev.map((e) => (e.id === item.id ? { ...e, done: newDone } : e)));
    try {
      await setCompletion(item.id, toDateKey(today), newDone);
    } catch (e) {
      setExercises((prev) => prev.map((ex) => (ex.id === item.id ? { ...ex, done: item.done } : ex)));
      Alert.alert('Erro ao salvar', String(e));
    }
  };

  const openActions = (item) => {
    if (item.remote_id) {
      Alert.alert(item.name, `${item.details ? `${item.details}

` : ''}Gerenciado pelo Claude: para mudar ou remover, peça no chat.`, [
        { text: 'Fechar', style: 'cancel' },
        { text: 'Tipo e duração', onPress: () => navigation.navigate('EditExercise', { exerciseId: item.id }) },
      ]);
      return;
    }
    Alert.alert(item.name, item.details || undefined, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Excluir', style: 'destructive', onPress: () => confirmDelete(item) },
      { text: 'Editar', onPress: () => navigation.navigate('EditExercise', { exerciseId: item.id }) },
    ]);
  };

  const confirmDelete = (item) => {
    Alert.alert('Excluir exercício', `Remover "${item.name}" do plano?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: async () => {
          await deleteExercise(item.id);
          await load();
          scheduleDailyReminders().catch(() => {});
        },
      },
    ]);
  };

  const doneCount = exercises.filter((e) => e.done).length;
  const total = exercises.length;
  const progress = total ? doneCount / total : 0;
  const dayCode = weekdayCode(today);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const letters = week ? lettersFor(week.count) : [];

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={exercises}
      keyExtractor={(item) => String(item.id)}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
      }
      ListHeaderComponent={
        <View style={styles.summary}>
          {week && (
            <View style={styles.weekRow}>
              <View style={styles.weekBadge}>
                <Text style={styles.weekBadgeText}>Semana {week.letter}</Text>
              </View>
              <Text style={styles.cycleText}>
                Ciclo {week.cycle} · {letters.join(' → ')}
              </Text>
            </View>
          )}
          <Text style={styles.day}>{weekdayName(dayCode)}</Text>
          <Text style={styles.date}>{formatDateBR(today)}</Text>
          {total > 0 && (
            <>
              <Text style={styles.counter}>
                {doneCount}/{total} concluídos{doneCount === total ? ' 🎉' : ''}
              </Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
              </View>
            </>
          )}

          {games.map((g) => (
            <GameCard
              key={g.id}
              game={g}
              onPress={() => navigation.navigate('GameLog', { gameId: g.id, date: toDateKey(today) })}
            />
          ))}

          {food && (
            <Pressable
              onPress={() => navigation.navigate('Food')}
              style={({ pressed }) => [styles.foodCard, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.foodTitle}>🍽️ Alimentação hoje</Text>
              {food.items > 0 ? (
                <Text style={styles.foodValues}>
                  <Text style={styles.foodKcal}>{formatKcal(food.kcal)}</Text>
                  {food.spent != null ? ` de ${formatKcal(food.spent)} kcal gastas (previsto)` : ' kcal'}
                  {'\n'}P {Math.round(food.protein)} g · C {Math.round(food.carbs)} g · G {Math.round(food.fat)} g
                </Text>
              ) : (
                <Text style={styles.foodValues}>
                  Nada registrado ainda — toque para adicionar
                  {food.spent != null ? `\nGasto previsto hoje: ${formatKcal(food.spent)} kcal` : ''}
                </Text>
              )}
            </Pressable>
          )}

          <View style={styles.navRow}>
            <NavButton label="📈 Evolução" onPress={() => navigation.navigate('Evolution')} />
            <NavButton label="🍽️ Alimentação" onPress={() => navigation.navigate('Food')} />
            <NavButton
              label={pendingGames > 0 ? `🏆 Jogos · ${pendingGames} p/ avaliar` : '🏆 Jogos'}
              onPress={() => navigation.navigate('Games')}
            />
            <NavButton label="📅 Histórico" onPress={() => navigation.navigate('History')} />
            <NavButton label="📋 Treinos" onPress={() => navigation.navigate('AllExercises')} />
            <NavButton label="⚙️ Semanas" onPress={() => navigation.navigate('WeekSettings')} />
          </View>
        </View>
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Dia de descanso 🛌</Text>
          <Text style={styles.emptyText}>
            Nenhum exercício da Semana {week?.letter} programado para hoje.
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <Pressable
          onPress={() => toggle(item)}
          onLongPress={() => openActions(item)}
          style={({ pressed }) => [styles.card, item.done && styles.cardDone, pressed && { opacity: 0.8 }]}
        >
          <Checkbox checked={!!item.done} />
          <View style={styles.cardText}>
            <Text style={[styles.name, item.done && styles.nameDone]}>{item.name}</Text>
            {!!item.details && <Text style={styles.details}>{item.details}</Text>}
          </View>
        </Pressable>
      )}
      ListFooterComponent={
        total > 0 ? <Text style={styles.hint}>Toque para marcar · segure para editar ou excluir</Text> : null
      }
    />
  );
}

function GameCard({ game, onPress }) {
  const evaluated = game.log_id != null && game.played === 1;
  const notPlayed = game.log_id != null && game.played === 0;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.gameCard, pressed && { opacity: 0.85 }]}>
      <Text style={styles.gameTitle}>🏆 Jogo hoje · {game.modality}</Text>
      <Text style={styles.gameName}>{game.name}</Text>
      {evaluated ? (
        <Text style={styles.gameStatus}>
          Avaliado: habilidade {game.skill} · intensidade {game.intensity} · físico {game.stamina} — toque para editar
        </Text>
      ) : notPlayed ? (
        <Text style={styles.gameStatus}>Marcado como "não teve jogo" — toque para mudar</Text>
      ) : (
        <View style={styles.gameButton}>
          <Text style={styles.gameButtonText}>Avaliar jogo</Text>
        </View>
      )}
    </Pressable>
  );
}

function NavButton({ label, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.navButton, pressed && { opacity: 0.7 }]}
    >
      <Text style={styles.navButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  headerButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  summary: { marginBottom: 16 },
  weekRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 },
  weekBadge: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  weekBadgeText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  cycleText: { color: colors.muted, fontSize: 13 },
  day: { fontSize: 26, fontWeight: '700', color: colors.text },
  date: { fontSize: 14, color: colors.muted, marginTop: 2 },
  counter: { fontSize: 16, fontWeight: '600', color: colors.primary, marginTop: 12 },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primaryLight,
    marginTop: 8,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 4 },
  gameCard: {
    backgroundColor: colors.primaryLight,
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  gameTitle: { fontSize: 13, fontWeight: '700', color: colors.primary },
  gameName: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 2 },
  gameStatus: { fontSize: 13, color: colors.muted, marginTop: 6 },
  gameButton: { marginTop: 10, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  gameButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  foodCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#e6ebe8',
  },
  foodTitle: { fontSize: 13, fontWeight: '700', color: colors.muted },
  foodValues: { fontSize: 13, color: colors.muted, marginTop: 4 },
  foodKcal: { fontSize: 17, fontWeight: '800', color: colors.text },
  navRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8, marginTop: 16 },
  navButton: {
    width: '48.5%',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: '#e6ebe8',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  navButtonText: { fontSize: 13, fontWeight: '600', color: colors.text },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e6ebe8',
  },
  cardDone: { backgroundColor: colors.primaryLight, borderColor: colors.primaryLight },
  cardText: { flex: 1, marginLeft: 14 },
  name: { fontSize: 16, fontWeight: '600', color: colors.text },
  nameDone: { textDecorationLine: 'line-through', color: colors.muted },
  details: { fontSize: 13, color: colors.muted, marginTop: 3 },
  empty: { alignItems: 'center', paddingVertical: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: colors.text },
  emptyText: { fontSize: 14, color: colors.muted, marginTop: 6, textAlign: 'center' },
  hint: { textAlign: 'center', fontSize: 12, color: colors.muted, marginTop: 8 },
});
