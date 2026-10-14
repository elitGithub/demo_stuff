#!/usr/bin/env python3
"""Private configuration works with putenv disabled and external env precedence."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='resto-config-') as directory:
    folder=Path(directory)
    (folder/'app').mkdir()
    shutil.copyfile(ROOT/'app/config.php',folder/'app/config.php')
    (folder/'.env').write_text('APP_NAME=File Name\nDB_PASSWORD="literal$#=password"\nSESSION_SECURE=1\n')
    environment={key:value for key,value in os.environ.items() if key not in ('APP_NAME','DB_PASSWORD','SESSION_SECURE')}
    def read(env):
        result=subprocess.run(['php','-d','disable_functions=putenv','-r', '$config=require $argv[1]; echo json_encode($config);',str(folder/'app/config.php')],env=env,text=True,capture_output=True)
        assert result.returncode==0, result.stderr
        return json.loads(result.stdout)
    config=read(environment)
    assert config['name']=='File Name' and config['db_password']=='literal$#=password' and config['secure_cookies'] is True
    config=read(dict(environment,APP_NAME='External Name'))
    assert config['name']=='External Name'
print('2 configuration checks passed with putenv disabled.')
