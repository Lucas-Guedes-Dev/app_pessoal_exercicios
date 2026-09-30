import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { LEGACY_DB_NAME, dbNameForUser } from '../db/database';

// Qual arquivo SQLite cada conta usa neste aparelho.
// O banco de antes das contas (exercicios.db) pode ser assumido por UMA conta: no primeiro
// login, se ele existir e ainda não tiver dono, o app pergunta se os dados são da pessoa.

const LEGACY_OWNER_KEY = 'db_legado_dono';
const declinedKey = (userId) => `db_legado_recusado_${userId}`;

async function legacyDbExists() {
  try {
    const info = await FileSystem.getInfoAsync(`${FileSystem.documentDirectory}SQLite/${LEGACY_DB_NAME}`);
    return info.exists;
  } catch {
    return false;
  }
}

/**
 * Nome do arquivo SQLite da conta. `askClaim()` deve perguntar à pessoa e resolver true/false.
 */
export async function databaseFileFor(user, askClaim) {
  const owner = await AsyncStorage.getItem(LEGACY_OWNER_KEY);
  if (owner === user.id) return LEGACY_DB_NAME;

  if (!owner && !(await AsyncStorage.getItem(declinedKey(user.id))) && (await legacyDbExists())) {
    if (await askClaim()) {
      await AsyncStorage.setItem(LEGACY_OWNER_KEY, user.id);
      return LEGACY_DB_NAME;
    }
    await AsyncStorage.setItem(declinedKey(user.id), '1');
  }
  return dbNameForUser(user.id);
}
