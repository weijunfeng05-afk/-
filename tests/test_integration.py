import asyncio
import json
import time
from pathlib import Path
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from backend.app import create_app
from backend.storage import dumps
from conftest import upload, drain, FixedAdapter, docx_bytes


def start(client,job_id,ids,force=False):
    response=client.post(f'/api/jobs/{job_id}/matches',json={'resume_ids':ids,'force':force})
    assert response.status_code==202, response.text
    return response.json()['tasks']


def test_full_workflow_and_cache(client,app,ready):
    jid=ready['id']; rid=upload(client,jid)
    tid=start(client,jid,[rid])[0]['task_id']
    assert start(client,jid,[rid])[0]['task_id']==tid
    drain(app)
    task=client.get('/api/tasks/'+tid).json()
    assert task['status']=='succeeded',task
    result=client.get('/api/matches/'+task['output']['match_id']).json()
    assert result['category']=='优先查看' and result['total_score']==85
    assert result['resume']['name']=='Alice Chen'
    assert result['input_snapshot']['requirements']['skills']==['Python']
    assert client.get(f'/api/resumes/{rid}/file').content.startswith(b'PK')
    assert start(client,jid,[rid])[0]['task_id']==tid
    tid2=start(client,jid,[rid],True)[0]['task_id'];assert tid2!=tid
    drain(app)
    assert len([c for c in FixedAdapter.calls if c[0]=='parse'])==1
    evaluation_call=next(c for c in FixedAdapter.calls if c[0]=='evaluate')
    assert 'Alice Chen' not in dumps(evaluation_call)
    assert client.get('/api/tasks/'+tid2).json()['status']=='succeeded'
    assert client.get(f'/api/jobs/{jid}/matches').json()['total']==1


def test_partial_failure_and_unknown(client,app,ready):
    jid=ready['id']
    ids=[upload(client,jid),upload(client,jid,'Python UNKNOWN'),upload(client,jid,'Python NOT_MET')]
    broken=client.post('/api/resumes',data={'job_id':jid},files=[('files',('bad.pdf',b'%PDF-1.7\nbroken'))]).json()['files'][0]['resume_id']
    tasks=start(client,jid,ids+[broken]);drain(app)
    states=[client.get('/api/tasks/'+t['task_id']).json()['status'] for t in tasks]
    assert states==['succeeded','succeeded','succeeded','failed']
    result=client.get(f'/api/jobs/{jid}/matches').json()
    assert result['total']==3
    assert result['items'][-1]['category']=='待补充信息'
    assert result['items'][-1]['total_score'] is None
    assert client.get(f'/api/jobs/{jid}/matches?category=不太匹配').json()['total']==1


def test_jd_requires_user_confirmation(client,app):
    client.put('/api/model-config',json={'base_url':'https://example.com/v1','model':'test','api_key':'key'})
    job=client.post('/api/jobs',json={'name':'新岗位','jd_text':'Python role'}).json(); jid=job['id']
    rid=upload(client,jid)
    assert client.post(f'/api/jobs/{jid}/matches',json={'resume_ids':[rid]}).json()['code']=='unconfirmed_requirements'
    task=client.post(f'/api/jobs/{jid}/parse').json()['task_id'];drain(app)
    parsed=client.get('/api/tasks/'+task).json()['output']['requirements']
    assert not client.get('/api/jobs/'+jid).json()['confirmed']
    response=client.patch('/api/jobs/'+jid,json={'expected_version':job['version'],'requirements':parsed,'confirmed':True})
    assert response.status_code==200
    start(client,jid,[rid]);drain(app)
    assert client.get(f'/api/jobs/{jid}/matches').json()['total']==1


def test_stale_versions_and_config_cache_invalidation(client,app,ready):
    jid=ready['id'];rid=upload(client,jid);start(client,jid,[rid]);drain(app)
    updated=client.patch('/api/jobs/'+jid,json={'expected_version':1,'requirements':{'skills':['Advanced Python']},'confirmed':True}).json()
    assert updated['version']==2
    assert client.get(f'/api/jobs/{jid}/matches').json()['items'][0]['stale']
    assert client.patch('/api/jobs/'+jid,json={'expected_version':1,'name':'lost update'}).status_code==409
    start(client,jid,[rid]);drain(app)
    assert not client.get(f'/api/jobs/{jid}/matches').json()['items'][0]['stale']
    assert len([c for c in FixedAdapter.calls if c[0]=='parse'])==1
    client.put('/api/model-config',json={'base_url':'https://model.example/v1','model':'next-model','api_key':''})
    assert client.get(f'/api/jobs/{jid}/matches').json()['items'][0]['stale']
    start(client,jid,[rid]);drain(app)
    assert len([c for c in FixedAdapter.calls if c[0]=='parse'])==2


