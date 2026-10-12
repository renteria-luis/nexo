#!/usr/bin/env python3
"""Prepare LTC's public schedule with only Python's standard library."""

import argparse
import csv
import hashlib
import io
import json
import math
import os
from pathlib import Path
import tempfile
from datetime import date, datetime, timezone
import urllib.request
import zipfile

SOURCE = 'https://www.londontransit.ca/gtfsfeed/google_transit.zip'
MAX_ZIP_BYTES = 15_000_000
MAX_EXPANDED_BYTES = 150_000_000


def iso(value):
    return datetime.strptime(value.strip(), '%Y%m%d').date().isoformat()


def seconds(value):
    parts = value.strip().split(':')
    if len(parts) != 3 or not all(p.isdigit() for p in parts):
        raise ValueError(f'Invalid GTFS time: {value}')
    h, m, s = map(int, parts)
    if h > 71 or m > 59 or s > 59:
        raise ValueError(f'Invalid GTFS time: {value}')
    return h * 3600 + m * 60 + s


def coordinate(value, limit):
    number = float(value)
    if not math.isfinite(number) or abs(number) > limit:
        raise ValueError(f'Invalid coordinate: {value}')
    return number


def enum(value, allowed, default=0):
    number = int(value) if value.strip() else default
    if number not in allowed:
        raise ValueError(f'Invalid enum: {value}')
    return number


def unique(rows, key):
    ids = [r[key] for r in rows]
    if any(not i for i in ids) or len(set(ids)) != len(ids):
        raise ValueError(f'Empty or duplicate {key}')
    return {value: index for index, value in enumerate(ids)}


def prepare(raw, created_at):
    if len(raw) > MAX_ZIP_BYTES:
        raise ValueError('Schedule ZIP exceeds the size limit')
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        if sum(i.file_size for i in archive.infolist()) > MAX_EXPANDED_BYTES:
            raise ValueError('Expanded schedule exceeds the size limit')

        def read(name, fields, optional=False):
            if optional and name not in archive.namelist():
                return []
            with archive.open(name) as stream:
                reader = csv.DictReader(io.TextIOWrapper(stream, encoding='utf-8-sig'))
                if not set(fields).issubset(reader.fieldnames or []):
                    raise ValueError(f'{name}: required fields are missing')
                result = list(reader)
                if any(None in r or any(v is None for v in r.values()) for r in result):
                    raise ValueError(f'{name}: incomplete CSV row')
                return result

        agencies = read('agency.txt', ['agency_name', 'agency_timezone'])
        if not agencies or any(a['agency_timezone'] != 'America/Toronto' for a in agencies):
            raise ValueError('Unsupported agency timezone')
        feeds = read('feed_info.txt', ['feed_start_date', 'feed_end_date', 'feed_version'])
        if len(feeds) != 1:
            raise ValueError('Expected one feed_info record')
        feed = feeds[0]
        start, end = iso(feed['feed_start_date']), iso(feed['feed_end_date'])
        if start > end:
            raise ValueError('Reversed validity interval')
        stops = read('stops.txt', ['stop_id', 'stop_name', 'stop_lat', 'stop_lon'])
        routes = read('routes.txt', ['route_id', 'route_short_name', 'route_long_name'])
        trips = read('trips.txt', ['trip_id', 'route_id', 'service_id', 'trip_headsign'])
        stop_ids, route_ids = unique(stops, 'stop_id'), unique(routes, 'route_id')
        trip_ids = unique(trips, 'trip_id')
        if not stops or not routes or not trips:
            raise ValueError('Empty schedule')
        weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
        calendars = read('calendar.txt', ['service_id', 'start_date', 'end_date'] + weekdays, True)
        unique(calendars, 'service_id')
        services = []
        for c in calendars:
            a, b = iso(c['start_date']), iso(c['end_date'])
            if a > b:
                raise ValueError('Reversed service interval')
            mask = sum(enum(c[day], [0, 1]) << i for i, day in enumerate(weekdays))
            services.append([c['service_id'], mask, a, b])
        exceptions = [[r['service_id'], iso(r['date']), enum(r['exception_type'], [1, 2])]
                      for r in read('calendar_dates.txt', ['service_id', 'date', 'exception_type'], True)]
        exception_keys = [(e[0], e[1]) for e in exceptions]
        if len(set(exception_keys)) != len(exception_keys):
            raise ValueError('Duplicate service exception')
        service_ids = {s[0] for s in services} | {e[0] for e in exceptions if e[2] == 1}
        if not service_ids or any(e[0] not in service_ids for e in exceptions):
            raise ValueError('Unknown service exception')
        shapes = {}
        for r in read('shapes.txt', ['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence']):
            shapes.setdefault(r['shape_id'], []).append([
                coordinate(r['shape_pt_lat'], 90), coordinate(r['shape_pt_lon'], 180),
                int(r['shape_pt_sequence'])])
        for points in shapes.values():
            points.sort(key=lambda p: p[2])
            if any(p[2] < 0 or p[2] > 100_000 for p in points) or any(a[2] >= b[2] for a, b in zip(points, points[1:])):
                raise ValueError('Duplicate shape sequence')
        times = {t: [] for t in trip_ids}
        for r in read('stop_times.txt', ['trip_id', 'stop_id', 'stop_sequence', 'arrival_time', 'departure_time']):
            times[r['trip_id']].append([
                stop_ids[r['stop_id']], int(r['stop_sequence']),
                seconds(r['arrival_time']), seconds(r['departure_time']),
                enum(r.get('pickup_type', ''), range(4)), enum(r.get('drop_off_type', ''), range(4)),
                enum(r.get('timepoint', ''), [0, 1], 1), r.get('stop_headsign', '')])
        patterns, pattern_ids, compact_trips = [], {}, []
        for trip in trips:
            rows = sorted(times[trip['trip_id']], key=lambda r: r[1])
            if len(rows) < 2:
                raise ValueError('Trip without a complete stop sequence')
            previous_sequence, previous_departure = -1, -1
            for r in rows:
                if r[1] <= previous_sequence or r[2] < previous_departure or r[3] < r[2]:
                    raise ValueError('Unordered stop sequence/time')
                previous_sequence, previous_departure = r[1], r[3]
            first = rows[0][2]
            pattern = [[r[0], r[1], r[2] - first, r[3] - first, *r[4:]] for r in rows]
            key = json.dumps(pattern, separators=(',', ':'))
            if key not in pattern_ids:
                pattern_ids[key] = len(patterns)
                patterns.append(pattern)
            service = trip['service_id']
            shape = trip.get('shape_id', '')
            if service not in service_ids or (shape and shape not in shapes):
                raise ValueError('Trip refers to unknown service/shape')
            compact_trips.append([trip['trip_id'], route_ids[trip['route_id']], service,
                                  trip['trip_headsign'], enum(trip.get('direction_id', ''), [0, 1], -1)
                                  if trip.get('direction_id', '') else None,
                                  shape, pattern_ids[key], first])
        transfers = []
        for r in read('transfers.txt', ['from_stop_id', 'to_stop_id'], True):
            kind = enum(r.get('transfer_type', ''), range(4))
            minimum = int(r['min_transfer_time']) if r.get('min_transfer_time') else None
            if (minimum is not None and minimum < 0) or (kind == 2 and minimum is None):
                raise ValueError('Invalid minimum transfer time')
            transfers.append([stop_ids[r['from_stop_id']], stop_ids[r['to_stop_id']], kind, minimum])
        return dict(schema=2, source=SOURCE, sourceSha256=hashlib.sha256(raw).hexdigest(),
                    createdAt=created_at, feedVersion=feed['feed_version'], timezone='America/Toronto',
                    validFrom=start, validTo=end,
                    stops=[[r['stop_id'], r.get('stop_code', ''), r['stop_name'],
                            coordinate(r['stop_lat'], 90), coordinate(r['stop_lon'], 180)] for r in stops],
                    routes=[[r['route_id'], r['route_short_name'], r['route_long_name'], color(r.get('route_color', ''))]
                            for r in routes],
                    services=services, exceptions=exceptions, patterns=patterns, trips=compact_trips,
                    shapes=shapes, transfers=transfers)


