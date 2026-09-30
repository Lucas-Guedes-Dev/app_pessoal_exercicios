import { StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../theme';

export default function FormField({ label, suffix, optional, error, style, ...inputProps }) {
  return (
    <View style={[styles.wrapper, style]}>
      <Text style={styles.label}>
        {label}
        {optional && <Text style={styles.optional}> (opcional)</Text>}
      </Text>
      <View style={[styles.inputRow, error && styles.inputRowError]}>
        <TextInput style={styles.input} placeholderTextColor={colors.muted} {...inputProps} />
        {!!suffix && <Text style={styles.suffix}>{suffix}</Text>}
      </View>
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginTop: 14 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 6 },
  optional: { fontWeight: '400', color: colors.muted },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  inputRowError: { borderColor: colors.danger },
  input: { flex: 1, paddingVertical: 10, fontSize: 16, color: colors.text },
  suffix: { fontSize: 14, color: colors.muted, marginLeft: 8 },
  error: { fontSize: 12, color: colors.danger, marginTop: 4 },
});
