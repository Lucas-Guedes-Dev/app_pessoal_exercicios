import { useEffect, useLayoutEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import FormField from '../components/FormField';
import { addMeasurement, getMeasurements } from '../db/database';
import { dismissCheckIn, getTrainingProgress } from '../db/progress';
import { colors } from '../theme';
import { formatNumber } from '../utils/health';
import { validateMeasurement } from '../utils/validation';

/**
 * Registro de medidas.
 * route.params.endedCycle: aberto automaticamente ao fim de um ciclo (mostra o resumo dele).
 * Sem parâmetro: registro manual a partir da tela de Evolução.
 */
export default function CheckInScreen({ navigation, route }) {
  const endedCycle = route.params?.endedCycle;

  const [weight, setWeight] = useState('');
  const [waist, setWaist] = useState('');
  const [restingHr, setRestingHr] = useState('');
  const [last, setLast] = useState(null);
  const [cycleSummary, setCycleSummary] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({ title: endedCycle ? 'Fim de Ciclo' : 'Registrar Medidas' });
  }, [navigation, endedCycle]);

  useEffect(() => {
    getMeasurements()
      .then((rows) => setLast(rows[rows.length - 1] ?? null))
      .catch(() => {});
    if (endedCycle) {
      getTrainingProgress()
        .then((p) => setCycleSummary(p.cycles.find((c) => c.cycle === endedCycle) ?? null))
        .catch(() => {});
    }
  }, [endedCycle]);

  // Saiu pelo botão voltar sem salvar: não pergunta de novo até o app ser reaberto
  useEffect(() => {
    return () => {
      if (endedCycle) dismissCheckIn();
    };
  }, [endedCycle]);

  const skip = () => {
    dismissCheckIn();
    navigation.goBack();
  };

  const save = async () => {
    const { errors: found, data } = validateMeasurement({ weight, waist, restingHr });
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    try {
      await addMeasurement(data);
      navigation.goBack();
    } catch (e) {
      Alert.alert('Erro ao salvar', String(e));
      setSaving(false);
    }
  };

  const pct = cycleSummary && cycleSummary.total > 0
    ? Math.round((cycleSummary.done / cycleSummary.total) * 100)
    : null;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {endedCycle && (
          <View style={styles.banner}>
            <Text style={styles.bannerTitle}>Ciclo {endedCycle} encerrado 🎉</Text>
            {pct != null && (
              <Text style={styles.bannerText}>
                Você concluiu {cycleSummary.done} de {cycleSummary.total} treinos ({pct}%).
              </Text>
            )}
            <Text style={styles.bannerText}>Registre suas medidas para acompanhar a evolução.</Text>
          </View>
        )}

        {last && (
          <Text style={styles.last}>
            Última medição: {formatNumber(last.weight_kg)} kg
            {last.waist_cm != null ? ` · cintura ${formatNumber(last.waist_cm)} cm` : ''}
            {last.resting_hr != null ? ` · ${last.resting_hr} bpm` : ''}
          </Text>
        )}

        <FormField label="Peso" suffix="kg" value={weight} onChangeText={setWeight} placeholder={last ? formatNumber(last.weight_kg) : 'Ex: 80,5'} keyboardType="decimal-pad" autoFocus error={errors.weight} />
        <FormField label="Cintura" suffix="cm" optional value={waist} onChangeText={setWaist} placeholder="Na altura do umbigo" keyboardType="decimal-pad" error={errors.waist} />
        <FormField label="Frequência cardíaca em repouso" suffix="bpm" optional value={restingHr} onChangeText={setRestingHr} placeholder="Ao acordar, antes de levantar" keyboardType="number-pad" error={errors.restingHr} />

        <Pressable onPress={save} disabled={saving} style={({ pressed }) => [styles.button, (pressed || saving) && { opacity: 0.7 }]}>
          <Text style={styles.buttonText}>{saving ? 'Salvando...' : 'Salvar medidas'}</Text>
        </Pressable>

        {endedCycle && (
          <Pressable onPress={skip} style={({ pressed }) => [styles.skip, pressed && { opacity: 0.6 }]}>
            <Text style={styles.skipText}>Agora não</Text>
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 40 },
  banner: { backgroundColor: colors.primaryLight, borderRadius: 12, padding: 14, marginBottom: 6 },
  bannerTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  bannerText: { fontSize: 14, color: colors.text, marginTop: 6, lineHeight: 20 },
  last: { fontSize: 13, color: colors.muted, marginTop: 10 },
  button: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 28 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  skip: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  skipText: { color: colors.muted, fontSize: 15, fontWeight: '600' },
});
