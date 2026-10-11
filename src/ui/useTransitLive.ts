import { useIsFocused } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import {
  clearTransitLiveConfig,
  createTransitLiveClient,
  loadTransitLiveConfig,
  saveTransitLiveConfig,
  type TransitLiveConfig,
} from '../shell/transit-live.ts';
import type { LiveQuery, TransitLiveState } from '../transit/realtime.ts';
import type { Schedule } from '../transit/schedule.ts';

const initial: TransitLiveState = {
  query: null,
  snapshot: null,
  loading: false,
  reason: null,
  nextRefreshAt: null,
  lastSuccessAt: null,
};

export function useTransitLive(
  schedule: Schedule | undefined,
  query: LiveQuery | null,
  departureAt?: number,
) {
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [config, setConfig] = useState<TransitLiveConfig | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState(initial);
  const [configError, setConfigError] = useState<string | null>(null);
  const controller = useRef<ReturnType<typeof createTransitLiveClient> | null>(null);

  useEffect(() => {
    let alive = true;
    loadTransitLiveConfig()
      .then((saved) => {
        if (alive) setConfig(saved);
      })
      .catch((error) => {
        if (alive) setConfigError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    const subscription = AppState.addEventListener('change', (next) =>
      setActive(next === 'active'),
    );
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!schedule || !loaded) return;
    const client = createTransitLiveClient({ schedule, config, onState: setState });
    controller.current = client;
    return () => {
      client.dispose();
      controller.current = null;
    };
  }, [schedule, config, loaded]);

  useEffect(() => {
    controller.current?.setQuery(query, { departureAt });
  }, [schedule, config, loaded, query, departureAt]);
  useEffect(() => {
    controller.current?.setForeground(focused && active);
  }, [schedule, config, loaded, focused, active]);

  const save = useCallback(async (next: TransitLiveConfig) => {
    await saveTransitLiveConfig(next);
    setConfig(next);
    setConfigError(null);
  }, []);
  const clear = useCallback(async () => {
    await clearTransitLiveConfig();
    setConfig(null);
    setConfigError(null);
  }, []);
  const refresh = useCallback(() => controller.current?.refresh(), []);
  return { state, config, configError, loaded, save, clear, refresh, active: focused && active };
}
