export type NotificationOwner = 'health' | 'transit';
export type PendingNotice = {
  identifier: string;
  content: { data?: Record<string, unknown> | null };
};

export function noticeOwner(notice: PendingNotice): NotificationOwner | null {
  const data = notice.content.data;
  if (data?.notificationOwner === 'transit' || notice.identifier.startsWith('transit:'))
    return 'transit';
  if (data?.notificationOwner === 'health' || typeof data?.nudgeId === 'string') return 'health';
  return null;
}

/** A module can replace only its own requests, including the pre-namespace health requests. */
export function ownedNotificationChanges<T extends PendingNotice>(
  pending: readonly PendingNotice[],
  desired: readonly T[],
  owner: NotificationOwner,
) {
  const own = pending.filter((notice) => noticeOwner(notice) === owner);
  if (desired.some((notice) => noticeOwner(notice) !== owner))
    throw new Error('Notification ownership mismatch.');
  const ids = new Set(desired.map((notice) => notice.identifier));
  if (ids.size !== desired.length) throw new Error('Duplicate notification identifiers.');
  // Transit owns at most two slots. Health keeps room even when synced afterwards.
  if (
    desired.length > (owner === 'transit' ? 2 : 62) ||
    pending.length - own.length + desired.length > 64
  )
    throw new Error('No hay espacio para más avisos pendientes. Revisa los avisos en Ajustes.');
  const unchanged = new Set(
    desired
      .filter((next) =>
        own.some(
          (old) =>
            old.identifier === next.identifier &&
            next.content.data?.planSignature !== undefined &&
            next.content.data.planSignature === old.content.data?.planSignature,
        ),
      )
      .map((notice) => notice.identifier),
  );
  return {
    cancel: own
      .filter((notice) => !unchanged.has(notice.identifier))
      .map((notice) => notice.identifier),
    schedule: desired.filter((notice) => !unchanged.has(notice.identifier)),
  };
}

let pending: Promise<unknown> = Promise.resolve();
/** Native read/cancel/schedule operations must not race another module's sync. */
export function coordinateNotifications<T>(work: () => Promise<T>): Promise<T> {
  const result = pending.then(work);
  pending = result.catch(() => undefined);
  return result;
}
