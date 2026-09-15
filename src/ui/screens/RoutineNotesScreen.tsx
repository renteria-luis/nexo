import { StyleSheet, Text, View } from 'react-native';

import { useAppData } from '../../shell/AppData.tsx';

import { Screen } from './Screen.tsx';

type Recommendation = {
  title: string;
  why: string;
  effect?: string;
};

// Written from the Fanshawe catalogue and the volume audit, and kept free of body
// measurements: this ships in the app bundle and the repository is public.
const CHANGES: Recommendation[] = [
  {
    title: 'Deltoide posterior en la NM537',
    why: 'Hace remo y deltoide posterior en la misma estación. Hoy el contractor invertido compite por la P156 con el contractor de pecho, y por eso queda para "si me da tiempo".',
    effect: '0 a 4 series por semana → 6 a 9',
  },
  {
    title: 'Quitar los aductores (C114)',
    why: 'La meta en pierna es fuerza y función, no tamaño. Son tres series por semana que no compran nada.',
    effect: '3 series por semana → 0',
  },
  {
    title: 'Laterales en la polea Matrix',
    why: 'La polea mantiene la tensión en todo el recorrido. Con mancuerna, abajo la carga sobre el deltoide es casi cero.',
    effect: '6 series por semana → 10 a 12',
  },
  {
    title: 'Antebrazo directo',
    why: 'Curl de muñeca con barra Z o paseos con mancuernas. No hay máquina de antebrazo en Fanshawe, pero sí el material.',
    effect: '0 series directas → 4 a 6',
  },
  {
    title: 'Pierna con otro carácter',
    why: 'Bisagra con barra, V-Squat, prensa a una pierna en la C403 y paseos. Un día de fuerza y función en vez de uno de máquinas de aislamiento.',
  },
  {
    title: 'Descansos de 2 minutos en contractor y laterales',
    why: 'Brazos y hombros son justo donde descansar más rinde más. Es el cambio más barato de todos.',
  },
  {
    title: 'Un curl menos',
    why: 'Fuera el predicador de la B158. Se quedan el curl inclinado, por el estiramiento, y el martillo, que también trabaja antebrazo.',
    effect: '20 a 24 series por semana → 14 a 18',
  },
];

const UNCHANGED: Recommendation[] = [
  {
    title: 'Pecho',
    why: 'Ya cubres inclinado con mancuernas, plano en la P140 y aperturas en la P156. Lo único que falta es declinado y Fanshawe no tiene estación para eso.',
  },
  {
    title: 'Espalda',
    why: 'Está dentro de la banda y la meta es estética, no tamaño. Hay D123, NM500 y NM537 disponibles, pero más volumen ahí no compra nada que hayas pedido.',
  },
  {
    title: 'Cardio',
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

      <Text style={styles.section}>Cambios</Text>
      {CHANGES.map((item) => (
        <Item key={item.title} item={item} />
      ))}

      <Text style={styles.section}>Lo que no cambiaría</Text>
      {UNCHANGED.map((item) => (
        <Item key={item.title} item={item} />
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: {
    fontSize: 13,
    color: '#444',
    lineHeight: 19,
  },
  blocked: {
    fontSize: 12,
    color: '#5a4a00',
    backgroundColor: '#fdf3d0',
    padding: 8,
    borderRadius: 6,
    overflow: 'hidden',
  },
  ready: {
    fontSize: 12,
    color: '#1f4d2a',
    backgroundColor: '#e3f1e6',
    padding: 8,
    borderRadius: 6,
    overflow: 'hidden',
  },
  section: {
    fontSize: 14,
    marginTop: 8,
  },
  item: {
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingTop: 8,
    gap: 3,
  },
  itemTitle: {
    fontSize: 13,
  },
  itemWhy: {
    fontSize: 12,
    color: '#555',
    lineHeight: 17,
  },
  itemEffect: {
    fontSize: 11,
    color: '#888',
  },
});
