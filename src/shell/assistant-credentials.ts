import { Platform } from 'react-native';

import {
  createCredentialStore,
  credentialStatus,
  parseCredentialFile,
  type AssistantCredentials,
} from '../core/cloud-credentials.ts';

export type { AssistantCredentials, CredentialStatus } from '../core/cloud-credentials.ts';

const STORE_KEY = 'nexo.assistant.credentials';
let browserSession: string | null = null;

const nativeStorage = async () => {
  const secure = await import('expo-secure-store');
  return {
    secure,
    options: { keychainAccessible: secure.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
  };
};

// Web previews keep keys only for this tab's lifetime. Device keys never enter SQLite.
const store = createCredentialStore({
  read: async () => {
    if (Platform.OS === 'web') return browserSession;
    const { secure, options } = await nativeStorage();
    return secure.getItemAsync(STORE_KEY, options);
  },
  write: async (value) => {
    if (Platform.OS === 'web') {
      browserSession = value;
      return;
    }
    const { secure, options } = await nativeStorage();
    await secure.setItemAsync(STORE_KEY, value, options);
  },
  remove: async () => {
    if (Platform.OS === 'web') {
      browserSession = null;
      return;
    }
    const { secure, options } = await nativeStorage();
    await secure.deleteItemAsync(STORE_KEY, options);
  },
});

export const loadAssistantCredentials = store.load;
export const saveAssistantCredentials = store.save;
export const replaceAssistantCredentials = store.replace;
export const clearAssistantCredentials = store.clear;
export async function assistantCredentialStatus() {
  return credentialStatus(await loadAssistantCredentials());
}

export async function importAssistantCredentials(): Promise<ReturnType<
  typeof credentialStatus
> | null> {
  if (Platform.OS === 'web') {
    const content = await new Promise<string | null>((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.style.display = 'none';
      input.oncancel = () => {
        input.remove();
        resolve(null);
      };
      input.onchange = async () => {
        const file = input.files?.[0];
        input.remove();
        if (!file) return resolve(null);
        if (file.size > 8192)
          return reject(new Error('Ese archivo es demasiado grande para contener dos claves.'));
        try {
          resolve(await file.text());
        } catch {
          reject(new Error('No pude leer el archivo de claves.'));
        }
      };
      document.body.appendChild(input);
      input.click();
    });
    return content === null ? null : replaceAssistantCredentials(parseCredentialFile(content));
  }
  const { File } = await import('expo-file-system');
  const picked = await File.pickFileAsync();
  if (picked.canceled) return null;
  if (picked.result.size > 8192)
    throw new Error('Ese archivo es demasiado grande para contener dos claves.');
  let content: string;
  try {
    content = await picked.result.text();
  } catch {
    throw new Error('No pude leer el archivo de claves.');
  }
  const next: AssistantCredentials = parseCredentialFile(content);
  return replaceAssistantCredentials(next);
}