def color(value):
    # LTC paints each line with routes.txt's route_color; a missing one leaves the app's default.
    if value and not (len(value) == 6 and all(c in '0123456789abcdefABCDEF' for c in value)):
        raise ValueError('Invalid route colour')
    return value.upper()


def publish(raw, output, now):
    # Both files are published in one Git commit; the client also checks the content hash.
    package = prepare(raw, int(now.timestamp() * 1000))
    if package['validTo'] < now.date().isoformat():
        raise ValueError('Official schedule has expired; retaining previous artifact')
    manifest_path = output / 'manifest.json'
    if manifest_path.exists():
        old = json.loads(manifest_path.read_text())
        current = output / 'schedule.json'
        if (old.get('schema') == package['schema'] and old.get('sourceSha256') == package['sourceSha256'] and current.exists()
                and hashlib.sha256(current.read_bytes()).hexdigest() == old.get('sha256')):
            print('Official schedule unchanged; no publication needed')
            return False
    data = json.dumps(package, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()
    if len(data) > 12_000_000:
        raise ValueError('Compact schedule exceeds the client size limit')
    manifest = {k: package[k] for k in ['schema', 'sourceSha256', 'createdAt', 'feedVersion',
                                      'timezone', 'validFrom', 'validTo']}
    manifest.update(sha256=hashlib.sha256(data).hexdigest(), bytes=len(data), file='schedule.json')
    output.mkdir(parents=True, exist_ok=True)
    for name, content in [('schedule.json', data), ('manifest.json', (json.dumps(manifest, indent=2) + '\n').encode())]:
        with tempfile.NamedTemporaryFile(dir=output, delete=False) as temp:
            temp.write(content)
            temporary = temp.name
        os.replace(temporary, output / name)
    print(f"Prepared {len(data):,} bytes; {len(package['stops'])} stops, "
          f"{len(package['trips'])} trips, {len(package['patterns'])} patterns; "
          f"valid {package['validFrom']} through {package['validTo']}")
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--zip', type=Path, help='Use a previously downloaded official ZIP')
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'transit')
    args = parser.parse_args()
    if args.zip:
        raw = args.zip.read_bytes()
    else:
        with urllib.request.urlopen(SOURCE, timeout=45) as response:
            raw = response.read(MAX_ZIP_BYTES + 1)
    publish(raw, args.output, datetime.now(timezone.utc))


if __name__ == '__main__':
    main()
