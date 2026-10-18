// The photos behind screens are copies kept in the app's own documents: the picker hands
// back a file in a cache iOS may empty, and a background that vanished a week later would
// be a screen that quietly changed by itself.

import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import { launchImageLibraryAsync } from 'expo-image-picker';

export type PickedPhoto = { uri: string; width: number; height: number };

const FOLDER = 'backgrounds';

/** Opens his photos and keeps a copy of the one he picks, or null if he backs out. */
export async function pickBackgroundPhoto(): Promise<PickedPhoto | null> {
  const result = await launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;
  // The browser has no app documents; the preview there works from the picked file itself.
  if (Platform.OS === 'web') return { uri: asset.uri, width: asset.width, height: asset.height };
  const folder = new Directory(Paths.document, FOLDER);
  if (!folder.exists) folder.create();
  const extension = asset.fileName?.split('.').pop()?.toLowerCase() ?? 'jpg';
  const copy = new File(folder, `${Date.now()}.${extension}`);
  new File(asset.uri).copy(copy);
  return { uri: copy.uri, width: asset.width, height: asset.height };
}

/** Deletes the kept photos no background uses any more, after a save. */
export function prunePhotos(inUse: ReadonlySet<string>): void {
  if (Platform.OS === 'web') return;
  const folder = new Directory(Paths.document, FOLDER);
  if (!folder.exists) return;
  for (const entry of folder.list()) {
    if (entry instanceof File && !inUse.has(entry.uri)) entry.delete();
  }
}
