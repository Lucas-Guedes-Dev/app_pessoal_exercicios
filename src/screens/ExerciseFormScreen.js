import { useEffect, useLayoutEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Chip from '../components/Chip';
import {
  addExercise,
  deleteExercise,
  getCurrentWeek,
  getExercise,
  getMeasurements,
  updateExercise,
} from '../db/database';
import FormField from '../components/FormField';
import { scheduleDailyReminders } from '../notifications';
import { colors } from '../theme';
import { WEEKDAYS_DISPLAY } from '../utils/dates';
import { WEEK_LETTERS, lettersFor } from '../utils/weeks';
import { ACTIVITIES, activityKcal, activityOf, guessActivity } from '../utils/energy';
import { checkNumber } from '../utils/validation';

/**
 * Formulário de exercício. Sem parâmetros cadastra um novo;
 * com route.params.exerciseId edita o existente.
 * route.params.week pré-seleciona a semana num cadastro novo.
 */
export default function ExerciseFormScreen({ navigation, route }) {
  const exerciseId = route.params?.exerciseId;
  const isEdit = exerciseId != null;

  const [name, setName] = useState('');
  const [details, setDetails] = useState('');
  const [days, setDays] = useState([]);
  const [weeks, setWeeks] = useState([]);
  const [letters, setLetters] = useState([]);
  const [activity, setActivity] = useState(null);
  const [duration, setDuration] = useState('');
  const [activityTouched, setActivityTouched] = useState(false); // escolhido à mão
  const [weight, setWeight] = useState(null);
  const [durationError, setDurationError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({ title: isEdit ? 'Editar Exercício' : 'Novo Exercício' });
  }, [navigation, isEdit]);

  useEffect(() => {
    (async () => {
      const [current, measurements] = await Promise.all([getCurrentWeek(), getMeasurements()]);
      const available = lettersFor(current.count);
      setWeight(measurements[measurements.length - 1]?.weight_kg ?? null);

      if (isEdit) {
        const ex = await getExercise(exerciseId);
        if (!ex) {
          Alert.alert('Exercício não encontrado', 'Ele pode ter sido excluído.');
          navigation.goBack();
          return;
        }
        setName(ex.name);
        setDetails(ex.details ?? '');
        setDays(ex.days.split(','));
        setWeeks(ex.weeks.split(','));
        setActivity(ex.activity ?? 'forca');
        setDuration(ex.duration_min != null ? String(ex.duration_min) : '');
        setActivityTouched(true);
        // mostra também semanas fora do ciclo atual que o exercício ainda tenha
        setLetters(WEEK_LETTERS.filter((l) => available.includes(l) || ex.weeks.split(',').includes(l)));
      } else {
        const preferred = route.params?.week;
        setLetters(available);
        setWeeks([available.includes(preferred) ? preferred : current.letter]);
      }
    })()
      .catch((e) => Alert.alert('Erro', String(e)))
      .finally(() => setLoading(false));
  }, [exerciseId, isEdit, navigation, route.params?.week]);

  const toggle = (setter) => (value) => {
    setter((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  };
  const toggleDay = toggle(setDays);
  const toggleWeek = toggle(setWeeks);

  const allWeeks = letters.length > 0 && letters.every((l) => weeks.includes(l));

  // Num exercício novo, sugere tipo e duração pelo nome e detalhes até a pessoa escolher
  useEffect(() => {
    if (isEdit || activityTouched || !name.trim()) return;
    const guess = guessActivity(name.trim(), details);
    setActivity(guess.activity);
    setDuration(String(guess.duration));
  }, [name, details, isEdit, activityTouched]);

  const durationNum = Number(duration);
  const kcalHint =
    weight && activity && durationNum > 0 ? activityKcal(activityOf(activity).met, weight, durationNum) : null;

  const save = async () => {
    if (!name.trim()) {
      Alert.alert('Campo obrigatório', 'Informe o nome do exercício.');
      return;
    }
    if (weeks.length === 0) {
      Alert.alert('Campo obrigatório', 'Selecione pelo menos uma semana.');
      return;
    }
    if (days.length === 0) {
      Alert.alert('Campo obrigatório', 'Selecione pelo menos um dia da semana.');
      return;
    }
    const dur = checkNumber(duration, { label: 'a duração', min: 1, max: 240, integer: true });
    setDurationError(dur.error ?? null);
    if (dur.error) return;

    setSaving(true);
    try {
      // salva na ordem natural, ex: dias "Seg,Qua" e semanas "A,C"
      const data = {
        name: name.trim(),
        details: details.trim(),
        days: WEEKDAYS_DISPLAY.filter((d) => days.includes(d)).join(','),
        weeks: WEEK_LETTERS.filter((w) => weeks.includes(w)).join(','),
        activity: activity ?? 'forca',
        durationMin: dur.value,
      };
      if (isEdit) await updateExercise(exerciseId, data);
      else await addExercise(data);
      scheduleDailyReminders().catch(() => {}); // atualiza o texto dos lembretes
      navigation.goBack();
    } catch (e) {
      Alert.alert('Erro ao salvar', String(e));
      setSaving(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      'Excluir exercício',
      `Remover "${name.trim() || 'este exercício'}" do plano? O histórico dele também será apagado.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteExercise(exerciseId);
              scheduleDailyReminders().catch(() => {});
              navigation.goBack();
            } catch (e) {
              Alert.alert('Erro ao excluir', String(e));
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Nome</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Ex: Agachamento livre"
          placeholderTextColor={colors.muted}
          autoFocus={!isEdit}
        />

        <Text style={styles.label}>Detalhes</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={details}
          onChangeText={setDetails}
          placeholder="Ex: 3x15-20"
          placeholderTextColor={colors.muted}
          multiline
          textAlignVertical="top"
        />

        <Text style={styles.label}>Tipo de atividade</Text>
        <View style={styles.chips}>
          {ACTIVITIES.map((a) => (
            <Chip
              key={a.key}
              label={a.label}
              selected={activity === a.key}
              onPress={() => {
                setActivity(a.key);
                setActivityTouched(true);
              }}
            />
          ))}
        </View>
        <FormField
          label="Duração"
          suffix="min"
          value={duration}
          onChangeText={(t) => {
            setDuration(t.replace(/\D/g, ''));
            setActivityTouched(true);
          }}
          placeholder="Ex: 10"
          keyboardType="number-pad"
          maxLength={3}
          error={durationError}
        />
        <Text style={styles.help}>
          Conte o tempo em ação: na corda ou nos tiros, sem os descansos. Na força, o tempo total das séries.
          {kcalHint != null ? `  Gasto estimado para você: ~${Math.round(kcalHint)} kcal.` : ''}
        </Text>

        <Text style={styles.label}>Semanas do ciclo</Text>
        <View style={styles.chips}>
          {letters.map((l) => (
            <Chip key={l} label={`Semana ${l}`} selected={weeks.includes(l)} onPress={() => toggleWeek(l)} />
          ))}
          {letters.length > 1 && (
            <Chip
              label="Todas"
              selected={allWeeks}
              onPress={() => setWeeks(allWeeks ? [] : letters)}
            />
          )}
        </View>

        <Text style={styles.label}>Dias da semana</Text>
        <View style={styles.chips}>
          {WEEKDAYS_DISPLAY.map((code) => (
            <Chip key={code} label={code} selected={days.includes(code)} onPress={() => toggleDay(code)} />
          ))}
        </View>

        <Pressable
          onPress={save}
          disabled={saving}
          style={({ pressed }) => [styles.button, (pressed || saving) && { opacity: 0.7 }]}
        >
          <Text style={styles.buttonText}>
            {saving ? 'Salvando...' : isEdit ? 'Salvar alterações' : 'Salvar exercício'}
          </Text>
        </Pressable>

        {isEdit && (
          <Pressable
            onPress={confirmDelete}
            disabled={saving}
            style={({ pressed }) => [styles.deleteButton, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.deleteButtonText}>Excluir exercício</Text>
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 6, marginTop: 14 },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
  },
  multiline: { minHeight: 80 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  help: { fontSize: 12, color: colors.muted, marginTop: 6, lineHeight: 17 },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 28,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  deleteButton: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  deleteButtonText: { color: colors.danger, fontSize: 16, fontWeight: '600' },
});
