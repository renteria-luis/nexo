import { useRoute } from '@react-navigation/native';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { useAppData } from '../../shell/AppData.tsx';

import { Card } from '../Card.tsx';
import { Chip } from '../Chip.tsx';

import { font, sheet, shape } from '../theme.ts';

import { Screen } from './Screen.tsx';

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

function Item({ item, first }: { item: Recommendation; first: boolean }) {
  return (
    <View style={[styles.item, !first && styles.ruled]}>
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
    <Screen title="Recomendaciones">
      <Text style={styles.intro}>
        Propuestas para potenciar la hipertrofia con las máquinas de Fanshawe. Cambiar el programa
        durante la readaptación impide saber si un estancamiento vino del mes parado o de los
        cambios, así que esperan a que termine.
      </Text>

      <Card tone={readapting ? 'warn' : 'ok'}>
        <Text style={styles.state}>
          {readapting
            ? `Readaptación activa hasta el ${readapting.endsOn}. Todavía no se aplican.`
            : 'La readaptación no está activa: ya se pueden aplicar.'}
        </Text>
      </Card>

      {routineId !== null && (
        <View style={styles.chips}>
          <Chip
            label="Solo la de hoy"
            accessibilityLabel="Ver solo la rutina de hoy"
            selected={onlyToday}
            onPress={() => setOnlyToday(true)}
          />
          <Chip
            label="Todas"
            accessibilityLabel="Ver todas las rutinas"
            selected={!onlyToday}
            onPress={() => setOnlyToday(false)}
          />
        </View>
      )}

      <Card title="Cambios">
        {changes.map((item, index) => (
          <Item key={item.title} item={item} first={index === 0} />
        ))}
      </Card>

      <Card title="Lo que no cambiaría">
        {unchanged.map((item, index) => (
          <Item key={item.title} item={item} first={index === 0} />
        ))}
      </Card>
    </Screen>
  );
}

const styles = sheet((theme) => ({
  intro: {
    fontSize: 13,
    fontFamily: font.regular,
    color: theme.textFaint,
  },
  state: {
    fontSize: 13,
    fontFamily: font.bold,
    color: theme.accentInk,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  item: {
    gap: 3,
    paddingTop: 2,
  },
  ruled: {
    borderTopWidth: shape.border,
    borderTopColor: theme.line,
    paddingTop: 10,
  },
  itemTitle: {
    fontSize: 15,
    fontFamily: font.black,
    color: theme.text,
  },
  itemWhy: {
    fontSize: 13,
    fontFamily: font.regular,
    color: theme.textFaint,
  },
  itemEffect: {
    fontSize: 12,
    fontFamily: font.bold,
    color: theme.text,
  },
}));
