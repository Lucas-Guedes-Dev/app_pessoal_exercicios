import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Chip from './Chip';
import { getCycleWeeks, getSetting, setSetting } from '../db/database';
import { getEarliestDataKey } from '../report/collectReportData';
import {
  MONTHS,
  customPeriod,
  cyclePeriod,
  cyclesFrom,
  dayPeriod,
  daysIn,
  lastDaysPeriod,
  monthPeriod,
} from '../report/periods';
import { colors } from '../theme';
import { addDays, formatDateBR, parseDateKey, toDateKey, weekdayCode, weekdayName } from '../utils/dates';
import { maskDateBR, parseBirthBR } from '../utils/health';

const MODES = [
  { key: 'cycle', label: 'Ciclo' },
  { key: 'day', label: 'Dia' },
  { key: 'month', label: 'Mês' },
  { key: 'range', label: 'Período' },
  { key: 'all', label: 'Tudo' },
];
const QUICK_RANGES = [7, 15, 30, 90];
const brDate = (key) => formatDateBR(parseDateKey(key));

/**
 * Estado do filtro de período (ciclo, dia, mês, período ou tudo).
 * rememberAs: chave em settings para lembrar o último tipo escolhido (opcional).
 * Retorna { period, ...estado } — period é { fromKey, toKey, label, file } ou { error }.
 */
export function usePeriodFilter({ initialMode = 'cycle', rememberAs } = {}) {
  const today = new Date();
  const todayKey = toDateKey(today);

  const [mode, setModeState] = useState(initialMode);
  const [cycles, setCycles] = useState([]);
  const [cycleNum, setCycleNum] = useState(null);
  const [day, setDay] = useState(todayKey);
  const [dayText, setDayText] = useState(brDate(todayKey));
  const [month, setMonth] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [fromText, setFromText] = useState(brDate(toDateKey(addDays(today, -29))));
  const [toText, setToText] = useState(brDate(todayKey));
  const [earliest, setEarliest] = useState(null);

  useEffect(() => {
    getCycleWeeks()
      .then((weeks) => {
        const list = cyclesFrom(weeks);
        setCycles(list);
        setCycleNum(list[0]?.cycle ?? null); // o atual vem primeiro
      })
      .catch(() => {});
    getEarliestDataKey().then(setEarliest).catch(() => setEarliest(todayKey));
    if (rememberAs) {
      getSetting(rememberAs)
        .then((saved) => {
          if (MODES.some((m) => m.key === saved)) setModeState(saved);
        })
        .catch(() => {});
    }
  }, [todayKey, rememberAs]);

  const setMode = (m) => {
    setModeState(m);
    if (rememberAs) setSetting(rememberAs, m).catch(() => {});
  };

  const period = useMemo(() => {
    if (mode === 'cycle') {
      const c = cycles.find((x) => x.cycle === cycleNum);
      return c ? cyclePeriod(c) : { error: 'Nenhum ciclo registrado ainda.' };
    }
    if (mode === 'day') return dayPeriod(day);
    if (mode === 'month') return monthPeriod(month.year, month.month, new Date());
    if (mode === 'all') {
      return earliest
        ? { ...customPeriod(earliest, todayKey), label: 'Todo o histórico', file: 'completo' }
        : { error: 'Carregando o histórico…' };
    }
    const from = parseBirthBR(fromText);
    const to = parseBirthBR(toText);
    if (!from || !to) return { error: 'Preencha as duas datas no formato DD/MM/AAAA.' };
    if (from > to) return { error: 'A data inicial é depois da final.' };
    if (to > todayKey) return { error: 'A data final não pode ser depois de hoje.' };
    return customPeriod(from, to);
  }, [mode, cycles, cycleNum, day, month, fromText, toText, earliest, todayKey]);

  return {
    period,
    mode,
    setMode,
    cycles,
    cycleNum,
    setCycleNum,
    day,
    setDay,
    dayText,
    setDayText,
    month,
    setMonth,
    fromText,
    setFromText,
    toText,
    setToText,
    todayKey,
  };
}

