#!/usr/bin/env python3
"""Verify a v12.5 private backup and rehearse SQLite restoration offline."""
import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import sqlite3
import tempfile

REQUIRED = {'meta', 'users', 'broadcasts', 'deliveries', 'processed_actions', 'webhook_updates'}

def digest(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()

def checked_file(root, name):
    rel = PurePosixPath(name)
    if rel.is_absolute() or '..' in rel.parts or '\\' in name or not rel.parts:
        raise ValueError('Unsafe manifest path')
    p = root.joinpath(*rel.parts)
    if p.resolve() != p or not p.is_file():
        raise ValueError('Missing or redirected backup member')
    return p

def summarize(db):
    if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
        raise ValueError('SQLite integrity check failed')
    names = {x[0] for x in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if not REQUIRED <= names:
        raise ValueError('Required database tables missing')
    return {n: db.execute('SELECT COUNT(*) FROM "' + n + '"').fetchone()[0]
            for n in sorted(REQUIRED)}

def verify(root):
    root = root.resolve(strict=True)
    if not root.is_dir() or root.stat().st_mode & 0o077:
        raise ValueError('Backup directory must be private (0700)')
    m = json.loads(checked_file(root, 'backup-manifest.json').read_text())
    if m.get('database') != 'qmr.sqlite3' or m.get('credentials_included') is not False:
        raise ValueError('Unexpected backup manifest')
    files = m.get('files')
    if not isinstance(files, dict) or 'qmr.sqlite3' not in files:
        raise ValueError('Missing database digest')
    for name, expected in files.items():
        if name != 'qmr.sqlite3' and not (name.startswith('runtime/') and name.endswith('.json')):
            raise ValueError('Unexpected member in manifest')
        p = checked_file(root, name)
        if p.stat().st_mode & 0o077 or digest(p) != expected:
            raise ValueError('Private permissions or digest mismatch')
    for suffix in ('-wal', '-shm', '-journal'):
        if (root / ('qmr.sqlite3' + suffix)).exists():
            raise ValueError('Unexpected SQLite sidecar')
    db = checked_file(root, 'qmr.sqlite3')
    uri = db.as_uri() + '?mode=ro&immutable=1'
    with tempfile.TemporaryDirectory(prefix='qmr-restore-rehearsal-') as temp, \
         contextlib.closing(sqlite3.connect(uri, uri=True)) as src:
        original = summarize(src)
        clone = Path(temp) / 'qmr-rehearsal.sqlite3'
        with contextlib.closing(sqlite3.connect(clone)) as dst:
            os.chmod(clone, 0o600)
            src.backup(dst)
            restored = summarize(dst)
        if original != restored or digest(db) != files['qmr.sqlite3']:
            raise ValueError('Restore rehearsal comparison failed')
    return {'verified_manifest_members': len(files), 'sqlite_integrity': 'ok',
            'required_tables_verified': len(REQUIRED), 'restore_rehearsal': 'PASS',
            'live_database_modified': False, 'credentials_copied': False,
            'network_used': False}

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('backup', type=Path)
    a = p.parse_args()
    try:
        print(json.dumps(verify(a.backup), indent=2))
    except (OSError, ValueError, sqlite3.Error, TypeError) as e:
        p.exit(1, 'STOP: ' + str(e) + '\n')

if __name__ == '__main__':
    main()
