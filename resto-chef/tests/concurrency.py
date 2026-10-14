#!/usr/bin/env python3
# Verify SQLite checkout waits for a short concurrent write instead of failing.
from pathlib import Path
import os
import sqlite3
import subprocess
import tempfile
import time
ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='restrogirls-lock-') as temporary:
    env=dict(os.environ,DB_DRIVER='sqlite',DB_PATH=temporary+'/test.sqlite',APP_ROOT=str(ROOT))
    setup=subprocess.run(['php','bin/setup.php','--demo','--json'],cwd=ROOT,env=env,capture_output=True,text=True)
    assert setup.returncode == 0, setup.stderr
    script=Path(temporary)/'checkout.php'
    script.write_text('''<?php
require getenv('APP_ROOT').'/app/Database.php';
require getenv('APP_ROOT').'/app/Store.php';
$config=require getenv('APP_ROOT').'/app/config.php';
$db=Database::connect($config); $store=new Store($db);
$cart=[1=>1]; $quote=$store->quote($cart,'pickup');
echo "ATTEMPTING\\n"; flush();
$order=$store->placeOrder(2,$cart,['customer_name'=>'Concurrency tester','phone'=>'1234567890','fulfillment'=>'pickup'],bin2hex(random_bytes(32)),$quote['fingerprint']);
echo 'CREATED '.$order['id'];
'''.replace('\\\\n','\\n'))
    db=sqlite3.connect(temporary+'/test.sqlite')
    db.execute('BEGIN IMMEDIATE')
    worker=subprocess.Popen(['php',str(script)],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    try:
        assert worker.stdout.readline().strip() == 'ATTEMPTING'
        time.sleep(.25)
        db.commit()
        output,error=worker.communicate(timeout=10)
        assert worker.returncode == 0 and 'CREATED' in output, output+error
        print('PASS checkout waits for concurrent SQLite writer and commits successfully')
    finally:
        db.close()
        if worker.poll() is None: worker.kill(); worker.wait()
