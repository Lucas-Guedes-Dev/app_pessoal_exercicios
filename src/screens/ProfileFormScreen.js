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
import { addMeasurement, getProfile, saveProfile } from '../db/database';
import { getActivityFactor, setActivityFactor } from '../db/energy';
import { DEFAULT_FACTOR, LIFESTYLES } from '../utils/energy';
import { colors } from '../theme';
import { formatBirthBR, formatNumber, maskDateBR } from '../utils/health';
import { validateMeasurement, validateProfile } from '../utils/validation';

/**
 * Perfil da pessoa.
 * route.params.onboarding = true: primeira abertura — pede perfil + medidas iniciais
 * e não deixa voltar. Sem o parâmetro: edita só os dados do perfil.
 */
export default function ProfileFormScreen({ navigation, route }) {
  const onboarding = !!route.params?.onboarding;

  const [name, setName] = useState('');
  const [sex, setSex] = useState(null);
  const [birth, setBirth] = useState('');
  const [height, setHeight] = useState('');
  const [goal, setGoal] = useState('');
  const [factor, setFactor] = useState(DEFAULT_FACTOR);
  const [weight, setWeight] = useState('');
  const [waist, setWaist] = useState('');
  const [restingHr, setRestingHr] = useState('');
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(!onboarding);
  const [saving, setSaving] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({ title: onboarding ? 'Bem-vindo(a)!' : 'Editar Perfil' });
  }, [navigation, onboarding]);

  useEffect(() => {
    if (onboarding) return;
    getProfile()
      .then((p) => {
        if (!p) return;
        setName(p.name);
        setSex(p.sex);
        setBirth(formatBirthBR(p.birth_date));
        setHeight(formatNumber(p.height_cm, 0));
        setGoal(p.goal_weight_kg != null ? formatNumber(p.goal_weight_kg, 1) : '');
        getActivityFactor().then(setFactor).catch(() => {});
      })
      .catch((e) => Alert.alert('Erro', String(e)))
      .finally(() => setLoading(false));
  }, [onboarding]);

  const save = async () => {
    const profile = validateProfile({ name, sex, birth, height, goal });
    const measurement = onboarding
      ? validateMeasurement({ weight, waist, restingHr })
      : { errors: {} };
    const allErrors = { ...profile.errors, ...measurement.errors };
    setErrors(allErrors);
    if (Object.keys(allErrors).length > 0) return;

    setSaving(true);
    try {
      await saveProfile(profile.data);
      await setActivityFactor(factor);
      if (onboarding) {
        await addMeasurement(measurement.data);
        navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
      } else {
        navigation.goBack();
      }
    } catch (e) {
      Alert.alert('Erro ao salvar', String(e));
      setSaving(false);
    }
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
        {onboarding && (
          <View style={styles.intro}>
            <Text style={styles.introTitle}>Vamos montar seu perfil ⚽</Text>
            <Text style={styles.introText}>
              Com esses dados o app acompanha sua evolução com gráficos. Ao fim de cada ciclo de
              semanas ele vai pedir seu peso de novo.
            </Text>
          </View>
        )}

        <Text style={styles.section}>Sobre você</Text>
        <FormField label="Nome" value={name} onChangeText={setName} placeholder="Como quer ser chamado(a)" error={errors.name} />

        <View style={{ marginTop: 14 }}>
          <Text style={styles.label}>Sexo</Text>
          <View style={styles.chips}>
            <Chip label="Masculino" selected={sex === 'M'} onPress={() => setSex('M')} />
            <Chip label="Feminino" selected={sex === 'F'} onPress={() => setSex('F')} />
          </View>
          {!!errors.sex && <Text style={styles.error}>{errors.sex}</Text>}
        </View>

        <FormField
          label="Data de nascimento"
          value={birth}
          onChangeText={(t) => setBirth(maskDateBR(t))}
          placeholder="DD/MM/AAAA"
          keyboardType="number-pad"
          maxLength={10}
          error={errors.birth}
        />
        <FormField label="Altura" suffix="cm" value={height} onChangeText={setHeight} placeholder="Ex: 178" keyboardType="decimal-pad" error={errors.height} />
        <FormField label="Peso meta" suffix="kg" optional value={goal} onChangeText={setGoal} placeholder="Ex: 75" keyboardType="decimal-pad" error={errors.goal} />

        <View style={{ marginTop: 14 }}>
          <Text style={styles.label}>Rotina fora dos treinos</Text>
          <View style={styles.chips}>
            {LIFESTYLES.map((l) => (
              <Chip key={l.factor} label={l.label} selected={factor === l.factor} onPress={() => setFactor(l.factor)} />
            ))}
          </View>
          <Text style={styles.hint}>
            Entra no gasto calórico do dia: a taxa metabólica basal é multiplicada por esse fator e os treinos e jogos
            são somados à parte.
          </Text>
        </View>

        {onboarding && (
          <>
            <Text style={styles.section}>Medidas de hoje</Text>
            <FormField label="Peso" suffix="kg" value={weight} onChangeText={setWeight} placeholder="Ex: 80,5" keyboardType="decimal-pad" error={errors.weight} />
            <FormField label="Cintura" suffix="cm" optional value={waist} onChangeText={setWaist} placeholder="Na altura do umbigo" keyboardType="decimal-pad" error={errors.waist} />
            <FormField label="Frequência cardíaca em repouso" suffix="bpm" optional value={restingHr} onChangeText={setRestingHr} placeholder="Ao acordar, antes de levantar" keyboardType="number-pad" error={errors.restingHr} />
          </>
        )}

        <Pressable onPress={save} disabled={saving} style={({ pressed }) => [styles.button, (pressed || saving) && { opacity: 0.7 }]}>
          <Text style={styles.buttonText}>{saving ? 'Salvando...' : onboarding ? 'Começar' : 'Salvar perfil'}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  intro: { backgroundColor: colors.primaryLight, borderRadius: 12, padding: 14, marginBottom: 4 },
  introTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  introText: { fontSize: 14, color: colors.text, marginTop: 6, lineHeight: 20 },
  section: { fontSize: 13, fontWeight: '700', color: colors.muted, marginTop: 22, textTransform: 'uppercase', letterSpacing: 0.5 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  error: { fontSize: 12, color: colors.danger, marginTop: 4 },
  hint: { fontSize: 12, color: colors.muted, marginTop: 6, lineHeight: 17 },
  button: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 28 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
