import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { isAuthConfigured, signIn, signUp } from '../services/auth';
import { colors } from '../theme';

/**
 * Entrar / Criar conta (e-mail e senha). Fora da navegação: aparece enquanto não há conta
 * logada neste aparelho. onSignedIn recebe { id, email }.
 */
export default function AuthScreen({ onSignedIn }) {
  const [mode, setMode] = useState('entrar'); // 'entrar' | 'criar'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const creating = mode === 'criar';

  const switchMode = (next) => {
    setMode(next);
    setError(null);
    setNotice(null);
  };

  const submit = async () => {
    setError(null);
    setNotice(null);
    if (!email.trim() || !password) {
      setError('Preencha o e-mail e a senha.');
      return;
    }
    if (creating && password.length < 6) {
      setError('A senha precisa ter pelo menos 6 caracteres.');
      return;
    }
    if (creating && password !== confirm) {
      setError('As senhas não conferem.');
      return;
    }
    setBusy(true);
    try {
      const user = creating ? await signUp(email, password) : await signIn(email, password);
      await onSignedIn(user);
    } catch (e) {
      const msg = String(e?.message ?? e);
      if (/^Conta criada/.test(msg)) {
        switchMode('entrar');
        setNotice(msg);
      } else setError(msg);
    } finally {
      setBusy(false);
    }
  };

  if (!isAuthConfigured()) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>App sem configuração do Supabase. Preencha o .env e gere o app de novo.</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.logo}>⚽</Text>
        <Text style={styles.title}>Treino Futebol</Text>
        <Text style={styles.subtitle}>
          {creating
            ? 'Crie a sua conta. Seus treinos, ciclo e alimentação ficam só seus.'
            : 'Entre com a sua conta para ver os seus treinos e a sua alimentação.'}
        </Text>

        <View style={styles.tabs}>
          {[
            ['entrar', 'Entrar'],
            ['criar', 'Criar conta'],
          ].map(([key, label]) => (
            <Pressable
              key={key}
              onPress={() => switchMode(key)}
              style={[styles.tab, mode === key && styles.tabActive]}
              accessibilityRole="tab"
              accessibilityState={{ selected: mode === key }}
            >
              <Text style={[styles.tabText, mode === key && styles.tabTextActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>E-mail</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="voce@exemplo.com"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="username"
        />

        <Text style={styles.label}>Senha</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder={creating ? 'Pelo menos 6 caracteres' : 'Sua senha'}
          placeholderTextColor={colors.muted}
          secureTextEntry
          autoCapitalize="none"
          autoComplete={creating ? 'password-new' : 'password'}
          textContentType={creating ? 'newPassword' : 'password'}
          onSubmitEditing={creating ? undefined : submit}
        />

        {creating && (
          <>
            <Text style={styles.label}>Repita a senha</Text>
            <TextInput
              style={styles.input}
              value={confirm}
              onChangeText={setConfirm}
              placeholderTextColor={colors.muted}
              secureTextEntry
              autoCapitalize="none"
              onSubmitEditing={submit}
            />
          </>
        )}

        {!!error && <Text style={styles.errorText}>{error}</Text>}
        {!!notice && <Text style={styles.notice}>{notice}</Text>}

        <Pressable onPress={submit} disabled={busy} style={({ pressed }) => [styles.button, (pressed || busy) && { opacity: 0.75 }]}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{creating ? 'Criar conta' : 'Entrar'}</Text>}
        </Pressable>

        <Text style={styles.hint}>
          É a mesma conta que você usa para conectar o app ao Claude. Depois do primeiro login, o app funciona sem internet.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingTop: 64, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.background },
  logo: { fontSize: 44, textAlign: 'center' },
  title: { fontSize: 26, fontWeight: '800', color: colors.primary, textAlign: 'center', marginTop: 6 },
  subtitle: { fontSize: 15, color: colors.muted, textAlign: 'center', marginTop: 8, lineHeight: 21 },
  tabs: { flexDirection: 'row', backgroundColor: colors.grid, borderRadius: 12, padding: 4, marginTop: 28, marginBottom: 8 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  tabActive: { backgroundColor: colors.card },
  tabText: { fontSize: 15, fontWeight: '600', color: colors.muted },
  tabTextActive: { color: colors.text },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 6, marginTop: 14 },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
  },
  errorText: { color: colors.danger, fontSize: 14, marginTop: 14, lineHeight: 20 },
  notice: { color: colors.primary, fontSize: 14, marginTop: 14, lineHeight: 20 },
  button: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 24 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  hint: { fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 18, lineHeight: 17 },
});
