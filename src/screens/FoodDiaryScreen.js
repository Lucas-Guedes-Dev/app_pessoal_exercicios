import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getMeasurements, getProfile } from '../db/database';
import { getDailyEnergy } from '../db/energy';
import { copyMeal, deleteEntry, getEntriesForDate } from '../db/food';
import { colors } from '../theme';
import { addDays, formatDateBR, parseDateKey, toDateKey, weekdayCode, weekdayName } from '../utils/dates';
import { MEALS, describeAmount, formatKcal, sumNutrients } from '../utils/food';
import { ageFrom, basalMetabolicRate, formatNumber } from '../utils/health';

/** Diário de alimentação de um dia. route.params.date (opcional, YYYY-MM-DD). */
export default function FoodDiaryScreen({ navigation, route }) {
  const todayKey = toDateKey(new Date());
  const [date, setDate] = useState(route.params?.date ?? todayKey);
  const [entries, setEntries] = useState([]);
  const [yesterdayMeals, setYesterdayMeals] = useState(new Set());
  const [body, setBody] = useState(null); // { bmr, weight }
  const [energy, setEnergy] = useState(null); // gasto estimado do dia
  const [factor, setFactor] = useState(null);
  const [showEnergy, setShowEnergy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // voltando do registro com outra data (navigate com params), acompanha
  useEffect(() => {
    if (route.params?.date) setDate(route.params.date);
  }, [route.params?.date]);

  const load = useCallback(async () => {
    const prevKey = toDateKey(addDays(parseDateKey(date), -1));
    const [rows, prevRows, profile, measurements, spent] = await Promise.all([
      getEntriesForDate(date),
      getEntriesForDate(prevKey),
      getProfile(),
      getMeasurements(),
      getDailyEnergy(date, date),
    ]);
    setEnergy(spent.byDate.get(date) ?? null);
    setFactor(spent.factor);
    setEntries(rows);
    setYesterdayMeals(new Set(prevRows.map((r) => r.meal)));

    const latest = measurements[measurements.length - 1];
    if (profile && latest) {
      const bmr = basalMetabolicRate({
        weightKg: latest.weight_kg,
        heightCm: profile.height_cm,
        age: ageFrom(profile.birth_date),
        sex: profile.sex,
      });
      setBody({ bmr, weight: latest.weight_kg });
    }
  }, [date]);

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

  const shiftDay = (days) => {
    const next = toDateKey(addDays(parseDateKey(date), days));
    if (next > todayKey) return;
    setDate(next);
  };

  const confirmDelete = (entry) => {
    Alert.alert('Remover', `Tirar "${entry.name}" deste dia?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: async () => {
          await deleteEntry(entry.id);
          await load();
        },
      },
    ]);
  };

  const repeatYesterday = async (meal) => {
    const prevKey = toDateKey(addDays(parseDateKey(date), -1));
    await copyMeal(prevKey, date, meal.key);
    await load();
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const total = sumNutrients(entries);
  const dateObj = parseDateKey(date);
  const isToday = date === todayKey;
  const proteinPerKg = body ? total.protein / body.weight : null;
  const macroKcal = total.protein * 4 + total.carbs * 4 + total.fat * 9;
  const pctOf = (kcal) => (macroKcal > 0 ? Math.round((kcal / macroKcal) * 100) : 0);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
    >
      {/* navegação entre dias */}
      <View style={styles.dayNav}>
        <Pressable onPress={() => shiftDay(-1)} hitSlop={12} style={styles.navArrow}>
          <Text style={styles.navArrowText}>‹</Text>
        </Pressable>
        <Pressable onPress={() => setDate(todayKey)} style={{ alignItems: 'center' }}>
          <Text style={styles.dayTitle}>{isToday ? 'Hoje' : weekdayName(weekdayCode(dateObj))}</Text>
          <Text style={styles.daySub}>{formatDateBR(dateObj)}</Text>
        </Pressable>
        <Pressable onPress={() => shiftDay(1)} hitSlop={12} style={[styles.navArrow, isToday && { opacity: 0.25 }]} disabled={isToday}>
          <Text style={styles.navArrowText}>›</Text>
        </Pressable>
      </View>

      {/* resumo do dia */}
      <View style={styles.summary}>
        <Text style={styles.totalLabel}>Consumido</Text>
        <Text style={styles.total}>
          {formatKcal(total.kcal)} <Text style={styles.totalUnit}>kcal</Text>
        </Text>
        {energy && (
          <>
            <View style={styles.balanceRow}>
              <View style={styles.balanceItem}>
                <Text style={styles.balanceValue}>{formatKcal(energy.total)}</Text>
                <Text style={styles.balanceLabel}>{isToday ? 'gasto previsto no dia' : 'gasto estimado no dia'}</Text>
              </View>
              <View style={styles.balanceItem}>
                <Text
                  style={[
                    styles.balanceValue,
                    { color: total.kcal - energy.total > 0 ? '#b7791f' : colors.primary },
                  ]}
                >
                  {total.kcal - energy.total > 0 ? '+' : ''}
                  {formatKcal(total.kcal - energy.total)}
                </Text>
                <Text style={styles.balanceLabel}>
                  {total.kcal - energy.total > 0 ? 'acima do gasto' : 'abaixo do gasto (déficit)'}
                </Text>
              </View>
            </View>
            <Pressable onPress={() => setShowEnergy((v) => !v)} hitSlop={6}>
              <Text style={styles.link}>{showEnergy ? 'Esconder cálculo ▲' : 'Como o gasto foi calculado ▼'}</Text>
            </Pressable>
            {showEnergy && (
              <View style={styles.breakdown}>
                <BreakdownRow
                  label={`Base do dia (TMB ${formatKcal(body?.bmr ?? energy.base / factor)} × ${String(factor).replace('.', ',')})`}
                  kcal={energy.base}
                />
                {energy.items.map((it, i) => (
                  <BreakdownRow key={i} label={`${it.kind === 'jogo' ? '⚽' : '🏋️'} ${it.name}`} detail={it.detail} kcal={it.kcal} />
                ))}
                {energy.items.length === 0 && (
                  <Text style={styles.breakdownEmpty}>
                    Nenhum treino marcado como feito{isToday ? ' ainda' : ''} nem jogo avaliado neste dia.
                  </Text>
                )}
                <Text style={styles.breakdownNote}>
                  Treinos entram quando marcados como feitos; jogos, depois de avaliados. Estimativa por MET, com
                  margem de erro de uns 20–30%.
                </Text>
              </View>
            )}
          </>
        )}
        <View style={styles.macros}>
          <Macro label="Proteína" grams={total.protein} pct={pctOf(total.protein * 4)} />
          <Macro label="Carboidrato" grams={total.carbs} pct={pctOf(total.carbs * 4)} />
          <Macro label="Gordura" grams={total.fat} pct={pctOf(total.fat * 9)} />
        </View>
        {proteinPerKg != null && total.protein > 0 && (
          <Text style={styles.reference}>
            Proteína: {formatNumber(proteinPerKg)} g por kg de peso (referência para quem treina: 1,6 a 2,0)
          </Text>
        )}
      </View>

      {/* refeições */}
      {MEALS.map((meal) => {
        const items = entries.filter((e) => e.meal === meal.key);
        const sub = sumNutrients(items);
        return (
          <View key={meal.key} style={styles.meal}>
            <View style={styles.mealHeader}>
              <Text style={styles.mealTitle}>
                {meal.icon} {meal.label}
              </Text>
              {items.length > 0 && <Text style={styles.mealKcal}>{formatKcal(sub.kcal)} kcal</Text>}
            </View>

            {items.map((e) => (
              <Pressable
                key={e.id}
                onPress={() => navigation.navigate('FoodAmount', { entryId: e.id })}
                onLongPress={() => confirmDelete(e)}
                style={({ pressed }) => [styles.entry, pressed && { opacity: 0.7 }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.entryName} numberOfLines={2}>{e.name}</Text>
                  <Text style={styles.entryAmount}>{describeAmount(e)}</Text>
                </View>
                <Text style={styles.entryKcal}>{formatKcal(e.kcal)}</Text>
              </Pressable>
            ))}

            <View style={styles.mealActions}>
              <Pressable
                onPress={() => navigation.navigate('FoodSearch', { date, meal: meal.key })}
                style={({ pressed }) => [styles.addButton, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.addButtonText}>+ Adicionar</Text>
              </Pressable>
              {items.length === 0 && yesterdayMeals.has(meal.key) && (
                <Pressable
                  onPress={() => repeatYesterday(meal)}
                  style={({ pressed }) => [styles.repeatButton, pressed && { opacity: 0.7 }]}
                >
                  <Text style={styles.repeatButtonText}>↺ Repetir de ontem</Text>
                </Pressable>
              )}
            </View>
          </View>
        );
      })}

      <Text style={styles.hint}>Toque em um item para mudar a quantidade · segure para remover</Text>
      <Text style={styles.source}>
        Valores da Tabela Brasileira de Composição de Alimentos (TACO/UNICAMP) e medidas caseiras do IBGE. São
        estimativas: o que vale é a tendência da semana.
      </Text>
    </ScrollView>
  );
}

function BreakdownRow({ label, detail, kcal }) {
  return (
    <View style={styles.breakdownRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.breakdownLabel}>{label}</Text>
        {!!detail && <Text style={styles.breakdownDetail}>{detail}</Text>}
      </View>
      <Text style={styles.breakdownKcal}>{formatKcal(kcal)}</Text>
    </View>
  );
}

function Macro({ label, grams, pct }) {
  return (
    <View style={styles.macro}>
      <Text style={styles.macroValue}>{formatNumber(grams, 0)} g</Text>
      <Text style={styles.macroLabel}>{label}</Text>
      <Text style={styles.macroPct}>{pct}% das kcal</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  dayNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  navArrow: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#e6ebe8' },
  navArrowText: { fontSize: 26, color: colors.primary, lineHeight: 30 },
  dayTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
  daySub: { fontSize: 13, color: colors.muted },
  summary: { backgroundColor: colors.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#e6ebe8' },
  totalLabel: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  total: { fontSize: 34, fontWeight: '800', color: colors.text },
  totalUnit: { fontSize: 15, fontWeight: '500', color: colors.muted },
  reference: { fontSize: 12, color: colors.muted, marginTop: 4 },
  balanceRow: { flexDirection: 'row', marginTop: 10, gap: 12 },
  balanceItem: { flex: 1 },
  balanceValue: { fontSize: 20, fontWeight: '800', color: colors.text },
  balanceLabel: { fontSize: 12, color: colors.muted },
  link: { fontSize: 13, color: colors.primary, fontWeight: '600', marginTop: 8 },
  breakdown: { marginTop: 8, backgroundColor: colors.background, borderRadius: 8, padding: 10 },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  breakdownLabel: { fontSize: 13, color: colors.text },
  breakdownDetail: { fontSize: 11, color: colors.muted },
  breakdownKcal: { fontSize: 13, fontWeight: '700', color: colors.text, marginLeft: 8 },
  breakdownEmpty: { fontSize: 12, color: colors.muted, fontStyle: 'italic', paddingVertical: 4 },
  breakdownNote: { fontSize: 11, color: colors.muted, marginTop: 6 },
  macros: { flexDirection: 'row', marginTop: 12, borderTopWidth: 1, borderTopColor: colors.grid, paddingTop: 10 },
  macro: { flex: 1, alignItems: 'center' },
  macroValue: { fontSize: 17, fontWeight: '700', color: colors.text },
  macroLabel: { fontSize: 12, color: colors.muted },
  macroPct: { fontSize: 11, color: colors.muted },
  meal: { backgroundColor: colors.card, borderRadius: 12, padding: 12, marginTop: 12, borderWidth: 1, borderColor: '#e6ebe8' },
  mealHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  mealTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  mealKcal: { fontSize: 14, fontWeight: '700', color: colors.primary },
  entry: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.grid },
  entryName: { fontSize: 14, color: colors.text },
  entryAmount: { fontSize: 12, color: colors.muted, marginTop: 1 },
  entryKcal: { fontSize: 14, fontWeight: '600', color: colors.text, marginLeft: 8 },
  mealActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  addButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  addButtonText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  repeatButton: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.grid },
  repeatButtonText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  hint: { fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 14 },
  source: { fontSize: 11, color: colors.muted, textAlign: 'center', marginTop: 8, paddingHorizontal: 8 },
});
