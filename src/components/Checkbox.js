import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

export default function Checkbox({ checked }) {
  return (
    <View style={[styles.box, checked && styles.boxChecked]}>
      {checked && <Text style={styles.check}>✓</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
  },
  boxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  check: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 20,
  },
});
