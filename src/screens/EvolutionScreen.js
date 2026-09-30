import { useCallback, useLayoutEffect, useState } from 'react';
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
import BarChart from '../components/charts/BarChart';
import PeriodFilter, { usePeriodFilter } from '../components/PeriodFilter';
import LineChart from '../components/charts/LineChart';
import { deleteMeasurement, getGameLogs, getMeasurements, getProfile } from '../db/database';
import { getDailyEnergy } from '../db/energy';
import { getDailyTotals } from '../db/food';
import { getTrainingProgress } from '../db/progress';
import { formatKcal } from '../utils/food';
import { colors } from '../theme';
import { addDays, formatDateBR, formatShortBR, parseDateKey, startOfWeek, toDateKey } from '../utils/dates';
import { dateRange } from '../utils/energy';
import { METRICS, byModality, byOpponentLevel, movingAverage } from '../utils/games';
import {
  ADHERENCE_WINDOW_DAYS,
  GOOD_ADHERENCE,
  adherenceBefore,
  buildInsights,
  dailyTraining,
  enrichGames,
  gameEvolution,
  trainingEffect,
} from '../utils/insights';
import {
  ageFrom,
  basalMetabolicRate,
  bmi,
  bmiCategory,
  formatNumber,
  healthyWeightRange,
} from '../utils/health';

// Até esse número de dias o gráfico de alimentação é diário; acima, vira média por semana
const DAILY_LIMIT = 31;

