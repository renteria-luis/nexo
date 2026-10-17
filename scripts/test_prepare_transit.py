import csv
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from datetime import datetime, timezone
import zipfile

spec = importlib.util.spec_from_file_location('prepare_transit', Path(__file__).with_name('prepare-transit.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fixture(change=None):
    tables = {
        'agency.txt': [['agency_name', 'agency_timezone'], ['London Transit', 'America/Toronto']],
        'feed_info.txt': [['feed_start_date', 'feed_end_date', 'feed_version'], ['20260101', '20261231', 'fixture']],
        'stops.txt': [['stop_id', 'stop_name', 'stop_lat', 'stop_lon'], ['A', 'Road NB', '43', '-81'], ['B', 'Road SB', '43.01', '-81.01']],
        'routes.txt': [['route_id', 'route_short_name', 'route_long_name', 'route_color'], ['02', '02', 'Route 2', '75aaae']],
        'trips.txt': [['trip_id', 'route_id', 'service_id', 'trip_headsign', 'shape_id'], ['T', '02', 'special', '2A Downtown', 'S']],
        'calendar_dates.txt': [['service_id', 'date', 'exception_type'], ['special', '20261011', '1']],
        'stop_times.txt': [['trip_id', 'stop_id', 'stop_sequence', 'arrival_time', 'departure_time', 'pickup_type', 'drop_off_type'],
                           ['T', 'A', '1', '25:00:00', '25:00:00', '0', '1'], ['T', 'B', '2', '25:10:00', '25:11:00', '1', '0']],
        'shapes.txt': [['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence'], ['S', '43', '-81', '1'], ['S', '43.01', '-81.01', '2']],
    }
    if change:
        change(tables)
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w') as archive:
        for name, rows in tables.items():
            text = io.StringIO()
            csv.writer(text).writerows(rows)
            archive.writestr(zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0)), text.getvalue())
    return stream.getvalue()


class PreparationTests(unittest.TestCase):
    def test_calendar_dates_only_after_midnight_and_restrictions(self):
        package = module.prepare(fixture(), 1)
        self.assertEqual(package['trips'][0][7], 25 * 3600)
        self.assertEqual(package['routes'][0][0], '02')
        self.assertEqual(package['routes'][0][3], '75AAAE')
        self.assertEqual(package['services'], [])
        self.assertEqual(package['exceptions'], [['special', '2026-10-11', 1]])
        self.assertEqual(package['patterns'][0][1][4:6], [1, 0])

    def test_broken_csv_ids_coordinates_dates_and_times(self):
        changes = [
            lambda t: t.pop('stops.txt'),
            lambda t: t['stops.txt'][0].remove('stop_lat'),
            lambda t: t['stop_times.txt'][1].__setitem__(1, 'unknown'),
            lambda t: t['stops.txt'][1].__setitem__(2, '91'),
            lambda t: t['feed_info.txt'][1].__setitem__(1, '20260230'),
            lambda t: t['stop_times.txt'][2].__setitem__(3, '25:99:00'),
            lambda t: t['stop_times.txt'][2].__setitem__(2, '1'),
            lambda t: t['trips.txt'][1].__setitem__(2, 'unknown'),
        ]
        for change in changes:
            with self.subTest(change=change), self.assertRaises((ValueError, KeyError)):
                module.prepare(fixture(change), 1)
        with self.assertRaises(ValueError):
            module.prepare(fixture(lambda t: t['routes.txt'][1].__setitem__(3, 'green')), 1)
        with self.assertRaises(zipfile.BadZipFile):
            module.prepare(b'broken zip', 1)

    def test_publish_preserves_previous_files_on_failure_and_skips_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            now = datetime(2026, 10, 11, tzinfo=timezone.utc)
            self.assertTrue(module.publish(fixture(), target, now))
            before = {p.name: p.read_bytes() for p in target.iterdir()}
            self.assertFalse(module.publish(fixture(), target, now))
            older = json.loads((target / 'manifest.json').read_text())
            older['schema'] = 1
            (target / 'manifest.json').write_text(json.dumps(older))
            self.assertTrue(module.publish(fixture(), target, now), 'a new package format republishes the same feed')
            before = {p.name: p.read_bytes() for p in target.iterdir()}
            with self.assertRaises(zipfile.BadZipFile):
                module.publish(b'bad', target, now)
            self.assertEqual({p.name: p.read_bytes() for p in target.iterdir()}, before)
            with self.assertRaises(ValueError):
                module.publish(fixture(), target, datetime(2027, 1, 1, tzinfo=timezone.utc))
            self.assertEqual({p.name: p.read_bytes() for p in target.iterdir()}, before)
            manifest = json.loads(before['manifest.json'])
            self.assertEqual(manifest['bytes'], len(before['schedule.json']))

    def test_publish_keeps_the_current_feed_until_the_next_one_starts(self):
        def later(tables):
            tables['feed_info.txt'][1] = ['20261019', '20261128', 'next']
            tables['calendar_dates.txt'][1][1] = '20261020'
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            self.assertTrue(module.publish(fixture(), target, datetime(2026, 10, 11, tzinfo=timezone.utc)))
            before = {p.name: p.read_bytes() for p in target.iterdir()}
            # 02:00 UTC on the 19th is still the 18th in Toronto.
            for now in [datetime(2026, 10, 17, 13, tzinfo=timezone.utc), datetime(2026, 10, 19, 2, tzinfo=timezone.utc)]:
                self.assertFalse(module.publish(fixture(later), target, now))
                self.assertEqual({p.name: p.read_bytes() for p in target.iterdir()}, before)
            self.assertTrue(module.publish(fixture(later), target, datetime(2026, 10, 19, 5, 17, tzinfo=timezone.utc)))
            self.assertEqual(json.loads((target / 'manifest.json').read_text())['validFrom'], '2026-10-19')


if __name__ == '__main__':
    unittest.main()
