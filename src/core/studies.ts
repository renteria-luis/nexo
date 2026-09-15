// Spec 12. The evidence that set the weights in spec 4.1, readable from inside the
// app, so a criterion that costs him points can be checked rather than believed.
//
// Ordered by spec section so the list reads in the order the spec argues it, and
// the section number is numeric after the dot: plain text ordering would put 12.10
// before 12.2.

import type { SQLiteDatabase } from 'expo-sqlite';

import type { CoreStudyRow } from '../db/types.ts';

import type { CriterionId } from './discipline.ts';

export type StudyTopic = {
  topic: string;
  specSection: string;
  studies: CoreStudyRow[];
};

export async function listStudies(db: SQLiteDatabase): Promise<CoreStudyRow[]> {
  return db.getAllAsync<CoreStudyRow>(
    `SELECT * FROM core_study
      ORDER BY CAST(substr(spec_section, 4) AS INTEGER), sort_order;`,
  );
}

export function groupByTopic(studies: readonly CoreStudyRow[]): StudyTopic[] {
  const topics: StudyTopic[] = [];
  for (const study of studies) {
    const current = topics.at(-1);
    if (current?.topic === study.topic) current.studies.push(study);
    else topics.push({ topic: study.topic, specSection: study.spec_section, studies: [study] });
  }
  return topics;
}

/** The studies behind one grid criterion, which is what makes a lost point auditable. */
export function studiesForCriterion(
  studies: readonly CoreStudyRow[],
  criterion: CriterionId,
): CoreStudyRow[] {
  return studies.filter((study) => study.criterion === criterion);
}
