import { useCallback, useLayoutEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getGameLogs, getGames } from '../db/database';
import { colors } from '../theme';
import { formatDateBR, parseDateKey, toDateKey, weekdayCode, weekdayName } from '../utils/dates';
import { RESULTS, pendingEvaluations } from '../utils/games';

const RECENT = 15;

export default function GamesScreen({ navigation }) {
  const [games, setGames] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={() => navigation.navigate('GameForm')} hitSlop={10} style={({ pressed }) => pressed && { opacity: 0.6 }}>
          <Text style={styles.headerButtonText}>+ Novo</Text>
        </Pressable>
      ),
    });
  }, [navigation]);

  const load = useCallback(async () => {
    const [g, l] = await Promise.all([getGames(), getGameLogs()]);
    setGames(g);
    setLogs(l.reverse()); // mais recentes primeiro
  }, []);

  useFocusEffect(
    useCallback(() => {
      load()
        .catch((e) => Alert.alert('Erro', String(e)))
        .finally(() => setLoading(false));
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const todayCode = weekdayCode();
  const pending = pendingEvaluations(games, logs);
  const today = toDateKey(new Date());

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
    >
      {pending.length > 0 && (
        <>
          <Text style={styles.section}>Aguardando avaliação</Text>
          {pending.map(({ game, date }) => (
            <Pressable
              key={`${game.id}|${date}`}
              onPress={() => navigation.navigate('GameLog', { gameId: game.id, date })}
              style={({ pressed }) => [styles.pendingRow, pressed && { opacity: 0.7 }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.pendingName}>{game.name}</Text>
                <Text style={styles.pendingDate}>
                  {weekdayName(game.day)}, {formatDateBR(parseDateKey(date))}
                </Text>
              </View>
              <Text style={styles.pendingAction}>Avaliar →</Text>
            </Pressable>
          ))}
          <Text style={styles.hint}>Se não teve jogo nessa data, marque "Não teve jogo" na avaliação.</Text>
        </>
      )}

      <Text style={styles.section}>Jogos da semana</Text>

      {games.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Nenhum jogo cadastrado</Text>
          <Text style={styles.emptyText}>
            Cadastre os jogos que se repetem. O horário da partida você informa depois, na avaliação.
          </Text>
          <View style={styles.quickRow}>
            <Pressable
              style={styles.quickButton}
              onPress={() => navigation.navigate('GameForm', { name: 'Salão de terça', modality: 'Salão', day: 'Ter' })}
            >
              <Text style={styles.quickText}>Salão nas terças</Text>
            </Pressable>
            <Pressable
              style={styles.quickButton}
              onPress={() => navigation.navigate('GameForm', { name: 'Campo de sábado', modality: 'Campo', day: 'Sab' })}
            >
              <Text style={styles.quickText}>Campo nos sábados</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        games.map((g) => (
          <Pressable
            key={g.id}
            onPress={() => navigation.navigate('GameForm', { gameId: g.id })}
            style={({ pressed }) => [styles.card, g.day === todayCode && styles.cardToday, pressed && { opacity: 0.8 }]}
          >
            <View style={styles.rowBetween}>
              <Text style={styles.gameName}>{g.name}</Text>
              {g.day === todayCode && (
                <View style={styles.todayBadge}>
                  <Text style={styles.todayBadgeText}>HOJE</Text>
                </View>
              )}
            </View>
            <Text style={styles.gameSub}>
              {g.modality} · {weekdayName(g.day)} · lembrete {String(g.reminder_hour).padStart(2, '0')}:
              {String(g.reminder_minute).padStart(2, '0')}
            </Text>
            <View style={styles.actions}>
              {g.day === todayCode && (
                <Pressable
                  style={[styles.evaluate, { flex: 1 }]}
                  onPress={() => navigation.navigate('GameLog', { gameId: g.id, date: today })}
                >
                  <Text style={styles.evaluateText}>Avaliar hoje</Text>
                </Pressable>
              )}
              <Pressable
                style={[styles.evaluateOutline, { flex: 1 }]}
                onPress={() => navigation.navigate('GameLog', { gameId: g.id })}
              >
                <Text style={styles.evaluateOutlineText}>Avaliar outra data</Text>
              </Pressable>
            </View>
          </Pressable>
        ))
      )}

      {games.length > 0 && <Text style={styles.hint}>Toque em um jogo para editar ou excluir</Text>}

      <Text style={styles.section}>Últimas partidas</Text>
      {logs.length === 0 ? (
        <Text style={styles.muted}>Nenhuma avaliação ainda.</Text>
      ) : (
        logs.slice(0, RECENT).map((l) => (
          <Pressable
            key={l.id}
            onPress={() => navigation.navigate('GameLog', { gameId: l.game_id, date: l.date })}
            style={({ pressed }) => [styles.logCard, pressed && { opacity: 0.8 }]}
          >
            <View style={styles.rowBetween}>
              <Text style={styles.logDate}>{formatDateBR(parseDateKey(l.date))}</Text>
              <Text style={styles.logModality}>{l.modality}</Text>
            </View>
            {l.played === 0 ? (
              <Text style={styles.muted}>Não teve jogo</Text>
            ) : (
              <>
                <Text style={styles.logScores}>
                  Habilidade {l.skill} · Intensidade {l.intensity} · Físico {l.stamina}
                  {l.minutes != null ? ` · ${l.minutes} min` : ''}
                </Text>
                <Text style={styles.logExtra}>
                  {[
                    l.result ? RESULTS.find((r) => r.value === l.result)?.label : null,
                    l.opponent_level != null ? `adversário ${l.opponent_level}/5` : null,
                    l.goals ? `${l.goals} gol${l.goals > 1 ? 's' : ''}` : null,
                    l.assists ? `${l.assists} assist.` : null,
                    l.pain === 1 ? '⚠️ dor/lesão' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                {!!l.notes && <Text style={styles.logNotes}>{l.notes}</Text>}
              </>
            )}
          </Pressable>
        ))
      )}

      {logs.length > 0 && (
        <Pressable onPress={() => navigation.navigate('Evolution')} style={({ pressed }) => [styles.link, pressed && { opacity: 0.6 }]}>
          <Text style={styles.linkText}>Ver evolução nos gráficos →</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  headerButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  section: { fontSize: 13, fontWeight: '700', color: colors.muted, marginTop: 18, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  muted: { fontSize: 14, color: colors.muted },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e6ebe8' },
  cardToday: { borderColor: colors.primary, borderWidth: 2 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  gameName: { fontSize: 16, fontWeight: '700', color: colors.text, flex: 1 },
  gameSub: { fontSize: 13, color: colors.muted, marginTop: 3 },
  todayBadge: { backgroundColor: colors.primary, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  todayBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  evaluate: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  evaluateOutline: { borderWidth: 1, borderColor: colors.primary, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  evaluateOutlineText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff8e6',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#f0d58a',
  },
  pendingName: { fontSize: 15, fontWeight: '700', color: colors.text },
  pendingDate: { fontSize: 13, color: colors.muted, marginTop: 2 },
  pendingAction: { fontSize: 14, fontWeight: '700', color: colors.primary },
  evaluateText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  empty: { backgroundColor: colors.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#e6ebe8' },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  emptyText: { fontSize: 14, color: colors.muted, marginTop: 6, lineHeight: 20 },
  quickRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  quickButton: { flex: 1, borderWidth: 1, borderColor: colors.primary, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  quickText: { color: colors.primary, fontWeight: '600', fontSize: 13 },
  hint: { fontSize: 12, color: colors.muted, textAlign: 'center' },
  logCard: { backgroundColor: colors.card, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#e6ebe8' },
  logDate: { fontSize: 14, fontWeight: '700', color: colors.text },
  logModality: { fontSize: 12, color: colors.primary, fontWeight: '600' },
  logScores: { fontSize: 13, color: colors.text, marginTop: 4 },
  logExtra: { fontSize: 12, color: colors.muted, marginTop: 2 },
  logNotes: { fontSize: 12, color: colors.muted, marginTop: 4, fontStyle: 'italic' },
  link: { alignItems: 'center', paddingVertical: 16 },
  linkText: { color: colors.primary, fontWeight: '600', fontSize: 14 },
});
