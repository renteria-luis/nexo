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
import {
  coordinateNotifications,
  ownedNotificationChanges,
  type NotificationOwner,
} from '../core/notification-plan.ts';
import type { ActiveTrip, TripAlarm, TripEvent } from '../transit/active-trip.ts';
import { LEAVE_GRACE_MS, type NextTrip, type TravelReminder } from '../transit/journey.ts';
import { readJourneyState } from '../transit/journey-store.ts';
import { inTransaction } from '../db/transaction.ts';

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
    handleNotification: async (notice) => {
      const data = notice.request.content.data;
      const expired =
        data?.notificationOwner === 'transit' &&
        typeof data.expiresAt === 'number' &&
        Date.now() > data.expiresAt + LEAVE_GRACE_MS;
      return {
        shouldShowBanner: !expired,
        shouldShowList: !expired,
        shouldPlaySound:
          !expired &&
          (data?.notificationOwner === 'transit' || data?.notificationOwner === 'trip') &&
          data.sound === true,
        shouldSetBadge: false,
      };
    },
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

/** Preserve other modules and requests whose content and trigger have not changed. */
async function replaceOwned(
  owner: NotificationOwner,
  desired: Notifications.NotificationRequestInput[],
) {
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  const changes = ownedNotificationChanges(
    pending,
    desired.map((notice) => ({ ...notice, identifier: notice.identifier! })),
    owner,
  );
  for (const id of changes.cancel) await Notifications.cancelScheduledNotificationAsync(id);
  for (const notice of changes.schedule) await Notifications.scheduleNotificationAsync(notice);
}

