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
import { throttled } from '../core/throttle.ts';

import { fireAt, nudgePlan, recordNudges, type Scheduled } from './nudges.ts';

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

/**
 * Los botones que abren la app al tocarlos. Los que anotan tambien: con la app cerrada,
 * iOS solo la levanta por detras y expo da el toque por entregado antes de que corra nada
 * de la app, asi que "+710 ml" desaparecia sin anotar nada. "Hoy entreno" no anota nada,
 * solo dice que hizo caso, y no vale abrirle la app por eso.
 */
const OPENS_THE_APP = new Set(['abrir', 'agua', 'descanso']);

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
        options: { opensAppToForeground: OPENS_THE_APP.has(action.id) },
      })),
    );
  }
}

/** Cada cuanto como mucho se rehace el plan: cada tecla no, cada rato si. */
const SYNC_EVERY_MS = 30_000;

/**
 * Rehace lo programado: borra lo que habia y deja el plan de los proximos dias.
 *
 * Borrar y volver a poner, en vez de ir tocando lo que cambio, porque el plan es
 * barato de calcular y asi no queda nunca un aviso viejo de algo que ya hizo.
 */
async function sync(db: SQLiteDatabase, today: IsoDate): Promise<void> {
  const now = Date.now();
  const plan = await nudgePlan(db, today);
  await Notifications.cancelAllScheduledNotificationsAsync();

  const scheduled: Scheduled[] = [];
  if (plan.length > 0 && (await allowed())) {
    await registerCategories(plan);
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
      scheduled.push({ nudge, firesAt: date.getTime() });
    }
  }

  // Tambien con el plan vacio: lo que ya estaba programado se acaba de cancelar.
  await recordNudges(db, plan, scheduled, today, now);
}

// La app se recarga con cada dato que anota, y volver a programar veinte avisos en cada
// tecla no aporta nada. Pero lo anotado dentro del medio minuto tiene que llegar al plan:
// la pasada del final lo recoge.
const throttle = throttled((db: SQLiteDatabase, today: IsoDate) => {
  sync(db, today).catch((error: unknown) => console.error(error));
}, SYNC_EVERY_MS);

export function syncNudges(db: SQLiteDatabase, today: IsoDate): void {
  if (supported) throttle.call(db, today);
}

/**
 * Lo pendiente, ya: al irse la app al fondo es la ultima vez que se puede corregir el plan
 * antes de que iOS muestre algo, y con la app dormida la pasada del final no corre.
 */
export function flushNudges(): void {
  throttle.flush();
}

function toNudgeResponse(event: Notifications.NotificationResponse): NudgeResponse | null {
  const data = event.notification.request.content.data as
    { nudgeId?: string; kind?: string } | undefined;
  if (!data?.nudgeId || !data.kind) return null;
  return {
    nudgeId: data.nudgeId,
    kind: data.kind as NudgeKind,
    action:
      event.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER
        ? 'abrir'
        : event.actionIdentifier,
  };
}

/** Lo que hizo con un aviso, para que la app lo aplique y lo deje anotado. */
export function listenToNudges(onResponse: (response: NudgeResponse) => void): () => void {
  if (!supported) return () => undefined;

  // Con la app cerrada, el toque que la abre llega antes de que haya nadie escuchando:
  // expo lo guarda y nada mas. Se lee una vez, antes de empezar a escuchar, y se borra
  // para que no vuelva a aplicarse.
  const last = Notifications.getLastNotificationResponse();
  if (last !== null) {
    Notifications.clearLastNotificationResponse();
    const response = toNudgeResponse(last);
    if (response !== null) onResponse(response);
  }

  const subscription = Notifications.addNotificationResponseReceivedListener((event) => {
    const response = toNudgeResponse(event);
    if (response !== null) onResponse(response);
  });

  return () => subscription.remove();
}
