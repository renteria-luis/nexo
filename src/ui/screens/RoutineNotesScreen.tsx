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
    title: 'Elevaciones laterales: cuál usar',
    routines: ['push', 'pull', 'legs'],
    why: 'Por orden, cuando hay de dónde elegir. 1) Máquina sentado, la IPDR3 de Fit4Less: tensión pareja en todo el recorrido, cero impulso de cadera, y puedes llegar al fallo sin miedo. 2) Polea a un brazo: mismo perfil, y es la única opción con tensión abajo en Fanshawe, pero cuesta el doble de reloj. 3) Mancuernas sentado: te quita la trampa de la cadera. 4) Mancuernas de pie: la que siempre hay. Un estudio de 2025 midió mancuerna contra polea igualando el recorrido y el deltoide creció igual, así que el orden importa menos que hacer el recorrido completo y sin impulso.',
    effect:
      'el plan pide polea en push y mancuernas en pull, para que hagas dos variantes en la semana',
  },
  {
    title: 'Deltoide posterior dos veces por semana',
    routines: ['push', 'pull'],
    why: 'Ya aplicado. Estaba en tier 4, o sea que era lo primero que se borraba al recortar tiempo, y se quedaba en 6 series. Ahora está en tier 2 en pull y entra también en push, en la misma máquina donde ya haces el contractor: en Fanshawe la P156 hace las dos cosas, en Fit4Less el contractor también. Es un cambio de pin, no de estación.',
    effect: '6 series por semana → 12',
  },
  {
    title: 'Hombro lateral, de mínimo a prioridad',
    routines: ['push', 'pull', 'legs'],
    why: 'Ya aplicado. Es tu prioridad número uno y estaba en 9 series, justo en el suelo de la banda útil. Los presses de pecho no lo entrenan: alimentan el deltoide frontal, que es el que menos hace por verse redondo. Subió a 4 series en push y entró en pull, así que ahora lo tocas cuatro veces por semana.',
    effect: '9 series por semana → 17',
  },
  {
    title: 'Antebrazo directo',
    routines: ['pull'],
    why: 'Ya aplicado. Curl inverso con barra Z, 3 series de 12 a 15 en el día de pull. Va por el braquiorradial, que es el músculo que engrosa el antebrazo visto de fuera, y de paso trabaja el braquial, que empuja el bíceps hacia arriba. Antes solo recibía lo que caía de las dominadas y el martillo, que mantiene pero no construye.',
    effect: '0 series directas → 6',
  },
  {
    title: 'Espalda: más remo, menos vertical',
    routines: ['pull'],
    why: 'Ya aplicado. Las dominadas bajan a 3 y el remo sube a 4. El total de espalda no cambia, cambia hacia dónde apunta: lo vertical hace ancho, que ya tienes, y lo horizontal más el deltoide posterior es lo que hace que se vea rocosa. En las dominadas asistidas usa el agarre pronado: el dorsal se activa igual con cualquier agarre, pero el pronado da más trapecio medio, que es el detalle que buscas, y más braquial.',
    effect: '4 dominadas y 3 remos → 3 y 4',
  },
  {
    title: 'Un curl menos',
    routines: ['pull'],
    why: 'Ya aplicado. Fuera el predicador. Se quedan el curl inclinado, por el estiramiento, y el martillo, que también trabaja antebrazo. El predicador sigue en el catálogo: sirve para cambiarlo por el inclinado el día que quieras variar, no para sumarlo.',
    effect: '18 series directas de bíceps por semana → 12',
  },
  {
    title: 'El pecho paga el hombro',
    routines: ['push'],
    why: 'Ya aplicado. Tenías 20 series semanales de pecho, más que ningún otro músculo, siendo tu segunda prioridad. El contractor baja de 4 a 3 y el press sentado de 3 a 2; esas tres series se fueron al hombro. 16 sigue estando dentro de la banda.',
    effect: '20 series por semana → 16',
  },
  {
    title: 'Pierna con otro carácter',
    routines: ['legs'],
    why: 'Sin aplicar. Bisagra con barra, V-Squat, prensa a una pierna en la C403 y paseos. Un día de fuerza y función en vez de uno de máquinas de aislamiento.',
  },
  {
    title: 'Descansos de 2 minutos en contractor y laterales',
    routines: ['push'],
    why: 'Sin aplicar. Brazos y hombros son justo donde descansar más rinde más. Es el cambio más barato de todos.',
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
    title: 'Aductores',
    routines: ['legs'],
    why: 'Los quieres y son tres series una vez por semana. No pelean con nada más del programa.',
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
