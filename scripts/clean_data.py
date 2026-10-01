#!/usr/bin/env python3
"""Rebuild static visualization data. Python 3.9+, no third-party packages.

Keep the supplied CSV unchanged. Select the 50 states and DC; preserve blanks;
never infer missing measurements. Units are inferred from the transformed source,
not converted from NOAA's native tenths-of-degrees-C/mm format.
"""
import argparse
from collections import Counter
import csv
from datetime import datetime
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
US_STATES = set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split())
REQUIRED = {'station', 'state', 'latitude', 'longitude', 'date', 'TMIN', 'TMAX', 'PRCP'}


def number(value, field, invalid, nonnegative=False):
    if not value or not value.strip():
        return None
    try:
        result = float(value)
        if not math.isfinite(result) or (nonnegative and result < 0):
            raise ValueError
        return result
    except ValueError:
        invalid[field] += 1
        return None


def clean(source, output):
    excluded, invalid, missing = Counter(), Counter(), Counter()
    rows, stations = {}, {}
    input_rows = 0
    with source.open(newline='', encoding='utf-8-sig') as handle:
        reader = csv.DictReader(handle)
        absent = REQUIRED - set(reader.fieldnames or [])
        if absent:
            raise ValueError('Missing required columns: ' + ', '.join(sorted(absent)))
        for raw in reader:
            input_rows += 1
            state = raw['state'].strip().upper()
            if state not in US_STATES:
                excluded['outside_scope'] += 1
                continue
            try:
                value = raw['date'].strip()
                if len(value) != 8 or not value.isdigit():
                    raise ValueError
                date = datetime.strptime(value, '%Y%m%d').date()
                if date.year != 2017:
                    raise ValueError
            except ValueError:
                excluded['invalid_date'] += 1
                continue
            name = ' '.join(raw['station'].split())
            lat = number(raw['latitude'], 'latitude', invalid)
            lon = number(raw['longitude'], 'longitude', invalid)
            if not name or lat is None or lon is None or not -90 <= lat <= 90 or not -180 <= lon <= 180:
                excluded['invalid_location'] += 1
                continue
            identity = json.dumps([name, state, lat, lon], separators=(',', ':'))
            station_id = hashlib.sha256(identity.encode()).hexdigest()[:12]
            station = {'id': station_id, 'name': name, 'state': state, 'latitude': lat, 'longitude': lon}
            if station_id in stations and station != stations[station_id]:
                raise ValueError('Station identifier collision')
            stations[station_id] = station
            low = number(raw['TMIN'], 'TMIN', invalid)
            high = number(raw['TMAX'], 'TMAX', invalid)
            rain = number(raw['PRCP'], 'PRCP', invalid, nonnegative=True)
            if low is not None and high is not None and low > high:
                invalid['temperature_order'] += 1
                low = high = None
            row = {'station_id': station_id, 'date': date.isoformat(), 'tmin': low, 'tmax': high, 'prcp': rain}
            key = (station_id, date)
            if key in rows:
                excluded['duplicate_station_date'] += 1
                if row != rows[key]:
                    excluded['conflicting_duplicate'] += 1
                continue  # deterministic first occurrence wins; conflicts are reported
            rows[key] = row
            missing.update(k for k in ('tmin', 'tmax', 'prcp') if row[k] is None)
    if not rows:
        raise ValueError('No valid 2017 U.S. station rows remain; no outputs written.')
    ordered = sorted(rows.values(), key=lambda row: (row['station_id'], row['date']))
    dates = sorted({row['date'] for row in ordered})
    digest = hashlib.sha256()
    with source.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    report = {
        'input_rows': input_rows, 'output_rows': len(ordered), 'station_count': len(stations),
        'date_start': dates[0], 'date_end': dates[-1], 'distinct_dates': len(dates),
        'excluded': dict(sorted(excluded.items())), 'invalid_values': dict(sorted(invalid.items())),
        'missing_clean_values': dict(sorted(missing.items())),
        'scope': '50 U.S. states and DC; 2017 only',
        'units': {'tmin': 'Fahrenheit (inferred)', 'tmax': 'Fahrenheit (inferred)', 'prcp': 'inches (inferred)'},
        'unit_note': 'No source data dictionary was supplied. Values appear already converted to Fahrenheit and inches. No unit conversion applied.',
        'source_sha256': digest.hexdigest(),
    }
    output.mkdir(parents=True, exist_ok=True)
    with (output / 'weather_clean.csv').open('w', newline='', encoding='utf-8') as handle:
        writer = csv.DictWriter(handle, fieldnames=['station_id', 'date', 'tmin', 'tmax', 'prcp'], lineterminator='\n')
        writer.writeheader()
        for row in ordered:
            writer.writerow({k: (format(v, '.12g') if isinstance(v, float) else v) for k, v in row.items()})
    (output / 'stations.json').write_text(json.dumps(sorted(stations.values(), key=lambda s: (s['state'], s['name'], s['id'])), indent=2) + '\n')
    (output / 'cleaning_report.json').write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=ROOT / 'data/weather.csv')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'data')
    args = parser.parse_args()
    try:
        report = clean(args.input, args.output_dir)
    except (ValueError, OSError) as error:
        parser.exit(1, f'Cleaning failed: {error}\n')
    print(json.dumps(report, indent=2))
