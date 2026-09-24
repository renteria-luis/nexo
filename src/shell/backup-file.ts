// El respaldo visto desde el telefono: escribir el archivo, pasarlo a donde el
// quiera guardarlo, y leer uno de vuelta.
//
// expo-file-system trae su propio selector de archivos desde el SDK 54
// (File.pickFileAsync), asi que no hace falta un paquete aparte para elegir el JSON.

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { exportBackup, importBackup, parseBackup, type ImportResult } from '../core/backup.ts';
import { todayIso } from '../core/dates.ts';
import { openDatabase } from '../db/index.ts';

import { buildDayExports } from './records.ts';

function fileName(at: number): string {
  const when = new Date(at);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `nexo-${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}.json`;
}

export type ExportOutcome = { uri: string; bytes: number; shared: boolean };

/**
 * Escribe el volcado completo y abre la hoja de compartir para que quede fuera del
 * telefono. Si el sistema no ofrece compartir, el archivo igual queda escrito y la
 * pantalla dice donde.
 */
export async function exportToFile(): Promise<ExportOutcome> {
  const db = await openDatabase();
  const backup = await exportBackup(db, await buildDayExports(db, todayIso()));
  // Con sangria: un JSON de un solo renglon de varios megas cuelga al editor que lo
  // abre, y este archivo esta hecho para poder mirarlo.
  const json = JSON.stringify(backup, null, 2);

  const file = new File(Paths.document, fileName(backup.exportedAt));
  file.create({ overwrite: true });
  file.write(json);

  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      UTI: 'public.json',
      dialogTitle: 'Respaldo de nexo',
    });
  }

  return { uri: file.uri, bytes: json.length, shared: canShare };
}

/** Null cuando cierra el selector sin elegir nada. */
export async function importFromFile(): Promise<ImportResult | null> {
  const picked = await File.pickFileAsync({ mimeTypes: ['application/json'] });
  if (picked.canceled) return null;

  const text = await picked.result.text();
  const db = await openDatabase();
  return importBackup(db, parseBackup(JSON.parse(text)));
}
