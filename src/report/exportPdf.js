import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { getSetting, setSetting } from '../db/database';

const SAF = FileSystem.StorageAccessFramework;
const DIR_SETTING = 'report_dir';

/** Gera o PDF a partir do HTML e devolve o arquivo com um nome legível. */
export async function generatePdf(html, baseName) {
  const { uri } = await Print.printToFileAsync({ html });
  const target = `${FileSystem.cacheDirectory}${baseName}.pdf`;
  await FileSystem.deleteAsync(target, { idempotent: true });
  await FileSystem.moveAsync({ from: uri, to: target });
  return target;
}

export const canSaveToDevice = Platform.OS === 'android';

/**
 * Salva o PDF numa pasta escolhida pela pessoa (ex.: Downloads). Na primeira vez o
 * Android pede para escolher a pasta; a escolha fica guardada para as próximas.
 * Retorna true se salvou, false se a pessoa cancelou a escolha da pasta.
 */
export async function savePdfToDevice(pdfUri, baseName) {
  const base64 = await FileSystem.readAsStringAsync(pdfUri, { encoding: FileSystem.EncodingType.Base64 });

  const write = async (dirUri) => {
    const fileUri = await SAF.createFileAsync(dirUri, baseName, 'application/pdf');
    await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
  };

  const saved = await getSetting(DIR_SETTING);
  if (saved) {
    try {
      await write(saved);
      return true;
    } catch {
      // permissão da pasta perdida (pasta apagada, app reinstalado...): pergunta de novo
    }
  }

  const permission = await SAF.requestDirectoryPermissionsAsync();
  if (!permission.granted) return false;
  await setSetting(DIR_SETTING, permission.directoryUri);
  await write(permission.directoryUri);
  return true;
}

/** Abre o menu de compartilhar (WhatsApp, Drive, e-mail, salvar em arquivos...). */
export async function sharePdf(pdfUri) {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Compartilhamento indisponível neste aparelho.');
  await Sharing.shareAsync(pdfUri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: 'Relatório de treino',
  });
}

/** Troca a pasta onde os relatórios são salvos. */
export async function forgetSaveFolder() {
  await setSetting(DIR_SETTING, '');
}
