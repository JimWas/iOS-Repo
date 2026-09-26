import json
import unittest

from traffic import format_row, parse_line, safe_path


class TrafficViewTests(unittest.TestCase):
    def test_web_request_redacts_query_and_download_token(self):
        entry = {
            'logger': 'http.log.access.log0', 'ts': 1780000000.0,
            'request': {
                'method': 'GET', 'uri': '/download/secret-ticket?token=also-secret',
                'remote_ip': '203.0.113.4', 'proto': 'HTTP/2.0', 'tls': {},
                'headers': {'User-Agent': ['Sileo/2.0']},
            },
            'status': 200, 'duration': 0.012, 'size': 1234,
        }
        row = format_row(parse_line(json.dumps(entry)), False)
        self.assertIn('/download/[redacted]', row)
        self.assertIn('HTTPS HTTP/2.0', row)
        self.assertIn('12ms', row)
        self.assertNotIn('secret-ticket', row)
        self.assertNotIn('also-secret', row)

    def test_license_event_shows_outcome_without_raw_identifier(self):
        entry = {
            'event': 'license_lease', 'status': 200, 'kind': 'not_started',
            'device': '91e8e715a9d0', 'start_trial': False, 'code_supplied': False,
        }
        row = format_row(parse_line(json.dumps(entry)), False)
        self.assertIn('not_started', row)
        self.assertIn('start_trial=false', row)
        self.assertIn('91e8e715a9d0', row)

    def test_unrelated_logs_are_ignored(self):
        self.assertIsNone(parse_line('JimWas commerce service ready'))
        self.assertIsNone(parse_line(json.dumps({'logger': 'tls.cache', 'msg': 'started'})))
        self.assertEqual(safe_path('/checkout/success?session_id=secret'), '/checkout/success')


if __name__ == '__main__':
    unittest.main()
