import type { Schedule } from './schedule.ts';

/** null includes every current and future child; an empty set hides the layer. */
export type LayerSelection = ReadonlySet<string> | null;

export function layerState(selection: LayerSelection, ids: readonly string[]): boolean | 'mixed' {
  if (selection === null) return true;
  const count = ids.filter((id) => selection.has(id)).length;
  return count === 0 ? false : count === ids.length ? true : 'mixed';
}

export function toggleLayer(
  selection: LayerSelection,
  ids: readonly string[],
  id: string,
): LayerSelection {
  const next = new Set(selection ?? ids);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return ids.every((key) => next.has(key)) ? null : next;
}

const indexes = new WeakMap<Schedule, Map<string, Set<string>>>();

/** Every route serving a stop, including variants and both directions, from the offline feed. */
export function stopRouteIndex(schedule: Schedule): Map<string, Set<string>> {
  const cached = indexes.get(schedule);
  if (cached) return cached;
  const index = new Map<string, Set<string>>();
  const seen = new Set<string>();
  for (const trip of schedule.trips) {
    const route = schedule.routes[trip[1]][0];
    const key = `${route}:${trip[6]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const [stop] of schedule.patterns[trip[6]]) {
      const id = schedule.stops[stop][0];
      const routes = index.get(id) ?? new Set<string>();
      routes.add(route);
      index.set(id, routes);
    }
  }
  indexes.set(schedule, index);
  return index;
}

export function stopsForRoutes(schedule: Schedule, selection: LayerSelection) {
  if (selection === null) return schedule.stops;
  if (selection.size === 0) return [];
  const index = stopRouteIndex(schedule);
  return schedule.stops.filter((stop) =>
    [...(index.get(stop[0]) ?? [])].some((route) => selection.has(route)),
  );
}