async function sync(db: SQLiteDatabase, today: IsoDate): Promise<void> {
  return coordinateNotifications(async () => {
    const now = Date.now();
    const plan = await nudgePlan(db, today);

    const scheduled: Scheduled[] = [];
    const requests: Notifications.NotificationRequestInput[] = [];
    if (plan.length > 0 && (await allowed())) {
      await registerCategories(plan);
      for (const nudge of plan) {
        const date = fireAt(nudge);
        // La hora de hoy que ya paso no se programa: iOS la mostraria al instante.
        if (date.getTime() <= now) continue;
        requests.push({
          identifier: nudge.id,
          content: {
            title: nudge.title,
            body: nudge.body,
            categoryIdentifier: nudge.kind,
            data: {
              notificationOwner: 'health',
              nudgeId: nudge.id,
              kind: nudge.kind,
              planSignature: JSON.stringify([nudge.title, nudge.body, nudge.kind, date.getTime()]),
            },
            sound: false,
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
        });
        scheduled.push({ nudge, firesAt: date.getTime() });
      }
    }

    await replaceOwned('health', requests);
    // Tambien con el plan vacio: lo que ya estaba programado se acaba de cancelar.
    await recordNudges(db, plan, scheduled, today, now);
  });
}

export type TravelNotificationStatus = 'scheduled' | 'denied' | 'unsupported' | 'off';

export async function syncTransitReminders(
  db: SQLiteDatabase,
  trip: NextTrip | null,
  reminders: readonly TravelReminder[],
): Promise<TravelNotificationStatus> {
  if (!supported) return 'unsupported';
  return coordinateNotifications(async () => {
    // A slow native operation must not resurrect a trip he replaced while it was waiting.
    const saved = await readJourneyState(db);
    if (JSON.stringify(saved.next) !== JSON.stringify(trip)) return 'off';
    const now = Date.now();
    await inTransaction(db, async () => {
      await db.runAsync('UPDATE transit_reminder_event SET consumed = 1 WHERE fires_at <= ?;', [
        now,
      ]);
    });
    const events = await db.getAllAsync<{ kind: string; consumed: number }>(
      'SELECT kind, consumed FROM transit_reminder_event WHERE journey_id = ?;',
      [trip?.id ?? ''],
    );
    const due = reminders.filter(
      (r) => r.firesAt > now && !events.some((e) => e.kind === r.kind && e.consumed === 1),
    );
    const permission = !due.length || (await allowed());
    if (JSON.stringify((await readJourneyState(db)).next) !== JSON.stringify(trip)) return 'off';
    const requests = permission
      ? due.map((r): Notifications.NotificationRequestInput => ({
          identifier: r.id,
          content: {
            title: r.title,
            body: r.body,
            sound: r.sound ? 'default' : false,
            data: {
              notificationOwner: 'transit',
              journeyId: r.journeyId,
              event: r.kind,
              expiresAt: r.expiresAt,
              sound: r.sound,
              planSignature: JSON.stringify([r.firesAt, r.title, r.body, r.sound]),
            },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: new Date(r.firesAt),
          },
        }))
      : [];
    await replaceOwned('transit', requests);
    await inTransaction(db, async () => {
      // An alert cancelled before its trigger has not been consumed.
      await db.runAsync(
        'DELETE FROM transit_reminder_event WHERE journey_id = ? AND consumed = 0 AND fires_at > ?;',
        [trip?.id ?? '', now],
      );
      for (const r of permission ? due : [])
        await db.runAsync(
          'INSERT INTO transit_reminder_event (journey_id, kind, fires_at, consumed) VALUES (?, ?, ?, 0) ON CONFLICT(journey_id, kind) DO UPDATE SET fires_at = excluded.fires_at;',
          [r.journeyId, r.kind, r.firesAt],
        );
    });
    return !permission ? 'denied' : trip?.reminders ? 'scheduled' : 'off';
  });
}

const tripNotice = (trip: ActiveTrip, key: string) => `trip:${trip.id}:${key}`;

async function consumedTripEvents(db: SQLiteDatabase, tripId: string): Promise<Set<string>> {
  await inTransaction(db, async () => {
    await db.runAsync('UPDATE transit_trip_notice SET consumed = 1 WHERE fires_at <= ?;', [
      Date.now(),
    ]);
  });
  const rows = await db.getAllAsync<{ event: string }>(
    'SELECT event FROM transit_trip_notice WHERE trip_id = ? AND consumed = 1;',
    [tripId],
  );
  return new Set(rows.map((row) => row.event));
}

/**
 * A trip's events, each shown once and now. Quiet hours do not apply: he started this trip and
 * asked to be guided. One a held warning already showed is not shown again; one still held is
 * replaced by it, since both share the event's identifier.
 */
export async function presentTripEvents(
  db: SQLiteDatabase,
  trip: ActiveTrip,
  events: readonly TripEvent[],
  sound: boolean,
): Promise<void> {
  if (!supported || !events.length) return;
  await coordinateNotifications(async () => {
    if (!(await allowed())) return;
    const consumed = await consumedTripEvents(db, trip.id);
    const shown = new Set(
      (await Notifications.getPresentedNotificationsAsync()).map((n) => n.request.identifier),
    );
    for (const event of events) {
      const identifier = tripNotice(trip, event.key);
      if (shown.has(identifier) || consumed.has(event.key)) continue;
      await Notifications.cancelScheduledNotificationAsync(identifier);
      await Notifications.scheduleNotificationAsync({
        identifier,
        content: {
          title: event.title,
          body: event.body,
          sound: sound ? 'default' : false,
          data: { notificationOwner: 'trip', tripId: trip.id, event: event.key, sound },
        },
        trigger: null,
      });
      await inTransaction(db, async () => {
        await db.runAsync(
          'INSERT INTO transit_trip_notice (trip_id, event, fires_at, consumed) VALUES (?, ?, ?, 1) ON CONFLICT(trip_id, event) DO UPDATE SET consumed = 1;',
          [trip.id, event.key, Date.now()],
        );
      });
      consumed.add(event.key);
    }
  });
}

/** The warnings held for a time; an ended trip or none clears them. */
export async function syncTripAlarms(
  db: SQLiteDatabase,
  trip: ActiveTrip | null,
  alarms: readonly TripAlarm[],
  sound: boolean,
): Promise<void> {
  if (!supported) return;
  await coordinateNotifications(async () => {
    const consumed = trip ? await consumedTripEvents(db, trip.id) : new Set<string>();
    const due = alarms.filter((alarm) => alarm.at > Date.now() && !consumed.has(alarm.key));
    const permission = !due.length || (await allowed());
    const requests =
      permission && trip
        ? due.map((alarm): Notifications.NotificationRequestInput => ({
            identifier: tripNotice(trip, alarm.key),
            content: {
              title: alarm.title,
              body: alarm.body,
              sound: sound ? 'default' : false,
              data: {
                notificationOwner: 'trip',
                tripId: trip.id,
                event: alarm.key,
                sound,
                planSignature: JSON.stringify([alarm.at, alarm.title, alarm.body, sound]),
              },
            },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date: new Date(alarm.at),
            },
          }))
        : [];
    await replaceOwned('trip', requests);
    await inTransaction(db, async () => {
      await db.runAsync(
        'DELETE FROM transit_trip_notice WHERE trip_id <> ? OR (consumed = 0 AND fires_at > ?);',
        [trip?.id ?? '', Date.now()],
      );
      for (const alarm of permission && trip ? due : []) {
        await db.runAsync(
          'INSERT INTO transit_trip_notice (trip_id, event, fires_at, consumed) VALUES (?, ?, ?, 0) ON CONFLICT(trip_id, event) DO UPDATE SET fires_at = excluded.fires_at;',
          [trip!.id, alarm.key, Math.round(alarm.at)],
        );
      }
    });
  });
}

export type TransitResponse =
  { kind: 'reminder'; journeyId: string; expired: boolean } | { kind: 'trip'; tripId: string };

export function listenToTransitReminders(
  onResponse: (response: TransitResponse) => void,
): () => void {
  if (!supported) return () => undefined;
  const respond = (event: Notifications.NotificationResponse) => {
    const data = event.notification.request.content.data;
    if (data?.notificationOwner === 'trip' && typeof data.tripId === 'string') {
      onResponse({ kind: 'trip', tripId: data.tripId });
      return true;
    }
    if (data?.notificationOwner !== 'transit' || typeof data.journeyId !== 'string') return false;
    onResponse({
      kind: 'reminder',
      journeyId: data.journeyId,
      expired: typeof data.expiresAt === 'number' && Date.now() > data.expiresAt + LEAVE_GRACE_MS,
    });
    return true;
  };
  const last = Notifications.getLastNotificationResponse();
  if (last && respond(last)) Notifications.clearLastNotificationResponse();
  const subscription = Notifications.addNotificationResponseReceivedListener(respond);
  return () => subscription.remove();
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
    const response = toNudgeResponse(last);
    if (response !== null) {
      Notifications.clearLastNotificationResponse();
      onResponse(response);
    }
  }

  const subscription = Notifications.addNotificationResponseReceivedListener((event) => {
    const response = toNudgeResponse(event);
    if (response !== null) onResponse(response);
  });

  return () => subscription.remove();
}
