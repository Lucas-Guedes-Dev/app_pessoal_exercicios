import { Pressable, StyleSheet, Text } from 'react-native';
import { colors } from '../theme';

export default function Chip({ label, selected, onPress, onLongPress, style }) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && { opacity: 0.7 },
        style,
      ]}
    >
      <Text style={[styles.text, selected && styles.textSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  text: { fontSize: 14, color: colors.text, fontWeight: '500' },
  textSelected: { color: '#fff' },
});
