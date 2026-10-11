import { Platform } from 'react-native';

import {
  createLiveClient,
  createTransitLiveConfigStore,
  LIVE_LOCAL_MAX_BYTES,
  type LiveCacheStorage,
  type LiveClientOptions,
  type TransitLiveConfig,
} from '../transit/realtime.ts';

export type { TransitLiveConfig } from '../transit/realtime.ts';

const CONFIG_KEY = 'nexo.transit.live.connection';
let browserConfig: string | null = null;
let browserSnapshot: string | null = null;
let pendingCache: Promise<void> = Promise.resolve();
let cacheEpoch = 0;

function mutateCache(work: () => Promise<void>) {
  const result = pendingCache.then(work);
  pendingCache = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

const nativeStorage = async () => {
  const secure = await import('expo-secure-store');
  return { secure, options: { keychainAccessible: secure.WHEN_UNLOCKED_THIS_DEVICE_ONLY } };
};

const configStore = createTransitLiveConfigStore({
  read: async () => {
    if (Platform.OS === 'web') return browserConfig;
    const { secure, options } = await nativeStorage();
    return secure.getItemAsync(CONFIG_KEY, options);
  },
  write: async (content) => {
    if (Platform.OS === 'web') {
      browserConfig = content;
      return;
    }
    const { secure, options } = await nativeStorage();
    await secure.setItemAsync(CONFIG_KEY, content, options);
  },
  remove: async () => {
    if (Platform.OS === 'web') {
      browserConfig = null;
      return;
    }
    const { secure, options } = await nativeStorage();
    await secure.deleteItemAsync(CONFIG_KEY, options);
  },
});

const cacheFile = async () => {
  const { File, Paths } = await import('expo-file-system');
  return {
    file: new File(Paths.cache, 'transit-live-v1.json'),
    temporary: new File(Paths.cache, 'transit-live-v1.next'),
  };
};

// Both public data and credentials are transient on web; neither enters a backup.
const cache: LiveCacheStorage = {
  read: async () => {
    await pendingCache;
    if (Platform.OS === 'web') return browserSnapshot;
    const { file } = await cacheFile();
    if (!file.exists) return null;
    if (file.size > LIVE_LOCAL_MAX_BYTES)
      throw new Error('La última lectura de Transit supera el tamaño permitido.');
    return file.text();
  },
  write: (content) =>
    mutateCache(async () => {
      if (Platform.OS === 'web') {
        browserSnapshot = content;
        return;
      }
      const { file, temporary } = await cacheFile();
      temporary.create({ overwrite: true });
      temporary.write(content);
      await temporary.move(file, { overwrite: true });
    }),
  remove: () =>
    mutateCache(async () => {
      if (Platform.OS === 'web') {
        browserSnapshot = null;
        return;
      }
      const { file, temporary } = await cacheFile();
      if (file.exists) file.delete();
      if (temporary.exists) temporary.delete();
    }),
};

export const loadTransitLiveConfig = configStore.load;
export async function saveTransitLiveConfig(next: TransitLiveConfig) {
  const saved = await configStore.save(next);
  cacheEpoch += 1;
  return saved;
}
export async function clearTransitLiveConfig() {
  cacheEpoch += 1;
  await configStore.clear();
  await cache.remove();
}

export function createTransitLiveClient(options: Omit<LiveClientOptions, 'fetcher' | 'cache'>) {
  const epoch = cacheEpoch;
  const client = createLiveClient({
    ...options,
    fetcher: fetch,
    cache: {
      ...cache,
      write: (content) => (epoch === cacheEpoch ? cache.write(content) : Promise.resolve()),
    },
  });
  options.onState(client.getState());
  return client;
}
