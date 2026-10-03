import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * Una transaccion detras de otra, nunca dos a la vez.
 *
 * expo-sqlite abre cada transaccion sobre la unica conexion que hay y no la aisla de
 * nada (`withTransactionAsync` es BEGIN, la tarea y COMMIT). Si una segunda empieza
 * mientras la primera sigue abierta, su BEGIN falla, su ROLLBACK deshace lo que llevaba
 * la primera, y la primera sigue escribiendo suelta: asi dos toques seguidos en "Comer
 * una porcion" bajaban la tanda sin anotar la porcion. Aqui cada una espera a que
 * termine la anterior.
 *
 * Nada que corra dentro de una puede abrir otra: esperaria a que termine la que la
 * contiene, que es ella misma.
 */
const tails = new WeakMap<SQLiteDatabase, Promise<unknown>>();

export function inTransaction(db: SQLiteDatabase, task: () => Promise<void>): Promise<void> {
  const previous = tails.get(db) ?? Promise.resolve();
  const next = previous.then(() => db.withTransactionAsync(task));
  // La que falla no puede trabar a las que esperan detras; quien la pidio si ve el error.
  tails.set(
    db,
    next.catch(() => undefined),
  );
  return next;
}

/**
 * Cuando termina lo que ya esta en cola. Una lectura que entra en medio de una escritura
 * en bloque la ve a medias: las ofertas del dia, que ahora se bajan solas mientras el
 * anota, salian con la mitad de la lista.
 */
export function whenIdle(db: SQLiteDatabase): Promise<void> {
  return (tails.get(db) ?? Promise.resolve()).then(() => undefined);
}
