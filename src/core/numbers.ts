// Como se escribe un numero que cambia, en un solo sitio: kcal, pasos, mg y volumen lo
// usaban unos si y otros no ("7624" junto a "7 017").

/** Miles con espacio fino, que es lo que se lee de un vistazo en una columna. */
export function thousands(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
