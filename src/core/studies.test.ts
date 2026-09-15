import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { SQLiteDatabase } from 'expo-sqlite';

import { migrations } from '../db/migrations/index.ts';

import { CRITERION_WEIGHTS } from './discipline.ts';
import { groupByTopic, listStudies, studiesForCriterion } from './studies.ts';

function fresh(): SQLiteDatabase {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  for (const migration of migrations) raw.exec(migration.sql);
  return {
    getAllAsync: async <T>(source: string, params: unknown[] = []): Promise<T[]> =>
      raw.prepare(source).all(...(params as [])) as T[],
  } as unknown as SQLiteDatabase;
}

test('the readings run in the order spec 12 argues them', async () => {
  const studies = await listStudies(fresh());
  const topics = groupByTopic(studies);

  assert.equal(topics[0].topic, 'sleep');
  assert.equal(topics.at(-1)?.topic, 'habit');
  // 12.10 after 12.9, which plain text ordering would get wrong.
  assert.deepEqual(
    topics.map((topic) => topic.specSection),
    [
      '12.1',
      '12.2',
      '12.3',
      '12.4',
      '12.5',
      '12.6',
      '12.7',
      '12.8',
      '12.9',
      '12.10',
      '12.11',
      '12.12',
    ],
  );
});

test('every criterion a study claims is a criterion that exists', async () => {
  const studies = await listStudies(fresh());

  for (const study of studies) {
    if (study.criterion === null) continue;
    assert.ok(study.criterion in CRITERION_WEIGHTS, `${study.id} claims ${study.criterion}`);
  }

  assert.equal(studiesForCriterion(studies, 'sleep').length, 4);
  assert.equal(studiesForCriterion(studies, 'protein').length, 1);
  // Cannabis is logged and never scored (spec 4.1), so its evidence backs no criterion.
  assert.ok(
    studies.filter((study) => study.topic === 'cannabis').every((s) => s.criterion === null),
  );
});

test('every study says something in its own words', async () => {
  const studies = await listStudies(fresh());
  assert.ok(studies.length >= 20);
  for (const study of studies) {
    assert.ok(study.summary.length > 40, `${study.id} has no summary`);
    assert.ok(study.title.length > 0);
  }
});
