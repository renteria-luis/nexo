import { useRoute } from '@react-navigation/native';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppData } from '../../shell/AppData.tsx';

import { Screen } from './Screen.tsx';
import { mono, theme } from '../theme.ts';

type RoutineId = 'push' | 'pull' | 'legs';

type Recommendation = {
  title: string;
  why: string;
  effect?: string;
  /** Which day this belongs to, so the list can shrink to the one he is training. */
  routines: RoutineId[];
};

// Written from the Fanshawe catalogue and the volume audit, and kept free of body
// measurements: this ships in the app bundle and the repository is public.
const CHANGES: Recommendation[] = [
  {
    title: 'Deltoide posterior en la NM537',
    routines: ['pull'],
    why: 'Hace remo y deltoide posterior en la misma estación. Hoy el contractor invertido compite por la P156 con el contractor de pecho, y por eso queda para "si me da tiempo".',
    effect: '0 a 4 series por semana → 6 a 9',
  },
  {
    title: 'Quitar los aductores (C114)',
    routines: ['legs'],
    why: 'La meta en pierna es fuerza y función, no tamaño. Son tres series por semana que no compran nada.',
    effect: '3 series por semana → 0',
  },
  {
    title: 'Laterales en la polea Matrix',
    routines: ['push'],
    why: 'La polea mantiene la tensión en todo el recorrido. Con mancuerna, abajo la carga sobre el deltoide es casi cero.',
    effect: '6 series por semana → 10 a 12',
  },
  {
    title: 'Antebrazo directo',
    routines: ['pull'],
    why: 'Curl de muñeca con barra Z o paseos con mancuernas. No hay máquina de antebrazo en Fanshawe, pero sí el material.',
    effect: '0 series directas → 4 a 6',
  },
  {
    title: 'Pierna con otro carácter',
    routines: ['legs'],
    why: 'Bisagra con barra, V-Squat, prensa a una pierna en la C403 y paseos. Un día de fuerza y función en vez de uno de máquinas de aislamiento.',
  },
  {
    title: 'Descansos de 2 minutos en contractor y laterales',
    routines: ['push'],
    why: 'Brazos y hombros son justo donde descansar más rinde más. Es el cambio más barato de todos.',
  },
  {
    title: 'Un curl menos',
    routines: ['pull'],
    why: 'Fuera el predicador de la B158. Se quedan el curl inclinado, por el estiramiento, y el martillo, que también trabaja antebrazo.',
    effect: '20 a 24 series por semana → 14 a 18',
  },
];

const UNCHANGED: Recommendation[] = [
  {
    title: 'Pecho',
    routines: ['push'],
    why: 'Ya cubres inclinado con mancuernas, plano en la P140 y aperturas en la P156. Lo único que falta es declinado y Fanshawe no tiene estación para eso.',
  },
  {
    title: 'Espalda',
    routines: ['pull'],
    why: 'Está dentro de la banda y la meta es estética, no tamaño. Hay D123, NM500 y NM537 disponibles, pero más volumen ahí no compra nada que hayas pedido.',
  },
  {
    title: 'Cardio',
    routines: ['push', 'pull', 'legs'],
    why: 'Los pasos diarios son mejor palanca y ya cuentan en tu nota.',
  },
];

function Item({ item }: { item: Recommendation }) {
  return (
    <View style={styles.item}>
      <Text style={styles.itemTitle}>{item.title}</Text>
      <Text style={styles.itemWhy}>{item.why}</Text>
      {item.effect ? <Text style={styles.itemEffect}>{item.effect}</Text> : null}
    </View>
  );
}

export function RoutineNotesScreen() {
  const { state } = useAppData();
  const readapting = state.phase === 'ready' ? state.loaded.readapting : null;

  // Arriving from a session in progress, the day's routine comes with it and the
  // list opens on that day only. Everything else is still one tap away.
  const route = useRoute<{ key: string; name: string; params?: { routineId?: string } }>();
  const routineId = route.params?.routineId ?? null;
  const [onlyToday, setOnlyToday] = useState(routineId !== null);
  const keep = (item: Recommendation) =>
    !onlyToday || routineId === null || item.routines.includes(routineId as RoutineId);
  const changes = CHANGES.filter(keep);
  const unchanged = UNCHANGED.filter(keep);

  return (
    <Screen>
      <Text style={styles.intro}>
        Propuestas para potenciar la hipertrofia con las máquinas de Fanshawe. Cambiar el programa
        durante la readaptación impide saber si un estancamiento vino del mes parado o de los
        cambios, así que esperan a que termine.
      </Text>

      <Text style={readapting ? styles.blocked : styles.ready}>
        {readapting
          ? `Readaptación activa hasta el ${readapting.endsOn}. Todavía no se aplican.`
          : 'La readaptación no está activa: ya se pueden aplicar.'}
      </Text>

      {routineId !== null && (
        <Pressable
          accessibilityLabel={onlyToday ? 'Ver todas las rutinas' : 'Ver solo la rutina de hoy'}
          onPress={() => setOnlyToday((only) => !only)}
          style={styles.filter}
        >
          <Text style={styles.filterText}>
            {onlyToday ? 'Viendo solo la rutina de hoy · ver todo' : 'Viendo todo · solo hoy'}
          </Text>
        </Pressable>
      )}

      <Text style={styles.section}>Cambios</Text>
      {changes.map((item) => (
        <Item key={item.title} item={item} />
      ))}

      <Text style={styles.section}>Lo que no cambiaría</Text>
      {unchanged.map((item) => (
        <Item key={item.title} item={item} />
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: {
    fontSize: 13,
    color: theme.textDim,
    lineHeight: 19,
  },
  blocked: {
    fontSize: 12,
    color: theme.warn,
    backgroundColor: theme.warnBg,
    padding: 8,
    borderRadius: 6,
    overflow: 'hidden',
  },
  ready: {
    fontSize: 12,
    color: theme.ok,
    backgroundColor: theme.okBg,
    padding: 8,
    borderRadius: 6,
    overflow: 'hidden',
  },
  section: {
    fontSize: 14,
    marginTop: 8,
    fontFamily: mono,
    color: theme.text,
  },
  filter: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  filterText: {
    fontSize: 11,
    color: theme.textFaint,
    textDecorationLine: 'underline',
    fontFamily: mono,
  },
  item: {
    borderTopWidth: 1,
    borderTopColor: theme.line,
    paddingTop: 8,
    gap: 3,
  },
  itemTitle: {
    fontSize: 13,
    fontFamily: mono,
    color: theme.text,
  },
  itemWhy: {
    fontSize: 12,
    color: theme.textDim,
    lineHeight: 17,
  },
  itemEffect: {
    fontSize: 11,
    color: theme.textGhost,
  },
});
