import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import PeriodFilter, { usePeriodFilter } from '../components/PeriodFilter';
import { buildReportHtml } from '../report/buildReportHtml';
import { collectReportData } from '../report/collectReportData';
import { canSaveToDevice, forgetSaveFolder, generatePdf, savePdfToDevice, sharePdf } from '../report/exportPdf';
import { colors } from '../theme';

const SECTIONS = [
  { key: 'body', label: 'Corpo', detail: 'perfil, peso, IMC, medições' },
  { key: 'training', label: 'Treinos', detail: 'semanas, % feito, plano atual' },
  { key: 'games', label: 'Jogos', detail: 'evolução, treino x jogo, todas as partidas' },
  { key: 'food', label: 'Alimentação', detail: 'consumo x gasto, macros, alimentos mais comidos' },
];

export default function ReportScreen() {
  const filter = usePeriodFilter({ initialMode: 'cycle' });
  const { period } = filter;
  const [sections, setSections] = useState({ body: true, training: true, games: true, food: true });
  const [busy, setBusy] = useState(null); // 'save' | 'share' enquanto gera

  const toggle = (key) => setSections((s) => ({ ...s, [key]: !s[key] }));
  const anySection = Object.values(sections).some(Boolean);

  const run = async (action) => {
    if (period.error) {
      Alert.alert('Período', period.error);
      return;
    }
    if (!anySection) {
      Alert.alert('Relatório', 'Escolha pelo menos uma seção.');
      return;
    }
    setBusy(action);
    try {
      const data = await collectReportData(period, sections);
      const name = `relatorio-treino-${period.file}`;
      const uri = await generatePdf(buildReportHtml(data), name);
      if (action === 'share') {
        await sharePdf(uri);
      } else if (await savePdfToDevice(uri, name)) {
        Alert.alert('PDF salvo', `"${name}.pdf" foi salvo na pasta escolhida.`, [
          { text: 'OK' },
          { text: 'Compartilhar', onPress: () => sharePdf(uri).catch(() => {}) },
        ]);
      }
    } catch (e) {
      Alert.alert('Não foi possível gerar o PDF', String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const changeFolder = async () => {
    await forgetSaveFolder();
    Alert.alert('Pasta', 'Na próxima vez que salvar, o app vai pedir para escolher a pasta de novo.');
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.label}>Período</Text>
      <PeriodFilter filter={filter} />

      <Text style={styles.label}>O que entra no relatório</Text>
      {SECTIONS.map((s) => (
        <Pressable
          key={s.key}
          onPress={() => toggle(s.key)}
          style={({ pressed }) => [styles.section, sections[s.key] && styles.sectionOn, pressed && { opacity: 0.8 }]}
        >
          <View style={[styles.check, sections[s.key] && styles.checkOn]}>
            {sections[s.key] && <Text style={styles.checkMark}>✓</Text>}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.sectionTitle}>{s.label}</Text>
            <Text style={styles.sectionDetail}>{s.detail}</Text>
          </View>
        </Pressable>
      ))}

      {canSaveToDevice && (
        <Pressable
          onPress={() => run('save')}
          disabled={!!busy}
          style={({ pressed }) => [styles.button, (pressed || busy) && { opacity: 0.7 }]}
        >
          {busy === 'save' ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>💾 Baixar PDF no celular</Text>}
        </Pressable>
      )}
      <Pressable
        onPress={() => run('share')}
        disabled={!!busy}
        style={({ pressed }) => [styles.buttonOutline, (pressed || busy) && { opacity: 0.7 }]}
      >
        {busy === 'share' ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Text style={styles.buttonOutlineText}>📤 Compartilhar PDF</Text>
        )}
      </Pressable>

      {canSaveToDevice && (
        <>
          <Text style={styles.hint}>
            Na primeira vez, o Android pede para escolher a pasta onde salvar (ex.: Download). Depois ele salva direto lá.
          </Text>
          <Pressable onPress={changeFolder} hitSlop={8}>
            <Text style={styles.link}>Trocar a pasta de salvamento</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 40 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginTop: 16, marginBottom: 8 },
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e6ebe8',
  },
  sectionOn: { borderColor: colors.primary },
  check: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkMark: { color: '#fff', fontWeight: '800', fontSize: 14, lineHeight: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  sectionDetail: { fontSize: 12, color: colors.muted, marginTop: 2 },
  button: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 20, minHeight: 52, justifyContent: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  buttonOutline: { borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 10, borderWidth: 1.5, borderColor: colors.primary, minHeight: 52, justifyContent: 'center' },
  buttonOutlineText: { color: colors.primary, fontSize: 16, fontWeight: '700' },
  hint: { fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 14, lineHeight: 18 },
  link: { fontSize: 13, color: colors.primary, fontWeight: '600', textAlign: 'center', marginTop: 8 },
});
