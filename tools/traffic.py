#!/usr/bin/env python3
"""Readable, secret-safe live traffic view for the JimWas Repo VPS."""

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime
from urllib.parse import urlsplit

ROOT = os.path.expanduser('~/jimwas-repo')
COLORS = {
    'reset': '\033[0m', 'dim': '\033[2m', 'bold': '\033[1m',
    'green': '\033[92m', 'cyan': '\033[96m', 'yellow': '\033[93m',
    'red': '\033[91m', 'magenta': '\033[95m', 'blue': '\033[94m',
}


def safe_path(uri):
    """Discard query strings and path segments that can contain bearer tokens."""
    path = urlsplit(uri or '/').path
    path = re.sub(r'^/download/[^/]+', '/download/[redacted]', path)
    path = re.sub(r'^/private/[^/]+', '/private/[redacted]', path)
    return path[:100] or '/'


def clock(value):
    try:
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(value).astimezone().strftime('%H:%M:%S')
        if isinstance(value, str):
            return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone().strftime('%H:%M:%S')
    except (ValueError, OverflowError, OSError):
        pass
    return datetime.now().astimezone().strftime('%H:%M:%S')


def parse_line(line):
    try:
        item = json.loads(line)
    except (TypeError, json.JSONDecodeError):
        return None
    if item.get('event') == 'license_lease':
        return {
            'type': 'license', 'time': clock(item.get('time')),
            'status': int(item.get('status', 0)), 'kind': str(item.get('kind', '?')),
            'device': str(item.get('device') or '-'),
            'start_trial': bool(item.get('start_trial')),
            'code_supplied': bool(item.get('code_supplied')),
        }
    if not str(item.get('logger', '')).startswith('http.log.access'):
        return None
    request = item.get('request') or {}
    headers = request.get('headers') or {}
    agent = headers.get('User-Agent') or headers.get('user-agent') or []
    agent = agent[0] if isinstance(agent, list) and agent else (agent if isinstance(agent, str) else '-')
    return {
        'type': 'http', 'time': clock(item.get('ts')),
        'status': int(item.get('status', 0)),
        'method': str(request.get('method', '?')),
        'path': safe_path(request.get('uri', '/')),
        'ip': str(request.get('client_ip') or request.get('remote_ip') or '-'),
        'protocol': str(request.get('proto', '?')),
        'scheme': 'HTTPS' if 'tls' in request else 'HTTP',
        'duration_ms': round(float(item.get('duration', 0)) * 1000),
        'bytes': int(item.get('size', 0)),
        'agent': agent[:70],
    }


def format_row(item, color=True):
    def paint(value, tone):
        return COLORS[tone] + value + COLORS['reset'] if color else value

    status = item['status']
    tone = 'green' if status < 300 else 'yellow' if status < 400 else 'red'
    when = paint(item['time'], 'dim')
    code = paint(str(status), tone)
    if item['type'] == 'license':
        kind = item['kind']
        kind_tone = 'green' if kind in ('paid', 'trial') else 'yellow' if kind == 'not_started' else 'red'
        details = f"device={item['device']}  start_trial={str(item['start_trial']).lower()}  code={('supplied' if item['code_supplied'] else 'none')}"
        return f"{when} {paint('LICENSE ', 'magenta')} {code} {paint(f'{kind:<13}', kind_tone)} {paint(details, 'dim')}"
    method = paint(f"{item['method']:<6}", 'cyan')
    details = f"{item['scheme']} {item['protocol']}  {item['duration_ms']}ms  {item['bytes']}B  {item['ip']}  {item['agent']}"
    return f"{when} {paint('WEB     ', 'blue')} {code} {method} {item['path']}  {paint(details, 'dim')}"


def main():
    parser = argparse.ArgumentParser(description='Live, readable web and license traffic for repo.jimwashkau.com')
    parser.add_argument('view', nargs='?', choices=('all', 'license', 'errors'), default='all')
    parser.add_argument('--tail', type=int, default=30, help='recent log lines per service before following (default: 30)')
    parser.add_argument('--no-color', action='store_true')
    args = parser.parse_args()
    if args.tail < 0:
        parser.error('--tail must be zero or greater')
    color = sys.stdout.isatty() and not args.no_color and 'NO_COLOR' not in os.environ
    command = ['sudo', 'docker', 'compose', 'logs', '--follow', '--no-log-prefix', f'--tail={args.tail}', 'caddy', 'store']
    title = f"JimWas Repo  •  LIVE TRAFFIC  •  {args.view.upper()}"
    print((COLORS['bold'] + COLORS['cyan'] if color else '') + title + (COLORS['reset'] if color else ''), flush=True)
    print('Time is local to this VPS. Query strings, purchase codes, device IDs, and lease signatures are never displayed.', flush=True)
    print('Ctrl+C to stop  |  views: ~/traffic  ~/traffic license  ~/traffic errors  |  --tail 100', flush=True)
    print('─' * 100, flush=True)
    interrupted = False
    try:
        with subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1) as process:
            try:
                for line in process.stdout:
                    item = parse_line(line)
                    if not item:
                        continue
                    if args.view == 'license' and item['type'] != 'license' and item.get('path') != '/api/license/lease':
                        continue
                    if args.view == 'errors' and item['status'] < 400:
                        continue
                    print(format_row(item, color), flush=True)
            except KeyboardInterrupt:
                interrupted = True
                process.terminate()
            finally:
                if process.poll() is None:
                    process.terminate()
                process.wait()
            if process.returncode and not interrupted:
                print(process.stderr.read().strip() or f'docker compose logs exited with {process.returncode}', file=sys.stderr)
                return 1
    except FileNotFoundError as error:
        print(f'Cannot start traffic monitor: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
