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
  assert.equal(
    nodes(closed).filter((n) => n.props?.accessibilityLabel === 'dom, 11-oct').length,
    0,
  );
  const find = (tree: unknown, label: string) =>
    nodes(tree).find((n) => n.props?.accessibilityLabel === label)!;
  find(closed, 'Elegir día y hora de las salidas').props.onPress();
  const open = await screen.settle();
  // Sunday the 11th: today first, then the Monday and the rest of the next week.
  assert.ok(find(open, 'lun, 12-oct'), 'on Sunday the strip reaches the next Monday');
  assert.ok(find(open, 'sáb, 17-oct'));
  assert.equal(find(open, 'dom, 18-oct'), undefined, 'seven days, not a month');
  assert.equal(find(open, 'lun, 28-sep'), undefined, 'nothing before today');
  assert.match(textOf(open), /hoy11lun12/);
  find(open, 'mar, 13-oct').props.onPress();
  find(open, 'Quince minutos después').props.onPress();
  find(open, 'Quince minutos antes').props.onPress();
  assert.deepEqual(calls, [
    ['date', '2026-10-13'],
    ['clock', '19:07'],
    ['clock', '18:37'],
  ]);
  find(open, 'Días siguientes').props.onPress();
  const later = await screen.settle();
  assert.ok(find(later, 'dom, 18-oct'), 'the next seven days');
  assert.equal(find(later, 'sáb, 17-oct'), undefined);
  nodes(later)
    .find((n) => n.props?.accessibilityLabel === 'Ver horarios')!
    .props.onPress();
  assert.equal(applied, 1);
});
