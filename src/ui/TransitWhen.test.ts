import assert from 'node:assert/strict';
import { test } from 'node:test';

import { nodes, renderModule, textOf } from './test-render.ts';

const mocks = {
  './icons.ts': {
    CalendarClock: 'CalendarClock',
    ChevronDown: 'ChevronDown',
    ChevronLeft: 'ChevronLeft',
    ChevronRight: 'ChevronRight',
    ChevronUp: 'ChevronUp',
    LoaderCircle: 'LoaderCircle',
  },
  './TextField.tsx': { TextField: 'TextField' },
};

test('one line when closed; open, it picks a valid day, steps the hour and applies', async () => {
  const calls: unknown[][] = [];
  let applied = 0;
  const screen = renderModule('src/ui/TransitWhen.tsx', mocks).mount('TransitWhen', {
    live: true,
    date: '2026-10-11',
    clock: '18:52',
    today: '2026-10-11',
    validFrom: '2026-09-28',
    validTo: '2026-11-28',
    onDate: (date: string) => calls.push(['date', date]),
    onClock: (clock: string) => calls.push(['clock', clock]),
    onApply: () => {
      applied++;
      return true;
    },
    onNow: () => calls.push(['now']),
  });
  const closed = await screen.settle();
  assert.match(textOf(closed), /Ahora · en vivo/);
  assert.equal(nodes(closed).filter((n) => n.props?.accessibilityLabel === 'dom 11-oct').length, 0);
  const find = (tree: unknown, label: string) =>
    nodes(tree).find((n) => n.props?.accessibilityLabel === label)!;
  find(closed, 'Elegir día y hora de las salidas').props.onPress();
  const open = await screen.settle();
  assert.match(textOf(open), /Oct 2026/);
  find(open, 'mar 13-oct').props.onPress();
  find(open, 'Quince minutos después').props.onPress();
  find(open, 'Quince minutos antes').props.onPress();
  assert.deepEqual(calls, [
    ['date', '2026-10-13'],
    ['clock', '19:07'],
    ['clock', '18:37'],
  ]);
  assert.equal(find(open, 'lun 28-sep'), undefined, 'only the shown month has day buttons');
  nodes(open)
    .find((n) => n.props?.accessibilityLabel === 'Ver horarios')!
    .props.onPress();
  assert.equal(applied, 1);
});
