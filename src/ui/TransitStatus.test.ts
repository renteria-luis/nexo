import assert from 'node:assert/strict';
import { test } from 'node:test';

import { routeColor, routeInk } from './routeColors.ts';
import { nodes, renderModule, textOf } from './test-render.ts';

const ICONS = {
  Ban: 'Ban',
  Bus: 'Bus',
  ChevronDown: 'ChevronDown',
  ChevronUp: 'ChevronUp',
  CircleSlash: 'CircleSlash',
  Info: 'Info',
};

test('line colours keep LTC hue but deepen pastels, with ink that reads on them', () => {
  assert.equal(routeColor('2BB572'), '#0FBD69');
  assert.equal(routeColor('F89D53'), '#C45C08');
  assert.equal(routeColor('9F93A5'), '#695D6F', 'a grey line stays grey');
  assert.equal(routeColor(''), '#121212', 'a line without colour falls back to ink');
  assert.equal(routeInk('#C45C08'), '#FFFFFF');
  assert.equal(routeInk('#0FBD69'), '#121212');
});

test('each departure state is drawn with its own icons and named for VoiceOver', async () => {
  const labels = async (status: string) => {
    const screen = renderModule('src/ui/TransitStatus.tsx', { './icons.ts': ICONS }).mount(
      'StatusIcons',
      { live: { status } },
    );
    return nodes(await screen.settle())
      .map((node) => node.props?.accessibilityLabel)
      .filter(Boolean);
  };
  assert.deepEqual(await labels('live'), ['En vivo']);
  assert.deepEqual(await labels('unassigned'), ['En vivo', 'Sin bus asignado']);
  assert.deepEqual(await labels('schedule'), ['Sin datos en vivo']);
  assert.deepEqual(await labels('stale'), ['Sin datos en vivo']);
  assert.deepEqual(await labels('canceled'), ['Cancelado']);
  assert.deepEqual(await labels('skipped'), ['No para aquí']);
});

test('the legend stays folded until he opens it', async () => {
  const screen = renderModule('src/ui/TransitStatus.tsx', { './icons.ts': ICONS }).mount(
    'TransitLegend',
    {},
  );
  const folded = await screen.settle();
  assert.doesNotMatch(textOf(folded), /En vivo: LTC sigue al bus/);
  nodes(folded)
    .find((node) => node.props?.accessibilityLabel === 'Qué significan los íconos')!
    .props.onPress();
  assert.match(textOf(await screen.settle()), /En vivo: LTC sigue al bus/);
});

test('the route badge carries the number in the deepened line colour', async () => {
  const screen = renderModule('src/ui/TransitStatus.tsx', { './icons.ts': ICONS }).mount(
    'RouteBadge',
    { route: ['16', '16', 'Route 16', '2BB572'] },
  );
  const tree = await screen.settle();
  const badge = nodes(tree).find((node) => node.props?.accessibilityLabel === 'Línea 16')!;
  assert.equal(badge.props.style.at(-1).backgroundColor, '#0FBD69');
  assert.match(textOf(tree), /16/);
});
