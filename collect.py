"""Capture untrusted originals only. Validation and publication stay off this runner."""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import time
import uuid
from zoneinfo import ZoneInfo

ROOT=Path(__file__).resolve().parent
CITIES={'ICN':'seoul','TPE':'taipei','TSA':'taipei','HKG':'hongkong','SGN':'hochiminh','BKK':'bangkok','DMK':'bangkok'}


def validate(value, now=None):
    now=now or dt.datetime.now(dt.timezone.utc)
    if set(value)!={'requestId','createdAt','tasks'}:
        raise ValueError('invalid_request_fields')
    if str(uuid.UUID(value['requestId']))!=value['requestId']:
        raise ValueError('invalid_request_id')
    created=dt.datetime.fromisoformat(value['createdAt'])
    if not created.tzinfo or not -120 <= (now-created).total_seconds() <= 2700:
        raise ValueError('stale_request')
    tasks=value['tasks']
    if not isinstance(tasks,list) or not 1<=len(tasks)<=5:
        raise ValueError('invalid_task_count')
    cities=set()
    today=now.astimezone(ZoneInfo('Asia/Tokyo')).date()
    for task in tasks:
        if not isinstance(task,dict) or set(task)!={'from','to','out','back'}:
            raise ValueError('invalid_task_fields')
        if task['from'] not in ('NRT','HND') or task['to'] not in CITIES:
            raise ValueError('invalid_route')
        out,back=(dt.date.fromisoformat(task[k]) for k in ('out','back'))
        if out.isoformat()!=task['out'] or back.isoformat()!=task['back']:
            raise ValueError('invalid_date_format')
        if not 7 <= (out-today).days <= 60 or not 2 <= (back-out).days <= 23:
            raise ValueError('invalid_date_scope')
        city=CITIES[task['to']]
        if city in cities:
            raise ValueError('duplicate_city')
        cities.add(city)
    return value


def bounded(args, seconds):
    child=subprocess.Popen(args,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL,start_new_session=True)
    try:
        try:return child.wait(timeout=seconds)
        except subprocess.TimeoutExpired:
            try:os.killpg(child.pid,signal.SIGTERM)
            except ProcessLookupError:pass
            try:child.wait(timeout=5)
            except subprocess.TimeoutExpired:pass
            return 124
    finally:
        try:os.killpg(child.pid,signal.SIGKILL)
        except ProcessLookupError:pass
        child.wait()


def main():
    os.umask(0o077)
    path=ROOT/'requests/latest.json'
    if path.stat().st_size>50000:
        raise ValueError('request_too_large')
    value=json.loads(path.read_text())
    output=ROOT/'private-output'
    output.mkdir(mode=0o700)
    identity={'requestId':str(uuid.UUID(value['requestId'])),'createdAt':value['createdAt'],'tasks':[]}
    if not dt.datetime.fromisoformat(identity['createdAt']).tzinfo:
        raise ValueError('invalid_identity')
    receipt={'request':identity,'requestSha256':hashlib.sha256(path.read_bytes()).hexdigest(),
             'sourceCommit':os.environ.get('GITHUB_SHA'),'runId':os.environ.get('GITHUB_RUN_ID'),
             'runAttempt':os.environ.get('GITHUB_RUN_ATTEMPT'),'observations':[],
             'status':'runner_failed','publicationAttempted':False}
    try:
        try:request=validate(value)
        except (ValueError,KeyError,TypeError):
            receipt['status']='request_rejected'
            return 2
        receipt['request']=request
        for index,task in enumerate(request['tasks']):
            if index:time.sleep(60)
            task_file=output/f'{index}-task.json'
            raw_file=output/f'{index}-raw.json'
            task_file.write_text(json.dumps(task))
            code=bounded(['node',str(ROOT/'collector/observe.mjs'),str(task_file),str(raw_file)],240)
            try:
                if raw_file.stat().st_size>2000000:raise ValueError('oversized_original')
                raw=json.loads(raw_file.read_text())
                if not isinstance(raw,dict):raise ValueError('invalid_original')
            except (OSError,ValueError,RecursionError):raw={'stage':'failed','reason':'capture_incomplete'}
            receipt['observations'].append({'task':task,'exitCode':code,'raw':raw})
            reason=raw.get('reason')
            blocked=isinstance(raw.get('diagnosticText'),str) and raw['diagnosticText'].strip()=='whaleguard block'
            if reason=='human_verification_required' or blocked:
                receipt['providerPaused']=True
                break
            if code==124:
                receipt['batchStopped']='capture_timeout'
                break
        if len(receipt['observations'])!=len(request['tasks']) or any(o['exitCode']!=0 or o['raw'].get('stage')!='passenger_form_quote' for o in receipt['observations']):
            receipt['status']='capture_failed'
        else:
            receipt['status']='captured_unvalidated'
    except Exception:
        receipt['status']='runner_failed'
        raise
    finally:
        receipt['endedAt']=dt.datetime.now(dt.timezone.utc).isoformat()
        temporary=output/'receipt.json.tmp'
        with temporary.open('w') as stream:
            json.dump(receipt,stream)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(output/'receipt.json')
    # No raw fares, provider messages or account data in public logs.
    print(json.dumps({'status':receipt['status'],'count':len(receipt['observations'])}))
    return 0 if receipt['status']=='captured_unvalidated' else 2


if __name__=='__main__':
    try:raise SystemExit(main())
    except Exception as error:
        print(json.dumps({'status':'runner_failed','errorType':type(error).__name__}))
        raise SystemExit(2)
