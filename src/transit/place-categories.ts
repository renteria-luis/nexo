import type { Place } from './store.ts';

export const cleanCategory = (value: string) => value.trim().replace(/\s+/g, ' ');
export const categoryKey = (value: string) => cleanCategory(value).toLocaleLowerCase('es');

/** One spelling per group, shared by the form's suggestions and both maps. */
export function placeCategories(places: readonly Pick<Place, 'category'>[]) {
  const categories = new Map<string, string>();
  for (const place of places) {
    const label = cleanCategory(place.category);
    const key = categoryKey(label);
    if (key && !categories.has(key)) categories.set(key, label);
  }
  return [...categories]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'es', { numeric: true }));
}
