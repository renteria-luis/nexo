// La parte que habla con iOS.
//
// Todo lo que decide que se avisa vive en core/nudges.ts y se prueba sin telefono.
// Aqui solo queda pedir el permiso, registrar los botones y dejar programado lo que
// ya se decidio. Nada de esto corre en el navegador: alli no hay a quien avisar.

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

import type { IsoDate } from '../core/dates.ts';
import type { Nudge, NudgeKind } from '../core/nudges.ts';

import { nudgePlan, recordNudges } from './nudges.ts';

const supported = Platform.OS === 'ios' || Platform.OS === 'android';

/** Un aviso al tocarlo trae esto, que es lo que deja actuar sin abrir nada. */
export type NudgeResponse = {
  nudgeId: string;
  kind: NudgeKind;
  /** El boton que toco, o 'abrir' cuando toco el aviso entero. */
  action: string;
};

// Con la app abierta tambien se ve: si no, el aviso llega y no se entera. Solo donde
// hay a quien avisar: en el navegador esto no tiene nada que hacer, y un modulo que
// toca al sistema nada mas importarse es como se cayo la app la vez pasada.
if (supported) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

async function allowed(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  // Si ya dijo que no, no se vuelve a preguntar: eso se cambia en iOS.
  if (!current.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

async function registerCategories(plan: readonly Nudge[]): Promise<void> {
  const seen = new Set<string>();
  for (const nudge of plan) {
    if (nudge.actions.length === 0 || seen.has(nudge.kind)) continue;
    seen.add(nudge.kind);
    await Notifications.setNotificationCategoryAsync(
      nudge.kind,
      nudge.actions.map((action) => ({
        identifier: action.id,
        buttonTitle: action.label,
        options: { opensAppToForeground: action.id === 'abrir' },
      })),
    );
  }
}

function fireAt(nudge: Nudge): Date {
  const [year, month, day] = nudge.date.split('-').map(Number);
  return new Date(year, month - 1, day, Math.floor(nudge.atMinute / 60), nudge.atMinute % 60, 0);
}

/** Cada cuanto como mucho se rehace el plan: cada tecla no, cada rato si. */
const SYNC_EVERY_MS = 30_000;
let lastSync = 0;

/**
 * Rehace lo programado: borra lo que habia y deja el plan de los proximos dias.
 *
 * Borrar y volver a poner, en vez de ir tocando lo que cambio, porque el plan es
 * barato de calcular y asi no queda nunca un aviso viejo de algo que ya hizo.
 */
export async function syncNudges(
  db: SQLiteDatabase,
  today: IsoDate,
  now = Date.now(),
): Promise<number> {
  if (!supported) return 0;
  // La app se recarga con cada dato que anota, y volver a programar veinte avisos en
  // cada tecla no aporta nada: lo que cambia, cambia dentro del medio minuto.
  if (now - lastSync < SYNC_EVERY_MS) return 0;
  lastSync = now;

  const plan = await nudgePlan(db, today);
  await Notifications.cancelAllScheduledNotificationsAsync();
  if (plan.length === 0) return 0;
  if (!(await allowed())) return 0;

  await registerCategories(plan);

  let scheduled = 0;
  for (const nudge of plan) {
    const date = fireAt(nudge);
    // La hora de hoy que ya paso no se programa: iOS la mostraria al instante.
    if (date.getTime() <= now) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: nudge.id,
      content: {
        title: nudge.title,
        body: nudge.body,
        categoryIdentifier: nudge.kind,
        data: { nudgeId: nudge.id, kind: nudge.kind },
        sound: false,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
    });
    scheduled += 1;
  }

  await recordNudges(db, plan);
  return scheduled;
}

/** Lo que hizo con un aviso, para que la app lo aplique y lo deje anotado. */
export function listenToNudges(onResponse: (response: NudgeResponse) => void): () => void {
  if (!supported) return () => undefined;

  const subscription = Notifications.addNotificationResponseReceivedListener((event) => {
    const data = event.notification.request.content.data as
      | { nudgeId?: string; kind?: string }
      | undefined;
    if (!data?.nudgeId || !data.kind) return;
    onResponse({
      nudgeId: data.nudgeId,
      kind: data.kind as NudgeKind,
      action:
        event.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER
          ? 'abrir'
          : event.actionIdentifier,
    });
  });

  return () => subscription.remove();
}
