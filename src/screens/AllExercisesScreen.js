import { useCallback, useLayoutEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Chip from '../components/Chip';
import { deleteExercise, getAllExercises, getCurrentWeek } from '../db/database';
import { scheduleDailyReminders } from '../notifications';
import { colors } from '../theme';
import { WEEKDAYS_DISPLAY, weekdayCode, weekdayName } from '../utils/dates';
import { hasDay, hasWeek, lettersFor } from '../utils/weeks';

// Agrupa por dia da semana (Seg → Dom). Um exercício de "Seg,Qua" aparece nos dois dias.
function groupByDay(exercises) {
  return WEEKDAYS_DISPLAY.map((code) => ({
    code,
    title: weekdayName(code),
    data: exercises.filter((e) => hasDay(e, code)),
  }));
}

export default function AllExercisesScreen({ navigation }) {
  const [exercises, setExercises] = useState([]);
  const [current, setCurrent] = useState(null);
  const [selected, setSelected] = useState(null); // letra da semana exibida
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => navigation.navigate('AddExercise', { week: selected })}
          hitSlop={10}
          style={({ pressed }) => pressed && { opacity: 0.6 }}
        >
          <Text style={styles.headerButtonText}>+ Novo</Text>
        </Pressable>
      ),
    });
  }, [navigation, selected]);

  const load = useCallback(async () => {
    const [rows, week] = await Promise.all([getAllExercises(), getCurrentWeek()]);
    setExercises(rows);
    setCurrent(week);
    // começa mostrando a semana atual; se a selecionada saiu do ciclo, volta pra atual
    setSelected((prev) => (prev && lettersFor(week.count).includes(prev) ? prev : week.letter));
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

  const confirmDelete = (item) => {
    const where = [];
    if (item.weeks.includes(',')) where.push(`semanas ${item.weeks.replace(/,/g, ', ')}`);
    if (item.days.includes(',')) where.push(`dias ${item.days.replace(/,/g, ', ')}`);
    Alert.alert(
      'Excluir exercício',
      `Remover "${item.name}" do plano?${where.length ? `\n\nEle será removido de todos os lugares (${where.join('; ')}).` : ''}`,
      [
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
      ]
    );
  };

  if (loading || !current || !selected) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const letters = lettersFor(current.count);
  const weekExercises = exercises.filter((e) => hasWeek(e, selected));
  const sections = groupByDay(weekExercises);
  const isCurrentWeek = selected === current.letter;
  const todayCode = weekdayCode();

  return (
    <SectionList
      style={styles.container}
      contentContainerStyle={styles.content}
      sections={sections}
      keyExtractor={(item, index) => `${item.id}-${index}`}
      stickySectionHeadersEnabled={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
      }
      ListHeaderComponent={
        <View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
            {letters.map((l) => (
              <Chip
                key={l}
                label={`Semana ${l}${l === current.letter ? ' •' : ''}`}
                selected={selected === l}
                onPress={() => setSelected(l)}
              />
            ))}
          </ScrollView>
          <Text style={styles.summary}>
            Semana {selected}
            {isCurrentWeek ? ' (atual)' : ''} · {weekExercises.length}{' '}
            {weekExercises.length === 1 ? 'exercício' : 'exercícios'}
            {'  ·  '}
            {exercises.length} no total
          </Text>
        </View>
      }
      renderSectionHeader={({ section }) => {
        const isToday = isCurrentWeek && section.code === todayCode;
        return (
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, isToday && styles.sectionTitleToday]}>
              {section.title}
            </Text>
            {isToday && (
              <View style={styles.todayBadge}>
                <Text style={styles.todayBadgeText}>HOJE</Text>
              </View>
            )}
            <Text style={styles.sectionCount}>
              {section.data.length === 0 ? 'descanso' : section.data.length}
            </Text>
          </View>
        );
      }}
      renderSectionFooter={({ section }) =>
        section.data.length === 0 ? (
          <Text style={styles.restText}>Nenhum exercício neste dia.</Text>
        ) : null
      }
      renderItem={({ item }) => (
        <Pressable
          onPress={() => navigation.navigate('EditExercise', { exerciseId: item.id })}
          onLongPress={() => confirmDelete(item)}
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}
        >
          <Text style={styles.name}>{item.name}</Text>
          {!!item.details && <Text style={styles.details}>{item.details}</Text>}
          {(item.days.includes(',') || item.weeks.includes(',')) && (
            <Text style={styles.repeat}>
              {item.days.includes(',') ? `Dias: ${item.days.replace(/,/g, ' · ')}` : ''}
              {item.days.includes(',') && item.weeks.includes(',') ? '   ' : ''}
              {item.weeks.includes(',') ? `Semanas: ${item.weeks.replace(/,/g, ' · ')}` : ''}
            </Text>
          )}
        </Pressable>
      )}
      ListFooterComponent={
        weekExercises.length > 0 ? (
          <Text style={styles.hint}>Toque para editar · segure para excluir</Text>
        ) : (
          <Text style={styles.hint}>Toque em "+ Novo" para montar a Semana {selected}</Text>
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  headerButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  filters: { gap: 8, paddingBottom: 4 },
  summary: { fontSize: 13, color: colors.muted, marginTop: 10, marginBottom: 4 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginTop: 18, marginBottom: 8 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  sectionTitleToday: { color: colors.primary },
  todayBadge: {
    backgroundColor: colors.primary,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 8,
  },
  todayBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  sectionCount: { marginLeft: 'auto', fontSize: 13, color: colors.muted },
  restText: { fontSize: 13, color: colors.muted, fontStyle: 'italic', marginBottom: 4 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e6ebe8',
  },
  name: { fontSize: 16, fontWeight: '600', color: colors.text },
  details: { fontSize: 13, color: colors.muted, marginTop: 3 },
  repeat: { fontSize: 12, color: colors.primary, marginTop: 6, fontWeight: '500' },
  hint: { textAlign: 'center', fontSize: 12, color: colors.muted, marginTop: 16 },
});
