"""Boundary tests for the real CSV-to-artifact pipeline (standard library only)."""
import csv
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'clean_data.py'
FIELDS = ['station', 'state', 'latitude', 'longitude', 'date', 'TMIN', 'TMAX', 'PRCP']


class CleaningTests(unittest.TestCase):
    def run_cleaner(self, rows):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'weather.csv'
            with source.open('w', newline='') as handle:
                writer = csv.DictWriter(handle, fieldnames=FIELDS)
                writer.writeheader()
                writer.writerows(rows)
            result = subprocess.run([sys.executable, str(SCRIPT), '--input', str(source),
                                     '--output-dir', str(root / 'out')], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            with (root / 'out/weather_clean.csv').open() as handle:
                cleaned = list(csv.DictReader(handle))
            return cleaned, json.loads((root / 'out/cleaning_report.json').read_text())

    def row(self, **changes):
        return dict(station='TEST STATION', state='MD', latitude='39', longitude='-76',
                    date='20170101', TMIN='32', TMAX='50', PRCP='0') | changes

    def test_missing_is_not_zero_and_bad_values_are_flagged(self):
        rows, report = self.run_cleaner([
            self.row(TMIN='', TMAX='NaN', PRCP='-1'),
            self.row(date='20170102', TMIN='60', TMAX='40', PRCP='0'),
        ])
        self.assertEqual(len(rows), 2)
        self.assertEqual([r['tmin'] for r in rows], ['', ''])
        self.assertEqual([r['tmax'] for r in rows], ['', ''])
        self.assertEqual([r['prcp'] for r in rows], ['', '0'])
        self.assertEqual(report['invalid_values']['temperature_order'], 1)

    def test_scope_duplicates_sorting_and_dates(self):
        rows, report = self.run_cleaner([
            self.row(date='20170202'), self.row(), self.row(),
            self.row(state='ON'), self.row(date='20170230'), self.row(latitude='bad'),
        ])
        self.assertEqual([r['date'] for r in rows], ['2017-01-01', '2017-02-02'])
        self.assertEqual(report['input_rows'], 6)
        self.assertEqual(report['excluded']['outside_scope'], 1)
        self.assertEqual(report['excluded']['invalid_date'], 1)
        self.assertEqual(report['excluded']['invalid_location'], 1)
        self.assertEqual(report['excluded']['duplicate_station_date'], 1)

    def test_same_name_different_coordinates_stays_separate(self):
        rows, report = self.run_cleaner([self.row(), self.row(latitude='40')])
        self.assertNotEqual(rows[0]['station_id'], rows[1]['station_id'])
        self.assertEqual(report['station_count'], 2)


if __name__ == '__main__':
    unittest.main()
