#!/usr/bin/env python3
"""Build an InfinityFree upload and fresh demo SQL; never export the local demo DB."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile
import time
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = ROOT/'deploy/infinityfree'
TABLES = ('users','categories','food','orders','order_items','login_attempts')


def build(output):
    # Generated SQL and login credentials are private, ignored local artifacts.
    if output.exists():
        raise SystemExit('Output already exists. Choose a new --output directory; existing credentials were not changed.')
    if output.is_relative_to(ROOT/'public'):
        raise SystemExit('Choose an output directory outside public/.')
    with tempfile.TemporaryDirectory(prefix='resto-package-') as temporary:
        database = Path(temporary)/'seed.sqlite'
        environment = dict(os.environ, DB_DRIVER='sqlite', DB_PATH=str(database), ADMIN_EMAIL='staff@resto-chef.test', APP_TIMEZONE='UTC', APP_CURRENCY='USD', DELIVERY_FEE_CENTS='350')
        setup = subprocess.run(['php', str(ROOT/'bin/setup.php'), '--demo', '--json'], env=environment, text=True, capture_output=True)
        if setup.returncode:
            raise SystemExit('Demo seed failed: '+setup.stderr)
        accounts = json.loads(setup.stdout)
        generated_at = int(time.time())
        with sqlite3.connect(database) as db:
            db.row_factory = sqlite3.Row
            sql = ['-- Resto-Chef: import once into a NEW EMPTY selected MySQL database.', '-- Contains only freshly generated sample data, never local customer data.', '-- Passwords are hashes. Keep this file private; import through phpMyAdmin.', 'SET NAMES utf8mb4;', 'SET @resto_demo_now = UNIX_TIMESTAMP();', '']
            # The seed schema is the source of truth. Its only dialect-specific
            # table feature is SQLite AUTOINCREMENT; MySQL also needs InnoDB.
            for table in TABLES:
                ddl = db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone()[0]
                ddl = ddl.replace('INTEGER PRIMARY KEY AUTOINCREMENT', 'INTEGER PRIMARY KEY AUTO_INCREMENT')
                sql.append(ddl+' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;')
            for row in db.execute("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name"):
                sql.append(row[0]+';')
            sql.append('START TRANSACTION;')
            for table in TABLES:
                for row in db.execute('SELECT * FROM '+table+' ORDER BY '+('bucket' if table=='login_attempts' else 'id')):
                    values=[]
                    for column, value in dict(row).items():
                        if value is None: values.append('NULL')
                        elif column.endswith('_at'):
                            values.append('(@resto_demo_now - '+str(generated_at-int(value))+')')
                        elif isinstance(value, int): values.append(str(value))
                        else:
                            # UTF-8 hex literals avoid dependence on SQL escaping modes.
                            values.append("CONVERT(X'"+str(value).encode('utf-8').hex()+"' USING utf8mb4)")
                    columns=', '.join('`'+column+'`' for column in row.keys())
                    sql.append('INSERT INTO `'+table+'` ('+columns+') VALUES ('+', '.join(values)+');')
            sql.append('COMMIT;')
        output.mkdir(parents=True,mode=0o700)
        output.chmod(0o700)
        (output/'.gitignore').write_text('*\n')
        website=output/'htdocs'
        private=website/'private'
        (private/'public').mkdir(parents=True)
        for directory in ('app','templates'):
            (private/directory).mkdir()
            for source in sorted((ROOT/directory).glob('*.php')):
                shutil.copyfile(source,private/directory/source.name)
        shutil.copyfile(ROOT/'public/index.php',private/'public/index.php')
        (website/'assets').mkdir()
        for source in sorted((ROOT/'public/assets').iterdir()):
            if source.is_file() and source.suffix.lower() in ('.css','.js','.jpg','.png','.svg','.webp','.woff2'):
                shutil.copyfile(source,website/'assets'/source.name)
        for source, target in [('index.php',website/'index.php'),('website.htaccess',website/'.htaccess'),('private.htaccess',private/'.htaccess'),('hosting.env.example',private/'.env')]:
            shutil.copyfile(TEMPLATES/source,target)
        (private/'.env').chmod(0o600)
        (output/'demo.sql').write_text('\n\n'.join(sql)+'\n')
        (output/'demo-credentials.json').write_text(json.dumps(accounts,indent=2)+'\n')
        shutil.copyfile(TEMPLATES/'DEPLOY.md',output/'DEPLOY.md')
        with zipfile.ZipFile(output/'resto-chef-upload.zip','w',zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(website.rglob('*')):
                if path.is_file():
                    limit=10_000 if path.name=='.htaccess' else (1_000_000 if path.suffix in ('.php','.html','.js') else 10_000_000)
                    if path.stat().st_size>=limit: raise RuntimeError('File exceeds InfinityFree limit: '+str(path.relative_to(website)))
                    archive.write(path,path.relative_to(output))
        sums=[]
        for name in ('resto-chef-upload.zip','demo.sql'):
            sums.append(hashlib.sha256((output/name).read_bytes()).hexdigest()+'  '+name)
        (output/'SHA256SUMS').write_text('\n'.join(sums)+'\n')
        for path in output.iterdir():
            if path.is_file(): path.chmod(0o600)
        print('Package: '+str(output/'resto-chef-upload.zip'))
        print('Database: '+str(output/'demo.sql'))
        print('Private logins: '+str(output/'demo-credentials.json'))
        print('Instructions: '+str(output/'DEPLOY.md'))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=ROOT/'storage/infinityfree')
    build(parser.parse_args().output.resolve())
