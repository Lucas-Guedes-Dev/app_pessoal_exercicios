import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Chip from '../components/Chip';
import {
  getAllExercises,
  getCycleWeeks,
  getDoneCompletionsBetween,
  getWeekCount,
} from '../db/database';
import { colors } from '../theme';
import { formatShortBR, weekdayName } from '../utils/dates';
import { buildWeekSummary, toDoneSet } from '../utils/weekSummary';
import { lettersFor } from '../utils/weeks';

const ALL = 'Todas';

export default function HistoryScreen() {
  const [weeks, setWeeks] = useState([]);
  const [letters, setLetters] = useState([]);
  const [filter, setFilter] = useState(ALL);
  const [expanded, setExpanded] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [cycleWeeks, exercises, count] = await Promise.all([
      getCycleWeeks(),
      getAllExercises(),
      getWeekCount(),
    ]);
    if (cycleWeeks.length === 0) {
      setWeeks([]);
      return;
    }

    const first = cycleWeeks[0].weekStart;
    const completions = await getDoneCompletionsBetween(first, '9999-12-31');
    const doneSet = toDoneSet(completions);

    const summaries = cycleWeeks
      .map((w) => buildWeekSummary(w, exercises, doneSet))
      .reverse(); // mais recente primeiro

    // a semana atual já começa aberta
    setExpanded((prev) => (prev.size === 0 ? new Set([summaries[0].weekStart]) : prev));
    setLetters(lettersFor(count));
    setWeeks(summaries);
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

  const toggleExpanded = (weekStart) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(weekStart)) next.delete(weekStart);
      else next.add(weekStart);
      return next;
    });
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const currentStart = weeks[0]?.weekStart;
  const visible = filter === ALL ? weeks : weeks.filter((w) => w.letter === filter);
  const finished = visible.filter((w) => w.weekStart !== currentStart);
  const completeCount = finished.filter((w) => w.total > 0 && w.done === w.total).length;

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={visible}
      keyExtractor={(item) => item.weekStart}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
            {[ALL, ...letters].map((l) => (
              <Chip
                key={l}
                label={l === ALL ? ALL : `Semana ${l}`}
                selected={filter === l}
                onPress={() => setFilter(l)}
              />
            ))}
          </ScrollView>
          <Text style={styles.summaryText}>
            {finished.length === 0
              ? 'Nenhuma semana encerrada ainda.'
              : `${completeCount} de ${finished.length} ${finished.length === 1 ? 'semana encerrada concluída' : 'semanas encerradas concluídas'} 100%`}
          </Text>
        </View>
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            {filter === ALL ? 'Nenhuma semana registrada.' : `A Semana ${filter} ainda não aconteceu.`}
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <WeekCard
          week={item}
          isCurrent={item.weekStart === currentStart}
          expanded={expanded.has(item.weekStart)}
          onPress={() => toggleExpanded(item.weekStart)}
        />
      )}
    />
  );
}

function statusOf(week, isCurrent) {
  if (week.total === 0) return { label: 'Sem exercícios', color: colors.muted };
  if (week.done === week.total) return { label: 'Concluída ✅', color: colors.primary };
  if (isCurrent) return { label: 'Em andamento', color: '#b7791f' };
  return { label: 'Incompleta', color: colors.danger };
}

function WeekCard({ week, isCurrent, expanded, onPress }) {
  const status = statusOf(week, isCurrent);
  const progress = week.total ? week.done / week.total : 0;

  return (
    <Pressable onPress={onPress} style={[styles.card, isCurrent && styles.cardCurrent]}>
      <View style={styles.cardTop}>
        <View style={styles.letterBox}>
          <Text style={styles.letter}>{week.letter}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>
            Semana {week.letter} · Ciclo {week.cycle}
            {isCurrent ? '  (atual)' : ''}
          </Text>
          <Text style={styles.cardSub}>
            {formatShortBR(week.start)} a {formatShortBR(week.end)} · {week.done}/{week.total} concluídos
          </Text>
        </View>
        <Text style={styles.chevron}>{expanded ? '▲' : '▼'}</Text>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>
      <Text style={[styles.status, { color: status.color }]}>{status.label}</Text>

      {expanded && (
        <View style={styles.details}>
          {week.days
            .filter((d) => d.items.length > 0)
            .map((d) => (
              <View key={d.dateKey} style={styles.dayBlock}>
                <Text style={styles.dayTitle}>
                  {weekdayName(d.code)} · {formatShortBR(d.date)}
                </Text>
                {d.items.map((it) => (
                  <Text key={it.id} style={[styles.item, it.done ? styles.itemDone : styles.itemPending]}>
                    {it.done ? '✓' : '○'}  {it.name}
                  </Text>
                ))}
              </View>
            ))}
          {week.total === 0 && (
            <Text style={styles.itemPending}>Nenhum exercício cadastrado para a Semana {week.letter}.</Text>
          )}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  header: { marginBottom: 12 },
  filters: { gap: 8, paddingBottom: 4 },
  summaryText: { fontSize: 13, color: colors.muted, marginTop: 10 },
  empty: { alignItems: 'center', paddingVertical: 48 },
  emptyText: { fontSize: 14, color: colors.muted },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e6ebe8',
  },
  cardCurrent: { borderColor: colors.primary, borderWidth: 2 },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  letterBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  letter: { fontSize: 20, fontWeight: '800', color: colors.primary },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  cardSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  chevron: { fontSize: 12, color: colors.muted, marginLeft: 8 },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primaryLight,
    marginTop: 12,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 3 },
  status: { fontSize: 12, fontWeight: '600', marginTop: 6 },
  details: { marginTop: 10, borderTopWidth: 1, borderTopColor: '#eef1ef', paddingTop: 6 },
  dayBlock: { marginTop: 8 },
  dayTitle: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 4 },
  item: { fontSize: 14, marginLeft: 4, marginBottom: 2 },
  itemDone: { color: colors.primary },
  itemPending: { color: colors.muted },
});
