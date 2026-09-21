import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { CRITERION_WEIGHTS, type CriterionId } from '../../core/discipline.ts';
import { groupByTopic, type StudyTopic } from '../../core/studies.ts';
import type { CoreStudyRow } from '../../db/types.ts';
import { useAppData } from '../../shell/AppData.tsx';

import { Screen } from './Screen.tsx';
import { mono, theme } from '../theme.ts';

const TOPIC_ES: Record<string, string> = {
  sleep: 'Sueño',
  alcohol: 'Alcohol',
  protein: 'Proteína',
  fat_testosterone: 'Grasa y testosterona',
  volume: 'Volumen de entrenamiento',
  rest: 'Descanso entre series',
  spot_reduction: 'Reducción localizada',
  creatine: 'Creatina',
  skin: 'Piel y acné',
  hydration: 'Agua',
  cannabis: 'Cannabis',
  habit: 'Hábitos',
};

const CRITERION_ES: Record<CriterionId, string> = {
  trained: 'Entrenar',
  sleep: 'Sueño',
  protein: 'Proteína',
  calories: 'Calorías',
  alcohol: 'Alcohol',
  water: 'Agua',
  steps: 'Pasos',
  creatine: 'Creatina',
};

function reference(study: CoreStudyRow): string {
  return [study.authors, study.year, study.journal].filter(Boolean).join(' · ');
}

function Study({ study }: { study: CoreStudyRow }) {
  const criterion = study.criterion as CriterionId | null;
  const link =
    study.open_access_url ?? (study.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${study.pmid}/` : null);

  return (
    <View style={styles.study}>
      <Text style={styles.summary}>{study.summary}</Text>
      <Text style={styles.title}>{study.title}</Text>
      {reference(study) !== '' && <Text style={styles.reference}>{reference(study)}</Text>}
      {criterion && (
        <Text style={styles.criterion}>
          Sostiene el criterio {CRITERION_ES[criterion]}, {CRITERION_WEIGHTS[criterion]} de 100
          puntos de la nota
        </Text>
      )}
      {link && (
        <Pressable
          accessibilityLabel={`Abrir el estudio ${study.id}`}
          onPress={() => {
            Linking.openURL(link).catch((error: unknown) => console.error(error));
          }}
          style={styles.link}
        >
          <Text style={styles.linkText}>Leerlo ›</Text>
        </Pressable>
      )}
    </View>
  );
}

/**
 * Spec 12. Only what is free to read: no paywalled copies travel in the bundle, so
 * a study without an open version shows its reference and nothing to tap.
 */
export function ReadingsScreen() {
  const { loadStudies } = useAppData();
  const [topics, setTopics] = useState<StudyTopic[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadStudies()
      .then((studies) => {
        if (!cancelled) setTopics(groupByTopic(studies));
      })
      .catch((error: unknown) => {
        console.error(error);
        if (!cancelled) setProblem(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [loadStudies]);

  return (
    <Screen>
      <Text style={styles.intro}>
        Cada criterio de la nota pesa lo que pesa por estos estudios. Aquí está de dónde sale, para
        que se pueda revisar y no solo creer.
      </Text>

      {problem && <Text style={styles.problem}>{problem}</Text>}

      {topics?.map((topic) => (
        <View key={topic.topic} style={styles.topic}>
          <Text style={styles.topicName}>{TOPIC_ES[topic.topic] ?? topic.topic}</Text>
          {topic.studies.map((study) => (
            <Study key={study.id} study={study} />
          ))}
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: {
    fontSize: 12,
    color: theme.textFaint,
  },
  problem: {
    fontSize: 12,
    color: theme.danger,
  },
  topic: {
    gap: 8,
    marginTop: 14,
  },
  topicName: {
    fontSize: 14,
    fontFamily: mono,
    color: theme.text,
  },
  study: {
    borderTopWidth: 1,
    borderTopColor: theme.line,
    paddingTop: 8,
    gap: 3,
  },
  summary: {
    fontSize: 13,
    fontFamily: mono,
    color: theme.text,
  },
  title: {
    fontSize: 11,
    color: theme.textFaint,
    fontFamily: mono,
  },
  reference: {
    fontSize: 11,
    color: theme.textGhost,
    fontFamily: mono,
  },
  criterion: {
    fontSize: 11,
    color: theme.ok,
    fontFamily: mono,
  },
  link: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  linkText: {
    fontSize: 12,
    color: theme.textDim,
    fontFamily: mono,
  },
});
