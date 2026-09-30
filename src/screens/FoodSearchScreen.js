import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { searchFoods, toggleFavorite } from '../db/food';
import { onFoodSynced } from '../services/food-sync';
import { colors } from '../theme';
import { mealLabel } from '../utils/food';
import { formatNumber } from '../utils/health';

/** Busca de alimento para adicionar. route.params: { date, meal } */
export default function FoodSearchScreen({ navigation, route }) {
  const { date, meal } = route.params;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);

  useLayoutEffect(() => {
    navigation.setOptions({ title: `Adicionar · ${mealLabel(meal)}` });
  }, [navigation, meal]);

  const run = useCallback(async (text) => {
    const id = ++requestId.current;
    const rows = await searchFoods(text);
    if (id === requestId.current) {
      setResults(rows);
      setLoading(false);
    }
  }, []);

  // busca enquanto digita, com uma pequena espera para não consultar a cada tecla
  useEffect(() => {
    const t = setTimeout(() => run(query).catch((e) => Alert.alert('Erro', String(e))), 150);
    return () => clearTimeout(t);
  }, [query, run]);

  // alimentos criados pelo Claude chegando pela sincronização
  const queryRef = useRef(query);
  queryRef.current = query;
  useEffect(() => onFoodSynced(() => run(queryRef.current).catch(() => {})), [run]);

  // voltar de "criar alimento" ou de um favorito alterado atualiza a lista
  useFocusEffect(
    useCallback(() => {
      run(query).catch(() => {});
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const star = async (food) => {
    await toggleFavorite(food.id);
    run(query);
  };

  const empty = query.trim() === '';

  return (
    <View style={styles.container}>
      <View style={styles.searchBox}>
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Buscar: arroz, frango grelhado, banana..."
          placeholderTextColor={colors.muted}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      <FlatList
        data={results}
        keyExtractor={(item) => String(item.id)}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <>
            {empty && results.length > 0 && <Text style={styles.section}>Favoritos e mais usados</Text>}
            {empty && results.length === 0 && !loading && (
              <Text style={styles.help}>
                Digite para buscar entre ~600 alimentos da tabela TACO. Os que você usar e os favoritos (★) aparecem
                aqui para registrar mais rápido.
              </Text>
            )}
          </>
        }
        ListEmptyComponent={
          !empty && !loading ? (
            <View style={styles.none}>
              <Text style={styles.noneText}>Nada encontrado para "{query}".</Text>
              <Text style={styles.noneHint}>Tente uma palavra só (ex.: "frango") ou cadastre o alimento.</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => navigation.navigate('FoodAmount', { foodId: item.id, date, meal })}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.meta}>
                {formatNumber(item.kcal, 0)} kcal · P {formatNumber(item.protein)} g · C {formatNumber(item.carbs)} g · G{' '}
                {formatNumber(item.fat)} g <Text style={styles.per}>por 100 g</Text>
                {item.source === 'custom' ? '  · meu' : item.source === 'rotulo' ? '  · rótulo' : ''}
              </Text>
            </View>
            <Pressable onPress={() => star(item)} hitSlop={12} style={styles.star}>
              <Text style={[styles.starText, item.favorite === 1 && styles.starOn]}>
                {item.favorite === 1 ? '★' : '☆'}
              </Text>
            </Pressable>
          </Pressable>
        )}
        ListFooterComponent={
          <Pressable
            onPress={() => navigation.navigate('CustomFood', { name: query.trim(), date, meal })}
            style={({ pressed }) => [styles.create, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.createText}>+ Cadastrar alimento próprio</Text>
            <Text style={styles.createHint}>Marmita, whey, produto com rótulo…</Text>
          </Pressable>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  searchBox: { padding: 12, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: '#e6ebe8' },
  search: {
    backgroundColor: colors.background,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  list: { padding: 12, paddingBottom: 40 },
  section: { fontSize: 12, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', marginBottom: 8, letterSpacing: 0.5 },
  help: { fontSize: 14, color: colors.muted, lineHeight: 20, marginBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#e6ebe8',
  },
  name: { fontSize: 15, color: colors.text, fontWeight: '600' },
  meta: { fontSize: 12, color: colors.muted, marginTop: 3 },
  per: { fontSize: 11, color: colors.muted },
  star: { paddingLeft: 10, paddingVertical: 4 },
  starText: { fontSize: 22, color: colors.border },
  starOn: { color: '#d69e2e' },
  none: { alignItems: 'center', paddingVertical: 24 },
  noneText: { fontSize: 15, color: colors.text },
  noneHint: { fontSize: 13, color: colors.muted, marginTop: 4, textAlign: 'center' },
  create: { alignItems: 'center', paddingVertical: 16, marginTop: 8, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.primary },
  createText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
  createHint: { color: colors.muted, fontSize: 12, marginTop: 2 },
});