/** Controles do filtro de período. filter: o retorno de usePeriodFilter. */
export default function PeriodFilter({ filter }) {
  const f = filter;
  const today = new Date();
  const { todayKey } = f;

  const shiftDay = (delta) => {
    const next = toDateKey(addDays(parseDateKey(f.day), delta));
    if (next > todayKey) return;
    f.setDay(next);
    f.setDayText(brDate(next));
  };
  const typeDay = (text) => {
    const masked = maskDateBR(text);
    f.setDayText(masked);
    const key = parseBirthBR(masked);
    if (key && key <= todayKey) f.setDay(key);
  };
  const shiftMonth = (delta) => {
    const d = new Date(f.month.year, f.month.month + delta, 1);
    if (d > today) return;
    f.setMonth({ year: d.getFullYear(), month: d.getMonth() });
  };
  const isCurrentMonth = f.month.year === today.getFullYear() && f.month.month === today.getMonth();
  const quickRange = (days) => {
    const p = lastDaysPeriod(days, today);
    f.setFromText(brDate(p.fromKey));
    f.setToText(brDate(p.toKey));
  };
  const { period } = f;

  return (
    <View>
      <View style={styles.chips}>
        {MODES.map((m) => (
          <Chip key={m.key} label={m.label} selected={f.mode === m.key} onPress={() => f.setMode(m.key)} />
        ))}
      </View>

      <View style={styles.box}>
        {f.mode === 'cycle' &&
          (f.cycles.length === 0 ? (
            <Text style={styles.muted}>Nenhum ciclo registrado ainda.</Text>
          ) : (
            <View style={styles.chips}>
              {f.cycles.map((c) => (
                <Chip
                  key={c.cycle}
                  label={`Ciclo ${c.cycle}${c.current ? ' (atual)' : ''}`}
                  selected={f.cycleNum === c.cycle}
                  onPress={() => f.setCycleNum(c.cycle)}
                />
              ))}
            </View>
          ))}

        {f.mode === 'day' && (
          <>
            <View style={styles.stepper}>
              <StepButton label="‹" onPress={() => shiftDay(-1)} />
              <TextInput
                style={styles.dateInput}
                value={f.dayText}
                onChangeText={typeDay}
                keyboardType="number-pad"
                maxLength={10}
                placeholder="DD/MM/AAAA"
                placeholderTextColor={colors.muted}
              />
              <StepButton label="›" onPress={() => shiftDay(1)} disabled={f.day >= todayKey} />
            </View>
            <Text style={styles.centerNote}>
              {f.day === todayKey ? 'Hoje' : weekdayName(weekdayCode(parseDateKey(f.day)))}
              {f.day !== todayKey && (
                <Text
                  style={styles.link}
                  onPress={() => {
                    f.setDay(todayKey);
                    f.setDayText(brDate(todayKey));
                  }}
                >
                  {'   '}voltar para hoje
                </Text>
              )}
            </Text>
          </>
        )}

        {f.mode === 'month' && (
          <View style={styles.stepper}>
            <StepButton label="‹" onPress={() => shiftMonth(-1)} />
            <Text style={styles.stepValue}>
              {MONTHS[f.month.month]} de {f.month.year}
            </Text>
            <StepButton label="›" onPress={() => shiftMonth(1)} disabled={isCurrentMonth} />
          </View>
        )}

        {f.mode === 'range' && (
          <>
            <View style={styles.rangeRow}>
              <DateField label="De" value={f.fromText} onChange={f.setFromText} />
              <DateField label="Até" value={f.toText} onChange={f.setToText} />
            </View>
            <View style={[styles.chips, { marginTop: 10 }]}>
              {QUICK_RANGES.map((d) => (
                <Chip key={d} label={`Últimos ${d} dias`} selected={false} onPress={() => quickRange(d)} />
              ))}
            </View>
          </>
        )}

        {f.mode === 'all' && <Text style={styles.muted}>Desde o primeiro registro no app até hoje.</Text>}

        <View style={styles.summary}>
          {period.error ? (
            <Text style={styles.error}>{period.error}</Text>
          ) : (
            <Text style={styles.summaryText}>
              📅 {period.fromKey === period.toKey ? brDate(period.fromKey) : `${brDate(period.fromKey)} a ${brDate(period.toKey)}`}
              {period.fromKey !== period.toKey ? `  ·  ${daysIn(period)} dias` : ''}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

function DateField({ label, value, onChange }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.smallLabel}>{label}</Text>
      <TextInput
        style={styles.rangeInput}
        value={value}
        onChangeText={(t) => onChange(maskDateBR(t))}
        keyboardType="number-pad"
        maxLength={10}
        placeholder="DD/MM/AAAA"
        placeholderTextColor={colors.muted}
      />
    </View>
  );
}

function StepButton({ label, onPress, disabled }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={({ pressed }) => [styles.stepButton, (disabled || pressed) && { opacity: 0.3 }]}
    >
      <Text style={styles.stepButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  box: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 12, borderWidth: 1, borderColor: '#e6ebe8' },
  muted: { fontSize: 13, color: colors.muted },
  smallLabel: { fontSize: 12, fontWeight: '600', color: colors.muted, marginBottom: 4 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  stepButtonText: { fontSize: 26, color: colors.primary, lineHeight: 30, fontWeight: '600' },
  stepValue: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: colors.text },
  dateInput: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 8,
  },
  centerNote: { textAlign: 'center', fontSize: 13, color: colors.muted, marginTop: 8 },
  link: { fontSize: 13, color: colors.primary, fontWeight: '600' },
  rangeRow: { flexDirection: 'row', gap: 12 },
  rangeInput: {
    fontSize: 16,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  summary: { marginTop: 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.grid },
  summaryText: { fontSize: 14, fontWeight: '600', color: colors.text },
  error: { fontSize: 13, color: colors.danger },
});