export default function EvolutionScreen({ navigation }) {
  const [profile, setProfile] = useState(null);
  const [measurements, setMeasurements] = useState([]);
  const [training, setTraining] = useState(null);
  const [gameLogs, setGameLogs] = useState([]);
  const [foodDays, setFoodDays] = useState([]);
  const [energyDays, setEnergyDays] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  // o filtro vale para a tela toda; o último tipo escolhido fica guardado
  const filter = usePeriodFilter({ initialMode: 'cycle', rememberAs: 'dashboard_period' });
  const period = filter.period;

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={() => navigation.navigate('Report')} hitSlop={10} style={({ pressed }) => pressed && { opacity: 0.6 }}>
          <Text style={styles.headerButtonText}>📄 PDF</Text>
        </Pressable>
      ),
    });
  }, [navigation]);

  // alimentação e gasto são lidos só para o período escolhido; trocar o período
  // muda loadPeriod -> load -> e o useFocusEffect recarrega a tela
  const loadPeriod = useCallback(async () => {
    if (period.error) return;
    const [f, energy] = await Promise.all([
      getDailyTotals(period.fromKey, period.toKey),
      getDailyEnergy(period.fromKey, period.toKey),
    ]);
    setFoodDays(f);
    setEnergyDays(energy.byDate);
  }, [period.error, period.fromKey, period.toKey]);

  const load = useCallback(async () => {
    const [p, m, t, g] = await Promise.all([
      getProfile(),
      getMeasurements(),
      getTrainingProgress(),
      getGameLogs(),
      loadPeriod(),
    ]);
    setProfile(p);
    setMeasurements(m);
    setTraining(t);
    setGameLogs(g);
  }, [loadPeriod]);

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

  const confirmDeleteMeasurement = (m) => {
    Alert.alert(
      'Excluir medição',
      `Remover a medição de ${formatDateBR(parseDateKey(m.date))} (${formatNumber(m.weight_kg)} kg)?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            await deleteMeasurement(m.id);
            await load();
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

  if (!profile) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Perfil não encontrado.</Text>
        <Pressable style={[styles.button, { marginTop: 16 }]} onPress={() => navigation.navigate('ProfileSetup', { onboarding: true })}>
          <Text style={styles.buttonText}>Criar perfil</Text>
        </Pressable>
      </View>
    );
  }

  // ----- dados do corpo -----
  const first = measurements[0];
  const latest = measurements[measurements.length - 1];
  const age = ageFrom(profile.birth_date);
  const currentBmi = latest ? bmi(latest.weight_kg, profile.height_cm) : null;
  const range = healthyWeightRange(profile.height_cm);
  const bmr = latest
    ? basalMetabolicRate({ weightKg: latest.weight_kg, heightCm: profile.height_cm, age, sex: profile.sex })
    : null;
  const weightDelta = latest && first && latest !== first ? latest.weight_kg - first.weight_kg : null;
  const toGoal = latest && profile.goal_weight_kg != null ? latest.weight_kg - profile.goal_weight_kg : null;

  // ----- período -----
  const valid = !period.error;
  const inPeriod = (key) => valid && key >= period.fromKey && key <= period.toKey;
  const periodMeasurements = measurements.filter((m) => inPeriod(m.date));
  const periodDelta =
    periodMeasurements.length > 1
      ? periodMeasurements[periodMeasurements.length - 1].weight_kg - periodMeasurements[0].weight_kg
      : null;
  const periodText = valid
    ? period.fromKey === period.toKey
      ? formatDateBR(parseDateKey(period.fromKey))
      : `${formatShortBR(parseDateKey(period.fromKey))} a ${formatShortBR(parseDateKey(period.toKey))}`
    : '';

  const caption = (m) =>
    `${formatDateBR(parseDateKey(m.date))} · ciclo ${m.cycle}`;
  const series = (field) =>
    periodMeasurements
      .filter((m) => m[field] != null)
      .map((m) => ({ date: parseDateKey(m.date), value: m[field], caption: caption(m) }));

  const weightPoints = series('weight_kg');
  const waistPoints = series('waist_cm');
  const hrPoints = series('resting_hr');

  // ----- dados de treino -----
  const weeks = training?.weeks ?? [];
  const currentWeek = weeks[weeks.length - 1];
  // semanas que encostam no período
  const periodWeeks = weeks.filter((w) => valid && w.weekStart <= period.toKey && w.days[6].dateKey >= period.fromKey);
  const doneInPeriod = periodWeeks.reduce(
    (sum, w) => sum + w.days.filter((d) => inPeriod(d.dateKey)).reduce((s, d) => s + d.items.filter((i) => i.done).length, 0),
    0
  );
  const periodCycles = (training?.cycles ?? []).filter((c) => c.weeks.some((w) => periodWeeks.includes(w)));
  const periodLogs = gameLogs.filter((l) => inPeriod(l.date));
  const bars = periodWeeks.map((w) => ({
    label: w.letter,
    value: w.total ? (w.done / w.total) * 100 : 0,
    partial: w === currentWeek,
    caption: `Sem. ${w.letter} · ${formatShortBR(w.start)}–${formatShortBR(w.end)} · ${w.done}/${w.total}${w === currentWeek ? ' (atual)' : ''}`,
  }));
  const closedWeeks = periodWeeks.filter((w) => w !== currentWeek && w.total > 0);
  const fullWeeks = closedWeeks.filter((w) => w.done === w.total).length;
  const avgAdherence = closedWeeks.length
    ? Math.round(closedWeeks.reduce((s, w) => s + w.done / w.total, 0) / closedWeeks.length * 100)
    : null;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
    >
      {/* Perfil */}
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{profile.name}</Text>
            <Text style={styles.muted}>
              {age} anos · {formatNumber(profile.height_cm / 100, 2)} m · {profile.sex === 'F' ? 'Feminino' : 'Masculino'}
            </Text>
          </View>
          <Pressable onPress={() => navigation.navigate('EditProfile')} hitSlop={8}>
            <Text style={styles.link}>Editar</Text>
          </Pressable>
        </View>
      </View>

      {/* Filtro de período: vale para tudo abaixo */}
      <Pressable
        onPress={() => setShowFilter((v) => !v)}
        style={({ pressed }) => [styles.filterBar, pressed && { opacity: 0.8 }]}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.filterLabel}>Período</Text>
          <Text style={styles.filterValue} numberOfLines={1}>
            {valid ? `${period.label}` : period.error}
          </Text>
          {valid && period.label !== periodText && <Text style={styles.filterDates}>{periodText}</Text>}
        </View>
        <Text style={styles.filterToggle}>{showFilter ? 'Fechar ▲' : 'Mudar ▼'}</Text>
      </Pressable>
      {showFilter && (
        <View style={{ marginBottom: 12 }}>
          <PeriodFilter filter={filter} />
        </View>
      )}

      {/* Indicadores */}
      <View style={styles.tiles}>
        <Tile
          label="Peso atual"
          value={latest ? formatNumber(latest.weight_kg) : '—'}
          unit="kg"
          note={
            periodDelta != null
              ? `${periodDelta > 0 ? '▲ +' : periodDelta < 0 ? '▼ ' : ''}${formatNumber(periodDelta)} kg no período`
              : weightDelta != null
                ? `${weightDelta > 0 ? '▲ +' : weightDelta < 0 ? '▼ ' : ''}${formatNumber(weightDelta)} kg desde o início`
                : 'Primeira medição'
          }
        />
        <Tile
          label="IMC"
          value={currentBmi ? formatNumber(currentBmi) : '—'}
          note={currentBmi ? bmiCategory(currentBmi) : ''}
        />
        <Tile
          label="Meta de peso"
          value={profile.goal_weight_kg != null ? formatNumber(profile.goal_weight_kg) : '—'}
          unit={profile.goal_weight_kg != null ? 'kg' : ''}
          note={
            toGoal == null
              ? 'Defina em "Editar"'
              : Math.abs(toGoal) < 0.1
                ? 'Meta atingida 🎯'
                : `Faltam ${toGoal > 0 ? 'perder' : 'ganhar'} ${formatNumber(Math.abs(toGoal))} kg`
          }
        />
        <Tile
          label="Gasto basal"
          value={bmr ? Math.round(bmr).toLocaleString('pt-BR') : '—'}
          unit="kcal/dia"
          note="Em repouso (estimativa)"
        />
      </View>

      {/* Peso */}
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={styles.cardTitle}>Peso (kg)</Text>
          <Pressable onPress={() => navigation.navigate('CheckIn')} hitSlop={8}>
            <Text style={styles.link}>+ Registrar</Text>
          </Pressable>
        </View>
        {weightPoints.length > 0 ? (
          <LineChart
            points={weightPoints}
            unit="kg"
            goal={profile.goal_weight_kg ?? undefined}
            goalLabel={profile.goal_weight_kg != null ? `meta ${formatNumber(profile.goal_weight_kg)}` : undefined}
            formatDate={formatShortBR}
          />
        ) : (
          <Text style={styles.muted}>
            {measurements.length ? 'Nenhuma medição neste período.' : 'Nenhuma medição ainda.'}
          </Text>
        )}
        <Text style={styles.footnote}>
          Faixa saudável para sua altura (IMC 18,5–24,9): {formatNumber(range.min)} a {formatNumber(range.max)} kg
        </Text>
      </View>

      {waistPoints.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Cintura (cm)</Text>
          <LineChart points={waistPoints} unit="cm" formatDate={formatShortBR} />
        </View>
      )}

      {hrPoints.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Frequência cardíaca em repouso (bpm)</Text>
          <LineChart points={hrPoints} unit="bpm" decimals={0} minSpan={6} formatDate={formatShortBR} />
          <Text style={styles.footnote}>Com o condicionamento, ela tende a cair.</Text>
        </View>
      )}

      {/* Alimentação */}
      {valid && (
        <FoodCard days={foodDays} energy={energyDays} weight={latest?.weight_kg} period={period} navigation={navigation} />
      )}

      {/* Treinos */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Treinos concluídos por semana</Text>
        {bars.length > 0 ? <BarChart bars={bars} /> : <Text style={styles.muted}>Sem semanas neste período.</Text>}
        <Text style={styles.footnote}>
          {periodWeeks.length} semana{periodWeeks.length === 1 ? '' : 's'} do período · a barra clara é a semana em andamento
        </Text>

        <View style={styles.statsRow}>
          <Stat value={String(doneInPeriod)} label="exercícios feitos" />
          <Stat value={String(fullWeeks)} label="semanas 100%" />
          <Stat value={avgAdherence != null ? `${avgAdherence}%` : '—'} label="média semanal" />
        </View>
      </View>

      {/* Jogos x treinos: evolução, comparação e conclusões */}
      <GamesVsTraining logs={periodLogs} hasAnyGame={gameLogs.length > 0} weeks={weeks} measurements={measurements} navigation={navigation} />

      {/* Jogos: cada modalidade é lida separada — salão e campo não se comparam */}
      {byModality(periodLogs).map((group) => (
        <ModalityCard key={group.modality} group={group} />
      ))}

      {/* Por ciclo: tabela que cruza treino e peso */}
      {periodCycles.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Por ciclo</Text>
          <View style={[styles.tableRow, styles.tableHead]}>
            <Text style={[styles.th, { flex: 1 }]}>Ciclo</Text>
            <Text style={[styles.th, styles.num]}>Treinos</Text>
            <Text style={[styles.th, styles.num]}>Peso</Text>
          </View>
          {[...periodCycles].reverse().map((c) => {
            const m = measurements.filter((x) => x.cycle === c.cycle);
            const w = m.length ? m[m.length - 1].weight_kg : null;
            const pct = c.total ? Math.round((c.done / c.total) * 100) : null;
            const running = c.weeks.includes(currentWeek);
            return (
              <View key={c.cycle} style={styles.tableRow}>
                <Text style={[styles.td, { flex: 1 }]}>
                  {c.cycle}{running ? ' (atual)' : ''}
                </Text>
                <Text style={[styles.td, styles.num]}>{pct != null ? `${pct}%` : '—'}</Text>
                <Text style={[styles.td, styles.num]}>{w != null ? `${formatNumber(w)} kg` : '—'}</Text>
              </View>
            );
          })}
        </View>
      )}

      {/* Medições */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Medições</Text>
        <View style={[styles.tableRow, styles.tableHead]}>
          <Text style={[styles.th, { flex: 1.3 }]}>Data</Text>
          <Text style={[styles.th, styles.num]}>Peso</Text>
          <Text style={[styles.th, styles.num]}>Cintura</Text>
          <Text style={[styles.th, styles.num]}>FC</Text>
        </View>
        {[...periodMeasurements].reverse().map((m) => (
          <Pressable key={m.id} onLongPress={() => confirmDeleteMeasurement(m)} style={({ pressed }) => [styles.tableRow, pressed && { opacity: 0.6 }]}>
            <Text style={[styles.td, { flex: 1.3 }]}>{formatShortBR(parseDateKey(m.date))} · c{m.cycle}</Text>
            <Text style={[styles.td, styles.num]}>{formatNumber(m.weight_kg)}</Text>
            <Text style={[styles.td, styles.num]}>{m.waist_cm != null ? formatNumber(m.waist_cm) : '—'}</Text>
            <Text style={[styles.td, styles.num]}>{m.resting_hr ?? '—'}</Text>
          </Pressable>
        ))}
        {periodMeasurements.length === 0 && <Text style={styles.muted}>Nenhuma medição neste período.</Text>}
        {periodMeasurements.length > 0 && <Text style={styles.footnote}>Segure uma medição para excluir</Text>}
      </View>

      <Text style={styles.disclaimer}>
        IMC e gasto basal são estimativas gerais e não substituem avaliação de um profissional de saúde.
      </Text>
    </ScrollView>
  );
}

function ModalityCard({ group }) {
  const [metric, setMetric] = useState(METRICS[0].key);
  const spec = METRICS.find((m) => m.key === metric);
  const points = movingAverage(group.logs, metric).map((p) => ({
    date: p.date,
    value: p.value,
    caption: `${formatShortBR(p.date)} · jogo: ${formatNumber(p.raw, spec.decimals ?? 0)}${spec.unit ? ' ' + spec.unit : ''}`,
  }));
  const levels = byOpponentLevel(group.logs);

  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <Text style={styles.cardTitle}>{group.modality}</Text>
        <Text style={styles.muted}>
          {group.logs.length} {group.logs.length === 1 ? 'jogo' : 'jogos'}
        </Text>
      </View>

      {group.metrics.map((m) => {
        const max = m.key === 'minutes' ? Math.max(90, m.value ?? 0) : 5;
        const delta = m.value != null && m.previous != null ? m.value - m.previous : null;
        return (
          <View key={m.key} style={styles.metricRow}>
            <Text style={styles.metricLabel}>{m.short}</Text>
            <View style={styles.metricTrack}>
              <View style={[styles.metricFill, { width: `${Math.min(((m.value ?? 0) / max) * 100, 100)}%` }]} />
            </View>
            <Text style={styles.metricValue}>
              {formatNumber(m.value, m.decimals ?? 1)}
              {m.unit ? '' : '/5'}
            </Text>
            <Text
              style={[
                styles.metricDelta,
                delta > 0 && { color: colors.primary },
                delta < 0 && { color: colors.danger },
              ]}
            >
              {delta == null ? '' : delta > 0 ? `▲ ${formatNumber(delta)}` : delta < 0 ? `▼ ${formatNumber(Math.abs(delta))}` : '—'}
            </Text>
          </View>
        );
      })}
      <Text style={styles.footnote}>Média das últimas 4 partidas, comparada com as 4 anteriores.</Text>

      {points.length > 0 && (
        <>
          <View style={styles.metricChips}>
            {METRICS.map((m) => (
              <Pressable
                key={m.key}
                onPress={() => setMetric(m.key)}
                style={[styles.metricChip, metric === m.key && styles.metricChipOn]}
              >
                <Text style={[styles.metricChipText, metric === m.key && styles.metricChipTextOn]}>{m.short}</Text>
              </Pressable>
            ))}
          </View>
          <LineChart
            points={points}
            unit={spec.unit ?? 'de 5'}
            decimals={1}
            minSpan={spec.key === 'minutes' ? 20 : 2}
            formatDate={formatShortBR}
          />
          <Text style={styles.footnote}>
            A linha é a média das últimas 4 partidas; o toque mostra a nota daquele jogo.
          </Text>
        </>
      )}

      {levels && (
        <View style={styles.levels}>
          <Text style={styles.levelsTitle}>Habilidade por força do adversário</Text>
          {levels.map((l) => (
            <View key={l.label} style={styles.tableRow}>
              <Text style={[styles.td, { flex: 1.6 }]}>
                {l.label}
                <Text style={styles.muted}>{`  ${l.count}x`}</Text>
              </Text>
              <Text style={[styles.td, styles.num]}>{formatNumber(l.skill)}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function GamesVsTraining({ logs, hasAnyGame, weeks, measurements, navigation }) {
  const games = enrichGames(logs, weeks);
  if (logs.length === 0 && hasAnyGame) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Jogos x Treinos</Text>
        <Text style={styles.muted}>Nenhum jogo avaliado neste período.</Text>
      </View>
    );
  }
  if (logs.length === 0) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Jogos x Treinos</Text>
        <Text style={styles.muted}>
          Cadastre seus jogos e avalie cada partida para ver como os treinos aparecem no seu desempenho.
        </Text>
        <Pressable onPress={() => navigation.navigate('Games')} style={[styles.button, { marginTop: 12, alignSelf: 'flex-start' }]}>
          <Text style={styles.buttonText}>Ir para Jogos</Text>
        </Pressable>
      </View>
    );
  }

  const evo = gameEvolution(games);
  const effect = trainingEffect(games);
  const insights = buildInsights({ games, allLogs: logs, weekSummaries: weeks, measurements });
  const daily = dailyTraining(weeks);
  const last28 = adherenceBefore(toDateKey(addDays(new Date(), 1)), daily, 28);
  const scored = games.filter((g) => g.score != null).length;

  return (
    <>
      {/* Número principal: quanto o desempenho nos jogos evoluiu */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Evolução nos jogos</Text>
        {evo ? (
          <>
            <Text style={[styles.hero, { color: evo.percent >= 0 ? colors.primary : colors.danger }]}>
              {evo.percent >= 0 ? '+' : ''}
              {formatNumber(evo.percent, 0)}%
            </Text>
            <Text style={styles.heroSub}>na nota geral (habilidade, intensidade e físico) das primeiras para as últimas partidas</Text>
            {evo.perModality.map((m) => (
              <View key={m.modality} style={styles.evoRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.evoTitle}>
                    {m.modality}{' '}
                    <Text style={[styles.evoPct, { color: m.percent >= 0 ? colors.primary : colors.danger }]}>
                      {m.percent >= 0 ? '▲' : '▼'} {formatNumber(Math.abs(m.percent), 0)}%
                    </Text>
                  </Text>
                  <Text style={styles.muted}>
                    Nota {formatNumber(m.from)} → {formatNumber(m.to)} · {m.window} primeiros x {m.window} últimos de {m.count} jogos
                  </Text>
                  {m.adherenceFrom != null && m.adherenceTo != null && (
                    <Text style={styles.muted}>
                      Treinos antes desses jogos: {formatNumber(m.adherenceFrom * 100, 0)}% → {formatNumber(m.adherenceTo * 100, 0)}% feitos
                    </Text>
                  )}
                </View>
              </View>
            ))}
          </>
        ) : (
          <Text style={styles.muted}>
            Avalie pelo menos 4 jogos da mesma modalidade para calcular a evolução ({scored} de 4 até agora).
          </Text>
        )}
        {last28 != null && (
          <View style={styles.constancy}>
            <Text style={styles.constancyValue}>{formatNumber(last28 * 100, 0)}%</Text>
            <Text style={styles.constancyLabel}>dos treinos feitos nos últimos 28 dias</Text>
          </View>
        )}
      </View>

      {/* Comparação: jogos com treino em dia x com pouco treino */}
      {effect && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Treino em dia x pouco treino</Text>
          <Text style={styles.muted}>
            Notas médias dos jogos conforme os treinos feitos nos {ADHERENCE_WINDOW_DAYS} dias anteriores (em dia = {Math.round(GOOD_ADHERENCE * 100)}%+).
          </Text>
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: colors.primary }]} />
              <Text style={styles.legendText}>Treino em dia ({effect.high} jogos)</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: colors.comparison }]} />
              <Text style={styles.legendText}>Pouco treino ({effect.low})</Text>
            </View>
          </View>
          {[
            { key: 'score', label: 'Nota geral' },
            { key: 'skill', label: 'Habilidade' },
            { key: 'intensity', label: 'Intensidade' },
            { key: 'stamina', label: 'Físico' },
          ].map(({ key, label }) => {
            const st = effect.stats[key];
            if (st.high == null || st.low == null) return null;
            return (
              <View key={key} style={styles.compareBlock}>
                <View style={styles.rowBetween}>
                  <Text style={styles.compareLabel}>{label}</Text>
                  <Text style={[styles.compareDiff, { color: st.percent >= 0 ? colors.primary : colors.danger }]}>
                    {st.percent >= 0 ? '+' : ''}
                    {formatNumber(st.percent, 0)}%
                  </Text>
                </View>
                <PairBar value={st.high} max={5} color={colors.primary} />
                <PairBar value={st.low} max={5} color={colors.comparison} />
              </View>
            );
          })}
        </View>
      )}

      {/* Conclusões em texto */}
      {insights.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>O que seus dados mostram</Text>
          {insights.map((i, idx) => (
            <View key={idx} style={styles.insightRow}>
              <Text style={styles.insightIcon}>{i.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.insightText}>{i.text}</Text>
                {!!i.detail && <Text style={styles.insightDetail}>{i.detail}</Text>}
              </View>
            </View>
          ))}
          <Text style={styles.footnote}>
            São relações nos seus dados, não prova de causa — adversário, cansaço e horário também pesam. Quanto mais jogos avaliados, mais confiável.
          </Text>
        </View>
      )}
    </>
  );
}

// 1 kg de gordura corporal ≈ 7.700 kcal: usado só para dar ordem de grandeza ao saldo
const KCAL_PER_KG = 7700;

function FoodCard({ days, energy, weight, period, navigation }) {
  const todayKey = toDateKey(new Date());
  const byDate = new Map(days.map((d) => [d.date, d]));
  const keys = dateRange(parseDateKey(period.fromKey), parseDateKey(period.toKey));
  const weekly = keys.length > DAILY_LIMIT;
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  const bars = [];
  const targets = [];
  if (!weekly) {
    for (const key of keys) {
      const date = parseDateKey(key);
      const d = byDate.get(key);
      const spent = energy.get(key);
      targets.push(spent ? spent.total : null);
      const gasto = spent ? ` · gasto ${formatKcal(spent.total)}` : '';
      bars.push({
        label: String(date.getDate()),
        value: d?.kcal ?? 0,
        partial: key === todayKey,
        caption: d
          ? `${formatShortBR(date)}${key === todayKey ? ' (hoje)' : ''}${gasto} · P ${Math.round(d.protein)} g`
          : `${formatShortBR(date)} · sem registro${gasto}`,
      });
    }
  } else {
    // média por semana, só com os dias registrados de cada semana
    const groups = new Map();
    for (const key of keys) {
      const wk = toDateKey(startOfWeek(parseDateKey(key)));
      const list = groups.get(wk) ?? [];
      list.push(key);
      groups.set(wk, list);
    }
    for (const [wk, list] of groups) {
      const registered = list.filter((k) => byDate.has(k));
      const kcal = mean(registered.map((k) => byDate.get(k).kcal));
      const spent = mean(registered.filter((k) => energy.get(k)).map((k) => energy.get(k).total));
      targets.push(spent);
      bars.push({
        label: formatShortBR(parseDateKey(wk)),
        value: kcal ?? 0,
        partial: list.includes(todayKey),
        caption: registered.length
          ? `Semana de ${formatShortBR(parseDateKey(wk))} · média de ${registered.length} dia${registered.length > 1 ? 's' : ''}${spent != null ? ` · gasto ${formatKcal(spent)}` : ''}`
          : `Semana de ${formatShortBR(parseDateKey(wk))} · sem registro`,
      });
    }
  }

  // médias só com dias completos e registrados: dia sem registro não é dia sem comer
  const complete = days.filter((d) => d.date !== todayKey);
  const avg = (list, fn) => (list.length ? list.reduce((s, x) => s + fn(x), 0) / list.length : null);
  const avgKcal = avg(complete, (d) => d.kcal);
  const avgProtein = avg(complete, (d) => d.protein);
  const withSpent = complete.filter((d) => energy.get(d.date));
  const avgSpent = avg(withSpent, (d) => energy.get(d.date).total);
  const avgBalance = avg(withSpent, (d) => d.kcal - energy.get(d.date).total);
  const weeklyKg = avgBalance != null ? (avgBalance * 7) / KCAL_PER_KG : null;

  const top = Math.max(...bars.map((b) => b.value), ...targets.filter((t) => t != null), 1000);
  const max = Math.ceil((top * 1.1) / 1000) * 1000; // marcas limpas: 0 / 2k / 4k

  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <Text style={styles.cardTitle}>Consumo x gasto (kcal{weekly ? ', média por semana' : ' por dia'})</Text>
        <Pressable onPress={() => navigation.navigate('Food')} hitSlop={8}>
          <Text style={styles.link}>+ Registrar</Text>
        </Pressable>
      </View>
      {days.length === 0 ? (
        <Text style={styles.muted}>Nenhuma refeição registrada neste período.</Text>
      ) : (
        <>
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: colors.primary }]} />
              <Text style={styles.legendText}>Consumido</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={styles.legendDash} />
              <Text style={styles.legendText}>Gasto estimado (base + treinos + jogos)</Text>
            </View>
          </View>
          <BarChart
            bars={bars}
            targets={targets}
            max={max}
            formatTick={(t) => (t >= 1000 ? `${formatNumber(t / 1000, t % 1000 ? 1 : 0)}k` : String(t))}
            formatValue={(v) => (v > 0 ? formatKcal(v) : '—')}
            valueUnit={weekly ? 'kcal/dia na semana' : 'kcal consumidas'}
          />
          <Text style={styles.footnote}>
            {weekly
              ? `${bars.length} semanas · cada barra é a média dos dias registrados`
              : `${keys.length} dia${keys.length > 1 ? 's' : ''}`}{' '}
            · barra clara = período em andamento
          </Text>
          <View style={styles.statsRow}>
            <Stat value={avgKcal != null ? formatKcal(avgKcal) : '—'} label="consumo médio" />
            <Stat value={avgSpent != null ? formatKcal(avgSpent) : '—'} label="gasto médio" />
            <Stat
              value={avgBalance != null ? `${avgBalance > 0 ? '+' : ''}${formatKcal(avgBalance)}` : '—'}
              label={avgBalance != null && avgBalance < 0 ? 'déficit/dia' : 'saldo/dia'}
            />
          </View>
          <View style={styles.statsRow}>
            <Stat
              value={weeklyKg != null ? `${weeklyKg > 0 ? '+' : ''}${formatNumber(weeklyKg, 2)}` : '—'}
              label="kg/semana nesse ritmo"
            />
            <Stat
              value={avgProtein != null && weight ? formatNumber(avgProtein / weight) : '—'}
              label="g de proteína por kg"
            />
          </View>
          <Text style={styles.footnote}>
            Médias dos {complete.length} dia{complete.length === 1 ? '' : 's'} registrado{complete.length === 1 ? '' : 's'} no período (fora hoje). O kg/semana é só ordem de grandeza (≈ 7.700 kcal por kg): confira com o peso das suas medições.
          </Text>
        </>
      )}
    </View>
  );
}

function PairBar({ value, max, color }) {
  return (
    <View style={styles.pairRow}>
      <View style={styles.pairTrack}>
        <View style={[styles.pairFill, { width: `${Math.min((value / max) * 100, 100)}%`, backgroundColor: color }]} />
      </View>
      <Text style={styles.pairValue}>{formatNumber(value)}</Text>
    </View>
  );
}

function Tile({ label, value, unit, note }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue}>
        {value}
        {!!unit && <Text style={styles.tileUnit}> {unit}</Text>}
      </Text>
      {!!note && <Text style={styles.tileNote}>{note}</Text>}
    </View>
  );
}

function Stat({ value, label }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, padding: 24 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e6ebe8',
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  name: { fontSize: 22, fontWeight: '700', color: colors.text },
  muted: { fontSize: 13, color: colors.muted },
  link: { fontSize: 14, fontWeight: '600', color: colors.primary },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 8 },
  footnote: { fontSize: 12, color: colors.muted, marginTop: 8 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 4 },
  tile: {
    width: '48.5%',
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e6ebe8',
  },
  tileLabel: { fontSize: 12, color: colors.muted, fontWeight: '600' },
  tileValue: { fontSize: 24, fontWeight: '800', color: colors.text, marginTop: 4 },
  tileUnit: { fontSize: 13, fontWeight: '500', color: colors.muted },
  tileNote: { fontSize: 12, color: colors.muted, marginTop: 2 },
  statsRow: { flexDirection: 'row', marginTop: 12, borderTopWidth: 1, borderTopColor: colors.grid, paddingTop: 12 },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '800', color: colors.text },
  statLabel: { fontSize: 12, color: colors.muted, marginTop: 2, textAlign: 'center' },
  tableRow: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.grid },
  tableHead: { paddingVertical: 6 },
  th: { fontSize: 12, fontWeight: '700', color: colors.muted },
  td: { fontSize: 14, color: colors.text },
  num: { flex: 1, textAlign: 'right' },
  button: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 20 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  headerButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  filterLabel: { fontSize: 11, fontWeight: '700', color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.5 },
  filterValue: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 1 },
  filterDates: { fontSize: 12, color: colors.muted, marginTop: 1 },
  filterToggle: { fontSize: 13, fontWeight: '700', color: colors.primary, marginLeft: 8 },
  hero: { fontSize: 44, fontWeight: '800', marginTop: 2 },
  heroSub: { fontSize: 13, color: colors.muted, marginBottom: 6 },
  evoRow: { flexDirection: 'row', paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.grid },
  evoTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 2 },
  evoPct: { fontSize: 14, fontWeight: '700' },
  constancy: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.grid },
  constancyValue: { fontSize: 20, fontWeight: '800', color: colors.text },
  constancyLabel: { fontSize: 13, color: colors.muted, flex: 1 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 10, marginBottom: 4 },
  legendDash: { width: 14, height: 3, borderRadius: 2, backgroundColor: colors.text },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 12, height: 12, borderRadius: 3 },
  legendText: { fontSize: 12, color: colors.muted },
  compareBlock: { marginTop: 12 },
  compareLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
  compareDiff: { fontSize: 14, fontWeight: '700' },
  pairRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  pairTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: colors.grid, overflow: 'hidden' },
  pairFill: { height: '100%', borderRadius: 5 },
  pairValue: { width: 36, textAlign: 'right', fontSize: 12, fontWeight: '600', color: colors.text },
  insightRow: { flexDirection: 'row', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.grid },
  insightIcon: { fontSize: 18, width: 24 },
  insightText: { fontSize: 14, color: colors.text, lineHeight: 20 },
  insightDetail: { fontSize: 12, color: colors.muted, marginTop: 2 },
  metricRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  metricLabel: { fontSize: 13, color: colors.text, width: 82 },
  metricTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.grid, overflow: 'hidden', marginHorizontal: 8 },
  metricFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 4 },
  metricValue: { fontSize: 13, fontWeight: '700', color: colors.text, width: 52, textAlign: 'right' },
  metricDelta: { fontSize: 12, color: colors.muted, width: 46, textAlign: 'right' },
  metricChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 16, marginBottom: 10 },
  metricChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: colors.border },
  metricChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  metricChipText: { fontSize: 12, color: colors.text, fontWeight: '500' },
  metricChipTextOn: { color: '#fff' },
  levels: { marginTop: 14, borderTopWidth: 1, borderTopColor: colors.grid, paddingTop: 6 },
  levelsTitle: { fontSize: 13, fontWeight: '700', color: colors.text, marginTop: 6, marginBottom: 2 },
  disclaimer: { fontSize: 11, color: colors.muted, textAlign: 'center', marginTop: 4, paddingHorizontal: 12 },
});
