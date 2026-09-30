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
  View,
} from 'react-native';
import Chip from '../components/Chip';
import FormField from '../components/FormField';
import { deleteGame, getGame, saveGame } from '../db/database';
import { scheduleDailyReminders } from '../notifications';
import { colors } from '../theme';
import { WEEKDAYS_DISPLAY, weekdayName } from '../utils/dates';
import { checkNumber } from '../utils/validation';

const MODALITIES = ['Campo', 'Salão', 'Society'];

/**
 * Cadastro de um jogo que se repete na semana.
 * Não guardamos o horário da partida (varia por causa do campeonato), e sim a
 * hora do lembrete de avaliação — 18:00 por padrão.
 */
export default function GameFormScreen({ navigation, route }) {
  const gameId = route.params?.gameId;
  const isEdit = gameId != null;

  const [name, setName] = useState(route.params?.name ?? '');
  const [modality, setModality] = useState(route.params?.modality ?? null);
  const [customModality, setCustomModality] = useState('');
  const [day, setDay] = useState(route.params?.day ?? null);
  const [hour, setHour] = useState(String(route.params?.hour ?? 18));
  const [minute, setMinute] = useState('00');
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({ title: isEdit ? 'Editar Jogo' : 'Novo Jogo' });
  }, [navigation, isEdit]);

  useEffect(() => {
    if (!isEdit) return;
    getGame(gameId)
      .then((g) => {
        if (!g) {
          Alert.alert('Jogo não encontrado');
          navigation.goBack();
          return;
        }
        setName(g.name);
        if (MODALITIES.includes(g.modality)) setModality(g.modality);
        else {
          setModality('Outro');
          setCustomModality(g.modality);
        }
        setDay(g.day);
        setHour(String(g.reminder_hour));
        setMinute(String(g.reminder_minute).padStart(2, '0'));
      })
      .catch((e) => Alert.alert('Erro', String(e)))
      .finally(() => setLoading(false));
  }, [gameId, isEdit, navigation]);

  const save = async () => {
    const found = {};
    const finalModality = modality === 'Outro' ? customModality.trim() : modality;
    if (!name.trim()) found.name = 'Informe o nome do jogo.';
    if (!finalModality) found.modality = 'Escolha a modalidade.';
    if (!day) found.day = 'Escolha o dia da semana.';

    const h = checkNumber(hour, { label: 'a hora', min: 0, max: 23, integer: true });
    const m = checkNumber(minute, { label: 'os minutos', min: 0, max: 59, integer: true });
    if (h.error) found.time = h.error;
    else if (m.error) found.time = m.error;

    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    try {
      await saveGame({
        id: gameId,
        name: name.trim(),
        modality: finalModality,
        day,
        reminderHour: h.value,
        reminderMinute: m.value,
      });
      scheduleDailyReminders().catch(() => {});
      navigation.goBack();
    } catch (e) {
      Alert.alert('Erro ao salvar', String(e));
      setSaving(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      'Excluir jogo',
      `Remover "${name}"? As avaliações desse jogo também serão apagadas.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            await deleteGame(gameId);
            scheduleDailyReminders().catch(() => {});
            navigation.goBack();
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
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <FormField label="Nome" value={name} onChangeText={setName} placeholder="Ex: Campeonato de campo" error={errors.name} />

        <Text style={styles.label}>Modalidade</Text>
        <View style={styles.chips}>
          {[...MODALITIES, 'Outro'].map((m) => (
            <Chip key={m} label={m} selected={modality === m} onPress={() => setModality(m)} />
          ))}
        </View>
        {modality === 'Outro' && (
          <FormField label="Qual?" value={customModality} onChangeText={setCustomModality} placeholder="Ex: Futevôlei" />
        )}
        {!!errors.modality && <Text style={styles.error}>{errors.modality}</Text>}

        <Text style={styles.label}>Dia da semana</Text>
        <View style={styles.chips}>
          {WEEKDAYS_DISPLAY.map((d) => (
            <Chip key={d} label={d} selected={day === d} onPress={() => setDay(d)} />
          ))}
        </View>
        {!!errors.day && <Text style={styles.error}>{errors.day}</Text>}

        <Text style={styles.label}>Lembrete para avaliar</Text>
        <View style={styles.timeRow}>
          <FormField style={styles.timeField} label="" value={hour} onChangeText={setHour} keyboardType="number-pad" maxLength={2} />
          <Text style={styles.colon}>:</Text>
          <FormField style={styles.timeField} label="" value={minute} onChangeText={setMinute} keyboardType="number-pad" maxLength={2} />
          <View style={styles.quick}>
            {[18, 20, 22].map((h) => (
              <Chip
                key={h}
                label={`${h}h`}
                selected={Number(hour) === h && Number(minute) === 0}
                onPress={() => {
                  setHour(String(h));
                  setMinute('00');
                }}
              />
            ))}
          </View>
        </View>
        {!!errors.time && <Text style={styles.error}>{errors.time}</Text>}
        <Text style={styles.help}>
          {day
            ? `Toda ${weekdayName(day).toLowerCase()} às ${hour.padStart(2, '0')}:${minute.padStart(2, '0')} o app pergunta como foi o jogo.`
            : 'O horário da partida você informa na avaliação — o lembrete é sempre no fim do dia.'}
        </Text>

        <Pressable onPress={save} disabled={saving} style={({ pressed }) => [styles.button, (pressed || saving) && { opacity: 0.7 }]}>
          <Text style={styles.buttonText}>{saving ? 'Salvando...' : isEdit ? 'Salvar alterações' : 'Salvar jogo'}</Text>
        </Pressable>

        {isEdit && (
          <Pressable onPress={confirmDelete} style={({ pressed }) => [styles.deleteButton, pressed && { opacity: 0.7 }]}>
            <Text style={styles.deleteButtonText}>Excluir jogo</Text>
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
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8, marginTop: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timeField: { marginTop: 0, width: 58 },
  colon: { fontSize: 20, fontWeight: '700', color: colors.text },
  quick: { flexDirection: 'row', gap: 6, marginLeft: 8 },
  help: { fontSize: 13, color: colors.muted, marginTop: 10, lineHeight: 18 },
  error: { fontSize: 12, color: colors.danger, marginTop: 6 },
  button: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 28 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  deleteButton: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 12, borderWidth: 1, borderColor: colors.danger },
  deleteButtonText: { color: colors.danger, fontSize: 16, fontWeight: '600' },
});
