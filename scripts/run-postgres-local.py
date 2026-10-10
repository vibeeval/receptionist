"""Start an isolated task-local PostgreSQL test cluster and always stop it.
Usage: python3 scripts/run-postgres-local.py /absolute/verified/postgres/prefix
"""
from pathlib import Path
import os,subprocess,tempfile,secrets,socket,shutil,json,sys
root=Path(__file__).resolve().parent.parent
prefix=Path(sys.argv[1]).resolve();bin=prefix/'bin'
if not (bin/'postgres').is_file():raise SystemExit('Verified PostgreSQL prefix required')
evidence=root/'evidence';evidence.mkdir(exist_ok=True)
with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
run=Path(tempfile.mkdtemp(prefix='phone-pg-test-'));os.chmod(run,0o700)
data=run/'data';pw=run/'password';password=secrets.token_urlsafe(32);pw.write_text(password);os.chmod(pw,0o600)
env=os.environ.copy();env.update(PGPASSWORD=password,PGUSER='pgtest',PGDATABASE='postgres',PGHOST='127.0.0.1',PGCONNECT_TIMEOUT='5')
env.update(POSTGRES_TEST_BIN=str(bin),PGPORT=str(port),POSTGRES_TEST_URL=f'postgresql://pgtest:{password}@127.0.0.1:{port}/receptionist_test',ALLOW_POSTGRES_TEST='1')
(evidence/'pg-server.txt').write_text('')
started=False;result={};code=1
log=(evidence/'pg-cluster.txt').open('w')
def command(args):
 r=subprocess.run([str(x) for x in args],env=env,text=True,stdout=log,stderr=log,timeout=60)
 if r.returncode:raise RuntimeError('Local command failed: '+Path(str(args[0])).name)
try:
 command([bin/'initdb','-D',data,'-U','pgtest','--pwfile',pw,'--auth-local=scram-sha-256','--auth-host=scram-sha-256','--encoding=UTF8','--locale=C']);pw.unlink()
 command([bin/'pg_ctl','-D',data,'-l',evidence/'pg-server.txt','-o',f"-h 127.0.0.1 -p {port} -c unix_socket_directories=''",'-w','start']);started=True
 command([bin/'createdb','receptionist_test'])
 with (evidence/'pg-tests.txt').open('w') as output:
  tests=sorted((root/'dist/tests/postgres').glob('*.test.js'))
  if not tests:raise RuntimeError('Build tests before running')
  r=subprocess.run(['node','--test','--test-concurrency=1',*[str(p) for p in tests]],cwd=root,env=env,stdout=output,stderr=output,timeout=180)
  code=r.returncode;result['testExitCode']=code
 command([bin/'psql','-X','-d','receptionist_test','-v','ON_ERROR_STOP=1','-c','CREATE TABLE public.restart_probe(id integer PRIMARY KEY); BEGIN; INSERT INTO public.restart_probe VALUES(1); COMMIT; BEGIN; INSERT INTO public.restart_probe VALUES(2); ROLLBACK;'])
 command([bin/'pg_ctl','-D',data,'-m','immediate','-w','stop']);started=False
 command([bin/'pg_ctl','-D',data,'-l',evidence/'pg-server.txt','-o',f"-h 127.0.0.1 -p {port} -c unix_socket_directories=''",'-w','start']);started=True
 command([bin/'psql','-X','-d','receptionist_test','-v','ON_ERROR_STOP=1','-c',"DO $$ BEGIN IF (SELECT array_agg(id) FROM public.restart_probe) <> ARRAY[1] THEN RAISE EXCEPTION 'WAL recovery failed'; END IF; END $$;"])
 result['serverImmediateShutdownWalRecovery']='PASS'
finally:
 if started or (data/'postmaster.pid').exists():command([bin/'pg_ctl','-D',data,'-m','fast','-w','stop'])
 result['postmasterPidAbsent']=not (data/'postmaster.pid').exists()
 with socket.socket() as s:result['listenerClosed']=s.connect_ex(('127.0.0.1',port))!=0
 shutil.rmtree(run);result['temporaryClusterAndCredentialRemoved']=not run.exists();log.close()
 (evidence/'pg-cleanup.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result));raise SystemExit(code)
