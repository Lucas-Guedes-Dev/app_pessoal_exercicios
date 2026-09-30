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
  TextInput,
  View,
} from 'react-native';
import Chip from '../components/Chip';
import { addPortion, deleteEntry, deletePortion, getEntry, getFood, saveEntry, toggleFavorite } from '../db/food';
import { colors } from '../theme';
import { MEALS, SOURCE_NOTES, formatKcal, nutrientsFor } from '../utils/food';
import { formatNumber, parseDecimal } from '../utils/health';

const GRAMS = '__grams';
const QUICK_QTY = [0.5, 1, 1.5, 2, 3];

/**
 * Quantidade de um alimento.
 * Novo registro: route.params { foodId, date, meal }. Edição: route.params { entryId }.
 */
export default function FoodAmountScreen({ navigation, route }) {
  const { entryId } = route.params;
  const [food, setFood] = useState(null);
  const [date, setDate] = useState(route.params.date);
  const [meal, setMeal] = useState(route.params.meal);
  const [unit, setUnit] = useState(GRAMS); // GRAMS ou id da medida
  const [amount, setAmount] = useState('100');
  const [newPortion, setNewPortion] = useState(null); // { label, grams } enquanto cria medida
  const [saving, setSaving] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({ title: entryId ? 'Editar quantidade' : 'Quantidade' });
  }, [navigation, entryId]);

  const loadFood = async (foodId, fallbackEntry) => {
    const f = foodId ? await getFood(foodId) : null;
    if (f) return f;
    // alimento apagado depois do registro: usa os valores copiados no próprio registro
    const e = fallbackEntry;
    const per100 = (v) => (v / e.grams) * 100;
    return {
      id: null,
      name: e.name,
      kcal: per100(e.kcal),
      protein: per100(e.protein),
      carbs: per100(e.carbs),
      fat: per100(e.fat),
      source: 'custom',
      portions: [],
      removed: true,
    };
  };

  useEffect(() => {
    (async () => {
      if (entryId) {
        const e = await getEntry(entryId);
        if (!e) {
          navigation.goBack();
          return;
        }
        const f = await loadFood(e.food_id, e);
        setFood(f);
        setDate(e.date);
        setMeal(e.meal);
        const portion = f.portions.find((p) => p.label === e.portion_label);
        if (portion && e.portion_qty) {
          setUnit(portion.id);
          setAmount(String(e.portion_qty).replace('.', ','));
        } else {
          setUnit(GRAMS);
          setAmount(String(Math.round(e.grams)));
        }
      } else {
        const f = await loadFood(route.params.foodId);
        setFood(f);
        // começa pela primeira medida caseira (1 unidade/concha), que é como a gente pensa
        if (f.portions.length > 0) {
          setUnit(f.portions[0].id);
          setAmount('1');
        }
      }
    })().catch((e) => Alert.alert('Erro', String(e)));
  }, [entryId, navigation, route.params.foodId]);

  // Voltando da edição do alimento (personalizado): recarrega os valores; se foi apagado, sai
  const foodIdRef = useRef(null);
  foodIdRef.current = food?.id ?? null;
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', async () => {
      if (foodIdRef.current == null) return;
      const updated = await getFood(foodIdRef.current);
      if (updated) setFood(updated);
      else navigation.goBack();
    });
    return unsubscribe;
  }, [navigation]);

  if (!food) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const portion = food.portions.find((p) => p.id === unit);
  const qty = parseDecimal(amount);
  const validQty = qty != null && !Number.isNaN(qty) && qty > 0;
  const grams = validQty ? (portion ? qty * portion.grams : qty) : 0;
  const n = nutrientsFor(food, grams);

  const selectUnit = (id) => {
    setUnit(id);
    setAmount(id === GRAMS ? String(Math.round(grams) || 100) : '1');
  };

  const save = async () => {
    if (!validQty) {
      Alert.alert('Quantidade', 'Informe uma quantidade maior que zero.');
      return;
    }
    if (grams > 3000) {
      Alert.alert('Quantidade', 'Mais de 3 kg num registro só? Confira a quantidade.');
      return;
    }
    setSaving(true);
    try {
      await saveEntry({
        entryId,
        date,
        meal,
        food,
        grams,
        portionLabel: portion?.label,
        portionQty: portion ? qty : null,
      });
      navigation.navigate({ name: 'Food', params: { date }, merge: true });
    } catch (e) {
      Alert.alert('Erro ao salvar', String(e));
      setSaving(false);
    }
  };

  const remove = () => {
    Alert.alert('Remover', `Tirar "${food.name}" deste dia?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: async () => {
          await deleteEntry(entryId);
          navigation.goBack();
        },
      },
    ]);
  };

  const saveNewPortion = async () => {
    const g = parseDecimal(newPortion?.grams);
    if (!newPortion?.label?.trim() || g == null || Number.isNaN(g) || g <= 0) {
      Alert.alert('Nova medida', 'Dê um nome (ex.: "prato cheio") e o peso em gramas.');
      return;
    }
    await addPortion(food.id, newPortion.label.trim(), g);
    const updated = await getFood(food.id);
    setFood(updated);
    const created = updated.portions.find((p) => p.label === newPortion.label.trim() && p.custom === 1);
    if (created) {
      setUnit(created.id);
      setAmount('1');
    }
    setNewPortion(null);
  };

  const removePortion = (p) => {
    Alert.alert('Apagar medida', `Apagar a medida "${p.label}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Apagar',
        style: 'destructive',
        onPress: async () => {
          await deletePortion(p.id);
          setFood(await getFood(food.id));
          if (unit === p.id) selectUnit(GRAMS);
        },
      },
    ]);
  };

  const star = async () => {
    await toggleFavorite(food.id);
    setFood(await getFood(food.id));
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{food.name}</Text>
            <Text style={styles.per100}>
              Por 100 g: {formatNumber(food.kcal, 0)} kcal · P {formatNumber(food.protein)} · C {formatNumber(food.carbs)} · G{' '}
              {formatNumber(food.fat)}
            </Text>
          </View>
          {food.id != null && (
            <Pressable onPress={star} hitSlop={12}>
              <Text style={[styles.star, food.favorite === 1 && styles.starOn]}>{food.favorite === 1 ? '★' : '☆'}</Text>
            </Pressable>
          )}
        </View>
        {!!SOURCE_NOTES[food.source] && !food.removed && (
          <Text style={styles.note}>
            {SOURCE_NOTES[food.source]}
            {food.source === 'custom' && (
              <Text style={styles.noteLink} onPress={() => navigation.navigate('CustomFood', { foodId: food.id })}>
                {'  '}Editar alimento
              </Text>
            )}
          </Text>
        )}
        {food.removed && <Text style={styles.note}>Este alimento foi apagado; dá para ajustar só em gramas.</Text>}

        <Text style={styles.label}>Medida</Text>
        <View style={styles.chips}>
          <Chip label="gramas" selected={unit === GRAMS} onPress={() => selectUnit(GRAMS)} />
          {food.portions.map((p) => (
            <Chip
              key={p.id}
              label={`${p.label} · ${formatNumber(p.grams, p.grams % 1 ? 1 : 0)} g`}
              selected={unit === p.id}
              onPress={() => selectUnit(p.id)}
              onLongPress={p.custom ? () => removePortion(p) : undefined}
            />
          ))}
          {food.id != null && !newPortion && (
            <Chip label="+ medida" selected={false} onPress={() => setNewPortion({ label: '', grams: '' })} />
          )}
        </View>

        {newPortion && (
          <View style={styles.newPortion}>
            <TextInput
              style={[styles.input, { flex: 1.4 }]}
              value={newPortion.label}
              onChangeText={(t) => setNewPortion((p) => ({ ...p, label: t }))}
              placeholder="Nome (ex.: prato cheio)"
              placeholderTextColor={colors.muted}
            />
            <TextInput
              style={[styles.input, { flex: 0.8 }]}
              value={newPortion.grams}
              onChangeText={(t) => setNewPortion((p) => ({ ...p, grams: t }))}
              placeholder="gramas"
              placeholderTextColor={colors.muted}
              keyboardType="decimal-pad"
            />
            <Pressable onPress={saveNewPortion} style={styles.smallButton}>
              <Text style={styles.smallButtonText}>OK</Text>
            </Pressable>
            <Pressable onPress={() => setNewPortion(null)} style={styles.smallCancel}>
              <Text style={styles.smallCancelText}>×</Text>
            </Pressable>
          </View>
        )}

        <Text style={styles.label}>{unit === GRAMS ? 'Quantos gramas?' : `Quantas vezes "${portion?.label}"?`}</Text>
        <View style={styles.amountRow}>
          <TextInput
            style={[styles.input, styles.amountInput]}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            selectTextOnFocus
          />
          <Text style={styles.amountUnit}>{unit === GRAMS ? 'g' : `= ${formatNumber(grams, 0)} g`}</Text>
        </View>
        {unit !== GRAMS && (
          <View style={styles.chips}>
            {QUICK_QTY.map((q) => (
              <Chip
                key={q}
                label={String(q).replace('.', ',')}
                selected={qty === q}
                onPress={() => setAmount(String(q).replace('.', ','))}
              />
            ))}
          </View>
        )}

        <View style={styles.preview}>
          <Text style={styles.previewKcal}>
            {formatKcal(n.kcal)} <Text style={styles.previewUnit}>kcal</Text>
          </Text>
          <Text style={styles.previewMacros}>
            Proteína {formatNumber(n.protein)} g · Carboidrato {formatNumber(n.carbs)} g · Gordura {formatNumber(n.fat)} g
          </Text>
        </View>

        <Text style={styles.label}>Refeição</Text>
        <View style={styles.chips}>
          {MEALS.map((m) => (
            <Chip key={m.key} label={`${m.icon} ${m.label}`} selected={meal === m.key} onPress={() => setMeal(m.key)} />
          ))}
        </View>

        <Pressable onPress={save} disabled={saving} style={({ pressed }) => [styles.button, (pressed || saving) && { opacity: 0.7 }]}>
          <Text style={styles.buttonText}>{saving ? 'Salvando...' : entryId ? 'Salvar alteração' : 'Adicionar'}</Text>
        </Pressable>

        {entryId && (
          <Pressable onPress={remove} style={({ pressed }) => [styles.removeButton, pressed && { opacity: 0.7 }]}>
            <Text style={styles.removeText}>Remover deste dia</Text>
          </Pressable>
        )}
        {food.portions.some((p) => p.custom) && (
          <Text style={styles.hint}>Segure uma medida criada por você para apagá-la.</Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: colors.primaryLight, borderRadius: 12, padding: 14 },
  name: { fontSize: 17, fontWeight: '700', color: colors.text },
  per100: { fontSize: 12, color: colors.muted, marginTop: 4 },
  star: { fontSize: 26, color: colors.border, marginLeft: 8 },
  starOn: { color: '#d69e2e' },
  note: { fontSize: 12, color: '#8a6d1f', backgroundColor: '#fff8e6', borderRadius: 8, padding: 8, marginTop: 8 },
  noteLink: { color: colors.primary, fontWeight: '700' },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginTop: 18, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
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
  newPortion: { flexDirection: 'row', gap: 6, marginTop: 10, alignItems: 'center' },
  smallButton: { backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11 },
  smallButtonText: { color: '#fff', fontWeight: '700' },
  smallCancel: { paddingHorizontal: 8, paddingVertical: 8 },
  smallCancelText: { fontSize: 22, color: colors.muted },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  amountInput: { width: 110, fontSize: 22, fontWeight: '700', textAlign: 'center' },
  amountUnit: { fontSize: 16, color: colors.muted },
  preview: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 16, borderWidth: 1, borderColor: '#e6ebe8', alignItems: 'center' },
  previewKcal: { fontSize: 30, fontWeight: '800', color: colors.text },
  previewUnit: { fontSize: 15, fontWeight: '500', color: colors.muted },
  previewMacros: { fontSize: 13, color: colors.muted, marginTop: 2, textAlign: 'center' },
  button: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 24 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  removeButton: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 10, borderWidth: 1, borderColor: colors.danger },
  removeText: { color: colors.danger, fontSize: 15, fontWeight: '600' },
  hint: { fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 12 },
});
