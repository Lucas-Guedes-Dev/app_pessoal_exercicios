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
import { deleteCustomFood, getFood, saveCustomFood } from '../db/food';
import { colors } from '../theme';
import { formatNumber } from '../utils/health';
import { checkNumber } from '../utils/validation';

/**
 * Alimento próprio (marmita, suplemento, produto com rótulo).
 * route.params: { foodId? (edição), name?, date?, meal? (para já registrar depois de criar) }
 */
export default function CustomFoodScreen({ navigation, route }) {
  const foodId = route.params?.foodId;
  const isEdit = foodId != null;

  const [name, setName] = useState(route.params?.name ?? '');
  const [basis, setBasis] = useState('portion'); // 'portion' (rótulo) | '100'
  const [portionLabel, setPortionLabel] = useState('porção');
  const [portionGrams, setPortionGrams] = useState('');
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [fiber, setFiber] = useState('');
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({ title: isEdit ? 'Editar alimento' : 'Novo alimento' });
  }, [navigation, isEdit]);

  useEffect(() => {
    if (!isEdit) return;
    getFood(foodId)
      .then((f) => {
        if (!f) return navigation.goBack();
        setName(f.name);
        setBasis('100');
        const fmt = (v) => formatNumber(v, 1);
        setKcal(fmt(f.kcal));
        setProtein(fmt(f.protein));
        setCarbs(fmt(f.carbs));
        setFat(fmt(f.fat));
        setFiber(fmt(f.fiber));
      })
      .catch((e) => Alert.alert('Erro', String(e)))
      .finally(() => setLoading(false));
  }, [foodId, isEdit, navigation]);

  const save = async () => {
    const found = {};
    if (!name.trim()) found.name = 'Dê um nome.';
    const base = basis === '100' ? { value: 100 } : checkNumber(portionGrams, { label: 'o peso da porção', min: 1, max: 2000 });
    const k = checkNumber(kcal, { label: 'as calorias', min: 0, max: 5000 });
    const p = checkNumber(protein, { label: 'a proteína', min: 0, max: 1000, required: false });
    const c = checkNumber(carbs, { label: 'o carboidrato', min: 0, max: 1000, required: false });
    const g = checkNumber(fat, { label: 'a gordura', min: 0, max: 1000, required: false });
    const fb = checkNumber(fiber, { label: 'a fibra', min: 0, max: 1000, required: false });
    for (const [key, r] of Object.entries({ base, kcal: k, protein: p, carbs: c, fat: g, fiber: fb })) {
      if (r.error) found[key] = r.error;
    }
    if (basis === 'portion' && !portionLabel.trim()) found.portionLabel = 'Dê um nome para a porção.';
    // proteína + carboidrato + gordura não podem pesar mais que a porção
    if (!found.base && (p.value ?? 0) + (c.value ?? 0) + (g.value ?? 0) > base.value * 1.02) {
      found.kcal = 'Proteína + carboidrato + gordura passam do peso da porção. Confira o rótulo.';
    }

    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    try {
      const id = await saveCustomFood({
        id: foodId,
        name: name.trim(),
        baseGrams: base.value,
        portionLabel: basis === 'portion' ? portionLabel.trim() : null,
        kcal: k.value,
        protein: p.value ?? 0,
        carbs: c.value ?? 0,
        fat: g.value ?? 0,
        fiber: fb.value ?? 0,
      });
      if (!isEdit && route.params?.date) {
        // criado a partir da busca: já segue para escolher a quantidade
        navigation.replace('FoodAmount', { foodId: id, date: route.params.date, meal: route.params.meal });
      } else {
        navigation.goBack();
      }
    } catch (e) {
      Alert.alert('Erro ao salvar', String(e));
      setSaving(false);
    }
  };

  const remove = () => {
    Alert.alert('Apagar alimento', `Apagar "${name}"? O que já foi registrado nos dias continua lá.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Apagar',
        style: 'destructive',
        onPress: async () => {
          await deleteCustomFood(foodId);
          navigation.goBack();
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const per = basis === '100' ? 'por 100 g' : `por ${portionLabel.trim() || 'porção'}`;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <FormField label="Nome" value={name} onChangeText={setName} placeholder="Ex: Whey Max 3W, marmita de frango" error={errors.name} />

        <Text style={styles.label}>Os valores são</Text>
        <View style={styles.chips}>
          <Chip label="Por porção (rótulo)" selected={basis === 'portion'} onPress={() => setBasis('portion')} />
          <Chip label="Por 100 g" selected={basis === '100'} onPress={() => setBasis('100')} />
        </View>

        {basis === 'portion' && (
          <View style={styles.row}>
            <FormField style={{ flex: 1.3 }} label="Nome da porção" value={portionLabel} onChangeText={setPortionLabel} placeholder="scoop, unidade, pote" error={errors.portionLabel} />
            <FormField style={{ flex: 1 }} label="Peso da porção" suffix="g" value={portionGrams} onChangeText={setPortionGrams} placeholder="30" keyboardType="decimal-pad" error={errors.base} />
          </View>
        )}

        <Text style={styles.section}>Informação nutricional ({per})</Text>
        <FormField label="Calorias" suffix="kcal" value={kcal} onChangeText={setKcal} keyboardType="decimal-pad" error={errors.kcal} />
        <View style={styles.row}>
          <FormField style={{ flex: 1 }} label="Proteína" suffix="g" value={protein} onChangeText={setProtein} keyboardType="decimal-pad" error={errors.protein} />
          <FormField style={{ flex: 1 }} label="Carboidrato" suffix="g" value={carbs} onChangeText={setCarbs} keyboardType="decimal-pad" error={errors.carbs} />
        </View>
        <View style={styles.row}>
          <FormField style={{ flex: 1 }} label="Gordura" suffix="g" value={fat} onChangeText={setFat} keyboardType="decimal-pad" error={errors.fat} />
          <FormField style={{ flex: 1 }} label="Fibra" suffix="g" optional value={fiber} onChangeText={setFiber} keyboardType="decimal-pad" error={errors.fiber} />
        </View>
        <Text style={styles.help}>
          Copie da tabela nutricional da embalagem. Para comida caseira, some os ingredientes ou pese o prato e use
          valores de um alimento parecido da busca.
        </Text>

        <Pressable onPress={save} disabled={saving} style={({ pressed }) => [styles.button, (pressed || saving) && { opacity: 0.7 }]}>
          <Text style={styles.buttonText}>{saving ? 'Salvando...' : isEdit ? 'Salvar alterações' : 'Salvar alimento'}</Text>
        </Pressable>
        {isEdit && (
          <Pressable onPress={remove} style={({ pressed }) => [styles.removeButton, pressed && { opacity: 0.7 }]}>
            <Text style={styles.removeText}>Apagar alimento</Text>
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
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginTop: 18, marginBottom: 8 },
  section: { fontSize: 13, fontWeight: '700', color: colors.muted, marginTop: 22, textTransform: 'uppercase', letterSpacing: 0.5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', gap: 12 },
  help: { fontSize: 12, color: colors.muted, marginTop: 12, lineHeight: 18 },
  button: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 24 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  removeButton: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 10, borderWidth: 1, borderColor: colors.danger },
  removeText: { color: colors.danger, fontSize: 15, fontWeight: '600' },
});
