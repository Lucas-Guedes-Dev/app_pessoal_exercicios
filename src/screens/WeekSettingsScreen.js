import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Chip from '../components/Chip';
import {
  getAllExercises,
  getCurrentWeek,
  setCurrentWeekLetter,
  setWeekCount,
} from '../db/database';
import { scheduleDailyReminders } from '../notifications';
import { colors } from '../theme';
import { MAX_WEEKS, MIN_WEEKS, hasWeek, lettersFor } from '../utils/weeks';

export default function WeekSettingsScreen() {
  const [week, setWeek] = useState(null);
  const [exercises, setExercises] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [current, rows] = await Promise.all([getCurrentWeek(), getAllExercises()]);
    setWeek(current);
    setExercises(rows);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load().catch((e) => Alert.alert('Erro', String(e)));
    }, [load])
  );

  const run = async (action) => {
    setBusy(true);
    try {
      await action();
      await load();
      scheduleDailyReminders().catch(() => {});
    } catch (e) {
      Alert.alert('Erro', String(e));
    } finally {
      setBusy(false);
    }
  };

  const changeCount = (delta) => {
    const next = week.count + delta;
    if (next < MIN_WEEKS || next > MAX_WEEKS) return;

    if (delta < 0) {
      const removed = lettersFor(week.count)[week.count - 1];
      const orphan = exercises.filter(
        (e) => hasWeek(e, removed) && !e.weeks.split(',').some((l) => lettersFor(next).includes(l))
      ).length;
      if (orphan > 0) {
        Alert.alert(
          `Remover Semana ${removed}?`,
          `${orphan} exercício(s) estão só na Semana ${removed} e vão ficar ocultos (não são apagados; voltam se você aumentar o ciclo de novo).`,
          [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Remover', style: 'destructive', onPress: () => run(() => setWeekCount(next)) },
          ]
        );
        return;
      }
    }
    run(() => setWeekCount(next));
  };

  if (!week) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const letters = lettersFor(week.count);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Semanas no ciclo</Text>
      <View style={styles.card}>
        <View style={styles.stepper}>
          <StepButton label="−" disabled={busy || week.count <= MIN_WEEKS} onPress={() => changeCount(-1)} />
          <View style={styles.stepValue}>
            <Text style={styles.countNumber}>{week.count}</Text>
            <Text style={styles.countLetters}>{letters.join(' → ')} → A</Text>
          </View>
          <StepButton label="+" disabled={busy || week.count >= MAX_WEEKS} onPress={() => changeCount(1)} />
        </View>
        <Text style={styles.help}>
          Toda segunda-feira o app passa para a próxima semana. Depois da última, o ciclo recomeça
          na Semana A.
        </Text>
      </View>

      <Text style={styles.sectionTitle}>Semana atual</Text>
      <View style={styles.card}>
        <View style={styles.chips}>
          {letters.map((l) => (
            <Chip
              key={l}
              label={`Semana ${l}`}
              selected={week.letter === l}
              onPress={() => !busy && l !== week.letter && run(() => setCurrentWeekLetter(l))}
            />
          ))}
        </View>
        <Text style={styles.help}>
          Use para ajustar em qual semana você está agora. Só muda a semana atual — as semanas
          anteriores do histórico continuam como estavam.
        </Text>
      </View>

      <Text style={styles.sectionTitle}>Exercícios por semana</Text>
      <View style={styles.card}>
        {letters.map((l) => {
          const n = exercises.filter((e) => hasWeek(e, l)).length;
          return (
            <View key={l} style={styles.countRow}>
              <Text style={styles.countLabel}>Semana {l}</Text>
              <Text style={[styles.countValue, n === 0 && { color: colors.danger }]}>
                {n === 0 ? 'nenhum exercício' : `${n} exercício${n === 1 ? '' : 's'}`}
              </Text>
            </View>
          );
        })}
        <Text style={styles.help}>
          Para montar uma semana, toque em "+ Novo" e escolha a semana no cadastro.
        </Text>
      </View>
    </ScrollView>
  );
}

function StepButton({ label, onPress, disabled }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.stepButton, (disabled || pressed) && { opacity: 0.4 }]}
    >
      <Text style={styles.stepButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.muted, marginTop: 16, marginBottom: 8 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e6ebe8',
  },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  stepButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepButtonText: { color: '#fff', fontSize: 26, fontWeight: '700', lineHeight: 30 },
  stepValue: { flex: 1, alignItems: 'center' },
  countNumber: { fontSize: 32, fontWeight: '800', color: colors.text },
  countLetters: { fontSize: 13, color: colors.muted },
  help: { fontSize: 13, color: colors.muted, marginTop: 12, lineHeight: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  countRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eef1ef',
  },
  countLabel: { fontSize: 15, fontWeight: '600', color: colors.text },
  countValue: { fontSize: 14, color: colors.muted },
});
