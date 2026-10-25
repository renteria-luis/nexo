import { useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';

import { CRITERION_WEIGHTS, type CriterionId } from '../../core/discipline.ts';
import { groupByTopic, type StudyTopic } from '../../core/studies.ts';
import type { CoreStudyRow } from '../../db/types.ts';
import { useAppData } from '../../shell/AppData.tsx';

import { Button } from '../Button.tsx';
import { Card } from '../Card.tsx';
import { ExternalLink } from '../icons.ts';
import { font, sheet, shape } from '../theme.ts';

import { Screen } from './Screen.tsx';

const TOPIC_ES: Record<string, string> = {
  sleep: 'Sueño',
  alcohol: 'Alcohol',
  protein: 'Proteína',
  energy_availability: 'Disponibilidad de energía',
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

/**
 * "Calorías · 10 de 100 puntos": lo que sostiene en la nota y cuanto pesa. Bajo un titulo
 * que ya lo nombra ("Sueño"), solo los puntos.
 */
function weight(criterion: CriterionId, title?: string): string {
  const points = `${CRITERION_WEIGHTS[criterion]} de 100 puntos`;
  return CRITERION_ES[criterion] === title ? points : `${CRITERION_ES[criterion]} · ${points}`;
}

function Study({
  study,
  first,
  shared,
}: {
  study: CoreStudyRow;
  first: boolean;
  /** El criterio ya dicho arriba, una vez para todo el tema. */
  shared: boolean;
}) {
  const criterion = study.criterion as CriterionId | null;
  const link =
    study.open_access_url ?? (study.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${study.pmid}/` : null);

  return (
    <View style={[styles.study, !first && styles.ruled]}>
      <Text style={styles.summary}>{study.summary}</Text>
      <Text style={styles.title}>{study.title}</Text>
      {reference(study) !== '' && <Text style={styles.reference}>{reference(study)}</Text>}
      {criterion && !shared && <Text style={styles.criterion}>{weight(criterion)}</Text>}
      {link && (
        <Button
          label="Leerlo"
          accessibilityLabel={`Abrir el estudio ${study.id}`}
          variant="ghost"
          icon={ExternalLink}
          style={styles.link}
          onPress={() => {
            Linking.openURL(link).catch((error: unknown) => console.error(error));
          }}
        />
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
    <Screen title="Lecturas">
      <Text style={styles.intro}>
        Cada criterio de la nota pesa lo que pesa por estos estudios. Aquí está de dónde sale, para
        que se pueda revisar y no solo creer.
      </Text>

      {problem && <Text style={styles.problem}>{problem}</Text>}

      {topics?.map((topic) => {
        // Lo que sostiene y cuanto pesa, que es lo que lo ata a la nota y no a una lista
        // de lecturas sueltas. Una vez por tema cuando todos sostienen lo mismo: debajo de
        // cada estudio, Sueño lo decia cuatro veces seguidas.
        const title = TOPIC_ES[topic.topic] ?? topic.topic;
        const criteria = new Set(topic.studies.map((study) => study.criterion));
        const shared =
          criteria.size === 1 ? (topic.studies[0].criterion as CriterionId | null) : null;
        return (
          <Card key={topic.topic} title={title}>
            {shared && <Text style={styles.criterion}>{weight(shared, title)}</Text>}
            {topic.studies.map((study, index) => (
              <Study
                key={study.id}
                study={study}
                first={index === 0}
                shared={criteria.size === 1}
              />
            ))}
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = sheet((theme) => ({
  intro: {
    fontSize: 13,
    fontFamily: font.regular,
    color: theme.textFaint,
  },
  problem: {
    fontSize: 13,
    fontFamily: font.bold,
    color: theme.danger,
  },
  study: {
    gap: 4,
    paddingTop: 2,
  },
  ruled: {
    borderTopWidth: shape.border,
    borderTopColor: theme.line,
    paddingTop: 10,
  },
  summary: {
    fontSize: 14,
    fontFamily: font.bold,
    color: theme.text,
  },
  title: {
    fontSize: 12,
    fontFamily: font.regular,
    color: theme.textFaint,
  },
  reference: {
    fontSize: 11,
    fontFamily: font.regular,
    color: theme.textGhost,
  },
  criterion: {
    alignSelf: 'flex-start',
    fontSize: 11,
    fontFamily: font.black,
    // Sin ambar: no se toca, y el ambar es de lo que se toca (2026-10-23).
    color: theme.textDim,
    backgroundColor: theme.surfaceHigh,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
    marginTop: 2,
  },
  link: {
    alignSelf: 'flex-start',
    marginLeft: -8,
  },
}));