def test_key_encryption_masking_and_invalid_input(client,app):
    assert client.put('/api/model-config',json={'base_url':'http://remote.example/v1','model':'test','api_key':'sensitive'}).status_code==400
    saved=client.put('/api/model-config',json={'base_url':'https://api.example/v1','model':'test','api_key':'sensitive'}).json()
    assert saved['key_set'] and 'sensitive' not in dumps(saved)
    assert 'sensitive' not in client.get('/api/model-config').text
    encrypted=app.state.store.one('SELECT * FROM model_configs')['encrypted_key']
    assert encrypted!='sensitive' and app.state.configs.private()['api_key']=='sensitive'
    assert client.post('/api/model-config/test').status_code==200
    bad=client.put('/api/model-config',json={'base_url':7,'api_key':'never-echo-me','model':'x'})
    assert bad.status_code==422 and 'never-echo-me' not in bad.text
    assert set(bad.json())=={'code','message','retryable','request_id'}
    assert client.post('/api/jobs',headers={'Origin':'https://attacker.example'},json={'name':'x'}).status_code==403
    assert client.get('/api/jobs',headers={'Host':'attacker.example'}).status_code==403


def test_retry_and_recovery(client,app,ready):
    jid=ready['id'];rid=upload(client,jid)
    tid=start(client,jid,[rid])[0]['task_id']
    claimed=app.state.worker.claim()
    assert claimed['id']==tid
    assert app.state.worker.claim() is None
    with app.state.store.connect(write=True) as db: db.execute('UPDATE analysis_tasks SET lease_until=? WHERE id=?',(time.time()-1,tid))
    app.state.worker.recover()
    assert client.get('/api/tasks/'+tid).json()['status']=='interrupted'
    retried=client.post('/api/tasks/'+tid+'/retry').json()['task_id']
    assert client.get('/api/tasks/'+retried).json()['attempt']==2
    drain(app)
    assert client.get('/api/tasks/'+retried).json()['status']=='succeeded'
    assert client.post('/api/tasks/'+retried+'/retry').status_code==409


def test_delete_during_evaluation_cannot_resurrect(client,app,ready):
    jid=ready['id'];rid=upload(client,jid);tid=start(client,jid,[rid])[0]['task_id']
    path=app.state.store.one('SELECT file_path FROM resumes WHERE id=?',(rid,))['file_path']
    FixedAdapter.on_evaluate=lambda: client.delete('/api/resumes/'+rid)
    drain(app)
    assert not Path(path).exists()
    assert client.get('/api/resumes/'+rid).status_code==404
    assert client.get('/api/tasks/'+tid).status_code==404
    assert app.state.store.all('SELECT * FROM match_results')==[]


def test_fail_retry_and_batch_validation(client,app,ready):
    jid=ready['id'];rid=upload(client,jid);FixedAdapter.fail=True
    tid=start(client,jid,[rid])[0]['task_id'];drain(app)
    assert client.get('/api/tasks/'+tid).json()['status']=='failed'
    FixedAdapter.fail=False
    new=client.post('/api/tasks/'+tid+'/retry').json()['task_id'];drain(app)
    assert client.get('/api/tasks/'+new).json()['status']=='succeeded'
    response=client.post('/api/resumes',data={'job_id':jid},files=[('files',('bad.docx',b'broken')),('files',('ok.docx',docx_bytes()))]).json()
    assert response['files'][0]['error'] and response['files'][1]['resume_id']==rid


def test_restart_retains_jobs_results_and_queued_tasks(client,app,ready):
    jid=ready['id'];rid=upload(client,jid);tid=start(client,jid,[rid])[0]['task_id']
    restarted=create_app(app.state.store.directory,worker_enabled=False,model_factory=FixedAdapter)
    restarted.state.configs.cipher=app.state.configs.cipher
    drain(restarted)
    with TestClient(restarted) as other:
        assert other.get('/api/tasks/'+tid).json()['status']=='succeeded'
        assert len(other.get(f'/api/jobs/{jid}/resumes').json())==1


def test_cross_job_dedup_and_old_lease_cannot_commit(client,app,ready):
    jid=ready['id'];rid=upload(client,jid)
    other=client.post('/api/jobs',json={'name':'Other','requirements':{'skills':['Python']},'confirmed':True}).json()
    assert upload(client,other['id'])==rid
    tid=start(client,jid,[rid])[0]['task_id']
    task=app.state.worker.claim()
    with app.state.store.connect(write=True) as db: db.execute("UPDATE analysis_tasks SET token='new-token' WHERE id=?",(tid,))
    asyncio.run(app.state.worker.execute(task))
    assert not app.state.store.all('SELECT * FROM match_results')


def test_missing_configuration_and_empty_requirements(client):
    job=client.post('/api/jobs',json={'name':'Unconfigured'}).json()
    assert client.post('/api/jobs/'+job['id']+'/parse').json()['code']=='model_not_configured'
    assert client.post('/api/jobs',json={'name':'Empty','confirmed':True}).json()['code']=='empty_requirements'


def test_jd_document_upload(client):
    response=client.post('/api/files/extract',files={'file':('jd.docx',docx_bytes('Python JD',table=True))})
    assert response.status_code==200
    assert 'Built a Python API' in response.json()['text']
