import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

const VALUES = [1, 2, 3, 4, 5];

/** Nota de 1 a 5. Tocar na nota já selecionada limpa o campo. */
export default function RatingInput({ label, value, onChange, lowLabel, highLabel, error }) {
  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        {VALUES.map((v) => {
          const active = value === v;
          return (
            <Pressable
              key={v}
              onPress={() => onChange(active ? null : v)}
              style={({ pressed }) => [styles.dot, active && styles.dotActive, pressed && { opacity: 0.7 }]}
            >
              <Text style={[styles.dotText, active && styles.dotTextActive]}>{v}</Text>
            </Pressable>
          );
        })}
      </View>
      {(lowLabel || highLabel) && (
        <View style={styles.scaleRow}>
          <Text style={styles.scaleText}>{lowLabel}</Text>
          <Text style={styles.scaleText}>{highLabel}</Text>
        </View>
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginTop: 16 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8 },
  row: { flexDirection: 'row', gap: 8 },
  dot: {
    flex: 1,
    height: 46,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  dotText: { fontSize: 17, fontWeight: '600', color: colors.text },
  dotTextActive: { color: '#fff' },
  scaleRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  scaleText: { fontSize: 11, color: colors.muted },
  error: { fontSize: 12, color: colors.danger, marginTop: 4 },
});
