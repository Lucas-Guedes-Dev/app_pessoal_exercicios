import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Chip from '../components/Chip';
import FormField from '../components/FormField';
import RatingInput from '../components/RatingInput';
import { deleteGameLog, getGame, getGameLog, saveGameLog } from '../db/database';
import { colors } from '../theme';
import { formatDateBR, formatShortBR, parseDateKey, toDateKey, weekdayCode, weekdayName } from '../utils/dates';
import { PERIODS, RESULTS, recentOccurrences } from '../utils/games';
import { maskDateBR, parseBirthBR } from '../utils/health';
import { checkNumber } from '../utils/validation';

/**
 * Avaliação de uma partida. route.params: { gameId, date? }
 * Sem data, começa no último dia do jogo (hoje, se for dia de jogo) e permite
 * escolher outra — para avaliar jogos passados ou partidas remarcadas.
 */
export default function GameLogScreen({ navigation, route }) {
  const { gameId } = route.params;
  const todayKey = toDateKey(new Date());

  const [game, setGame] = useState(null);
  const [date, setDate] = useState(route.params?.date ?? null);
  const [otherDate, setOtherDate] = useState('');
  const [otherError, setOtherError] = useState(null);
  const [existingId, setExistingId] = useState(null);
  const [wasNotPlayed, setWasNotPlayed] = useState(false);
  const [skill, setSkill] = useState(null);
  const [intensity, setIntensity] = useState(null);
  const [stamina, setStamina] = useState(null);
  const [minutes, setMinutes] = useState('');
  const [period, setPeriod] = useState(null);
  const [opponentLevel, setOpponentLevel] = useState(null);
  const [result, setResult] = useState(null);
  const [goals, setGoals] = useState('');
  const [assists, setAssists] = useState('');
  const [pain, setPain] = useState(false);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({ title: 'Avaliar Jogo' });
  }, [navigation]);

  // Carrega o jogo e, sem data informada, usa a ocorrência mais recente dele
  useEffect(() => {
    getGame(gameId)
      .then((g) => {
        if (!g) {
          Alert.alert('Jogo não encontrado', 'Ele pode ter sido excluído.');
          navigation.goBack();
          return;
        }
        setGame(g);
        setDate((prev) => prev ?? recentOccurrences(g.day, 1)[0]);
      })
      .catch((e) => Alert.alert('Erro', String(e)));
  }, [gameId, navigation]);

  // Preenche o formulário com uma avaliação salva (ou limpa, com null)
  const fillForm = (log) => {
    setSkill(log?.skill ?? null);
    setIntensity(log?.intensity ?? null);
    setStamina(log?.stamina ?? null);
    setMinutes(log?.minutes != null ? String(log.minutes) : '');
    setPeriod(log?.period ?? null);
    setOpponentLevel(log?.opponent_level ?? null);
    setResult(log?.result ?? null);
    setGoals(log?.goals != null ? String(log.goals) : '');
    setAssists(log?.assists != null ? String(log.assists) : '');
    setPain(log?.pain === 1);
    setNotes(log?.notes ?? '');
  };

  // Ao trocar a data: carrega a avaliação dela, se existir. Se não existir, mantém
  // o que foi digitado — a não ser que o formulário mostrasse outra avaliação salva.
  const loadedFromLog = useRef(false);
  useEffect(() => {
    if (!date) return;
    (async () => {
      const log = await getGameLog(gameId, date);
      setErrors({});
      if (log && log.played === 1) {
        fillForm(log);
      } else if (loadedFromLog.current) {
        fillForm(null);
      }
      loadedFromLog.current = !!log && log.played === 1;
      setExistingId(log?.id ?? null);
      setWasNotPlayed(log?.played === 0);
    })()
      .catch((e) => Alert.alert('Erro', String(e)))
      .finally(() => setLoading(false));
  }, [gameId, date]);

  const applyOtherDate = () => {
    const key = parseBirthBR(otherDate);
    if (!key) {
      setOtherError('Use o formato DD/MM/AAAA.');
      return;
    }
    if (key > todayKey) {
      setOtherError('Não dá para avaliar um jogo que ainda não aconteceu.');
      return;
    }
    setOtherError(null);
    setOtherDate('');
    setDate(key);
  };

  const save = async () => {
    const found = {};
    if (skill == null) found.skill = 'Dê uma nota.';
    if (intensity == null) found.intensity = 'Dê uma nota.';
    if (stamina == null) found.stamina = 'Dê uma nota.';

    const min = checkNumber(minutes, { label: 'os minutos', min: 1, max: 240, required: false, integer: true });
    const g = checkNumber(goals, { label: 'os gols', min: 0, max: 50, required: false, integer: true });
    const a = checkNumber(assists, { label: 'as assistências', min: 0, max: 50, required: false, integer: true });
    if (min.error) found.minutes = min.error;
    if (g.error) found.goals = g.error;
    if (a.error) found.assists = a.error;

    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    try {
      await saveGameLog(gameId, date, {
        played: 1,
        skill,
        intensity,
        stamina,
        minutes: min.value,
        period,
        opponentLevel,
        result,
        goals: g.value,
        assists: a.value,
        pain: pain ? 1 : 0,
        notes: notes.trim() || null,
      });
      navigation.goBack();
    } catch (e) {
      Alert.alert('Erro ao salvar', String(e));
      setSaving(false);
    }
  };

  const markNotPlayed = () => {
    Alert.alert('Não teve jogo', 'Registrar este dia como sem partida? Ele não entra nas médias.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Confirmar',
        onPress: async () => {
          await saveGameLog(gameId, date, { played: 0 });
          navigation.goBack();
        },
      },
    ]);
  };

  const removeLog = () => {
    Alert.alert('Apagar avaliação', 'Remover a avaliação deste dia?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Apagar',
        style: 'destructive',
        onPress: async () => {
          await deleteGameLog(existingId);
          navigation.goBack();
        },
      },
    ]);
  };

  if (loading || !game || !date) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.gameName}>{game.name}</Text>
          <Text style={styles.gameSub}>
            {game.modality} · {weekdayName(weekdayCode(parseDateKey(date)))}, {formatDateBR(parseDateKey(date))}
            {date < todayKey ? '  ·  retroativo' : ''}
          </Text>
          {existingId && !wasNotPlayed && <Text style={styles.gameEdit}>Já avaliado — você está editando</Text>}
          {wasNotPlayed && <Text style={styles.gameEdit}>Marcado como "não teve jogo" — salvar substitui</Text>}
        </View>

        <Text style={styles.label}>Data do jogo</Text>
        <View style={styles.chips}>
          {recentOccurrences(game.day, 6).map((d) => (
            <Chip key={d} label={d === todayKey ? 'Hoje' : formatShortBR(parseDateKey(d))} selected={date === d} onPress={() => setDate(d)} />
          ))}
          {!recentOccurrences(game.day, 6).includes(date) && (
            <Chip label={formatShortBR(parseDateKey(date))} selected onPress={() => {}} />
          )}
        </View>
        <View style={styles.otherRow}>
          <FormField
            style={styles.otherField}
            label="Outra data (jogo remarcado)"
            value={otherDate}
            onChangeText={(t) => {
              setOtherDate(maskDateBR(t));
              setOtherError(null);
            }}
            placeholder="DD/MM/AAAA"
            keyboardType="number-pad"
            maxLength={10}
            error={otherError}
          />
          <Pressable onPress={applyOtherDate} style={({ pressed }) => [styles.otherButton, pressed && { opacity: 0.7 }]}>
            <Text style={styles.otherButtonText}>Usar</Text>
          </Pressable>
        </View>

        <RatingInput label="Habilidade / técnica" value={skill} onChange={setSkill} lowLabel="1 · muito abaixo" highLabel="5 · jogo dos bons" error={errors.skill} />
        <RatingInput label="Intensidade / ritmo" value={intensity} onChange={setIntensity} lowLabel="1 · de boa" highLabel="5 · no talo" error={errors.intensity} />
        <RatingInput label="Físico no fim do jogo" value={stamina} onChange={setStamina} lowLabel="1 · apaguei" highLabel="5 · inteiro" error={errors.stamina} />

        <FormField label="Minutos jogados" suffix="min" optional value={minutes} onChangeText={setMinutes} placeholder="Ex: 40" keyboardType="number-pad" error={errors.minutes} />

        <Text style={styles.label}>Horário da partida <Text style={styles.optional}>(opcional)</Text></Text>
        <View style={styles.chips}>
          {PERIODS.map((p) => (
            <Chip key={p} label={p} selected={period === p} onPress={() => setPeriod(period === p ? null : p)} />
          ))}
        </View>

        <RatingInput label="Nível do adversário (opcional)" value={opponentLevel} onChange={setOpponentLevel} lowLabel="1 · fraco" highLabel="5 · muito forte" />

        <Text style={styles.label}>Resultado <Text style={styles.optional}>(opcional)</Text></Text>
        <View style={styles.chips}>
          {RESULTS.map((r) => (
            <Chip key={r.value} label={r.label} selected={result === r.value} onPress={() => setResult(result === r.value ? null : r.value)} />
          ))}
        </View>

        <View style={styles.sideBySide}>
          <FormField style={styles.half} label="Gols" optional value={goals} onChangeText={setGoals} placeholder="0" keyboardType="number-pad" error={errors.goals} />
          <FormField style={styles.half} label="Assistências" optional value={assists} onChangeText={setAssists} placeholder="0" keyboardType="number-pad" error={errors.assists} />
        </View>

        <Text style={styles.label}>Sentiu dor ou se machucou?</Text>
        <View style={styles.chips}>
          <Chip label="Não" selected={!pain} onPress={() => setPain(false)} />
          <Chip label="Sim" selected={pain} onPress={() => setPain(true)} />
        </View>

        <FormField label="Observações" optional value={notes} onChangeText={setNotes} placeholder="O que funcionou, o que faltou..." multiline textAlignVertical="top" style={styles.notes} />

        <Pressable onPress={save} disabled={saving} style={({ pressed }) => [styles.button, (pressed || saving) && { opacity: 0.7 }]}>
          <Text style={styles.buttonText}>{saving ? 'Salvando...' : 'Salvar avaliação'}</Text>
        </Pressable>

        <Pressable onPress={markNotPlayed} style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.7 }]}>
          <Text style={styles.secondaryText}>Não teve jogo neste dia</Text>
        </Pressable>

        {existingId && (
          <Pressable onPress={removeLog} style={({ pressed }) => [styles.link, pressed && { opacity: 0.6 }]}>
            <Text style={styles.linkText}>Apagar avaliação</Text>
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  header: { backgroundColor: colors.primaryLight, borderRadius: 12, padding: 14 },
  gameName: { fontSize: 18, fontWeight: '700', color: colors.text },
  gameSub: { fontSize: 14, color: colors.muted, marginTop: 2 },
  gameEdit: { fontSize: 12, color: colors.primary, fontWeight: '600', marginTop: 6 },
  otherRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  otherField: { flex: 1 },
  otherButton: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 11, marginBottom: 1 },
  otherButtonText: { color: colors.primary, fontWeight: '700' },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8, marginTop: 18 },
  optional: { fontWeight: '400', color: colors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sideBySide: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
  notes: { marginTop: 16 },
  button: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 28 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondary: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  secondaryText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  link: { alignItems: 'center', paddingVertical: 14 },
  linkText: { color: colors.danger, fontSize: 14, fontWeight: '600' },
});
