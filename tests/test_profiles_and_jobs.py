import asyncio
import json
from pathlib import Path
import pytest
from pydantic import ValidationError
from backend.domain import Requirements, Evaluation, Review, AppError, score_match
from backend.model import ModelAdapter
from backend.rubrics import PROFILES
from conftest import REVIEW, FixedAdapter, upload, drain

BLOCKS = [{'id':'d1','text':'Developed Python tools for internal workflows.'}]


def evaluation(profile, scores=(100,80,60,40,20)):
    return Evaluation.model_validate({'dimensions':[{'dimension':key,'score':value,'reason':'原文支持该项经历','evidence':[{'text_block_id':'d1','quote':'Developed Python tools'}] if value is not None else []} for (key,_,_),value in zip(PROFILES[profile]['criteria'],scores)],'conditions':[],'core_information_missing':False,'summary':'待人工核验','review':REVIEW})


@pytest.mark.parametrize('profile',['toc','internal_ai'])
def test_specialized_five_dimensions_fixed_weights(profile):
    result=score_match(Requirements(scoring_profile=profile),evaluation(profile),BLOCKS)
    assert result['total_score']==70
    assert list(result['weights'].values())==[.3,.25,.2,.15,.1]
    assert result['category']=='中优先复核'
    assert result['scoring_profile']['name']==PROFILES[profile]['name']


@pytest.mark.parametrize('value,category',[(59.94,'低优先复核'),(59.95,'中优先复核'),(79.94,'中优先复核'),(79.95,'高优先复核'),(100,'高优先复核')])
def test_priority_boundaries(value,category):
    assert score_match(Requirements(scoring_profile='toc'),evaluation('toc',[value]*5),BLOCKS)['category']==category


def test_missing_evidence_does_not_renormalize_or_score_zero():
    result=score_match(Requirements(scoring_profile='internal_ai'),evaluation('internal_ai',[100,None,100,100,100]),BLOCKS)
    assert result['total_score'] is None and result['provisional']
    assert result['weights']['workflow_roi']==.25
    assert result['category']=='待补充信息'


def test_specialized_bonus_does_not_change_legacy_weights():
    req=Requirements(scoring_profile='toc',conditions=[{'id':'b','kind':'bonus','text':'AI experience'}])
    e=evaluation('toc')
    from backend.domain import Judgment
    e.conditions=[Judgment(condition_id='b',status='unknown',reason='未说明',evidence=[])]
    result=score_match(req,e,BLOCKS)
    assert result['total_score']==70 and 'bonus' not in result['weights']
    e.conditions[0].status='not_met';e.conditions[0].evidence=e.dimensions[0].evidence
    assert score_match(req,e,BLOCKS)['category']=='中优先复核'
    req.conditions[0].kind='must'
    assert score_match(req,e,BLOCKS)['category']=='低优先复核'


def test_review_required_and_evidence_still_verified():
    e=evaluation('toc');e.review=None
    with pytest.raises(AppError,match='人工复核'): score_match(Requirements(scoring_profile='toc'),e,BLOCKS)
    e=evaluation('toc');e.dimensions[0].evidence[0].quote='invented revenue'
    with pytest.raises(AppError,match='原文'): score_match(Requirements(scoring_profile='toc'),e,BLOCKS)
    with pytest.raises(ValidationError): Review.model_validate({**REVIEW,'final_recommendation':'立即录用'})
    with pytest.raises(ValidationError): Requirements(scoring_profile='invented')


def test_model_receives_rubric_and_review_policy():
    class Capture(ModelAdapter):
        async def request(self, operation,payload,schema):
            assert payload['rubric']['criteria'][0]=={'id':'ai_practice','label':'AI/大模型产品理解与真实实践','weight':30}
            assert payload['active_dimensions']==list(Requirements(scoring_profile='internal_ai').weights())
            assert payload['rubric_requirements']=={}
            assert '简历自述' in operation and 'ownership' in operation
            return evaluation('internal_ai')
    asyncio.run(Capture({}).evaluate_match(Requirements(scoring_profile='internal_ai'),{},BLOCKS))


def test_switching_profiles_invalidates_old_results_and_snapshot(client,app,ready):
    jid=ready['id'];rid=upload(client,jid)
    client.post(f'/api/jobs/{jid}/matches',json={'resume_ids':[rid]});drain(app)
    old=client.get(f'/api/jobs/{jid}/matches').json()['items'][0]
    response=client.patch('/api/jobs/'+jid,json={'expected_version':ready['version'],'requirements':{'scoring_profile':'internal_ai'},'confirmed':True})
    assert response.status_code==200 and response.json()['version']==2
    assert client.get('/api/matches/'+old['id']).json()['stale']
    tid=client.post(f'/api/jobs/{jid}/matches',json={'resume_ids':[rid]}).json()['tasks'][0]['task_id'];drain(app)
    task=client.get('/api/tasks/'+tid).json();assert task['status']=='succeeded',task
    result=client.get('/api/matches/'+task['output']['match_id']).json()
    assert result['category']=='高优先复核' and len(result['dimensions'])==5
    assert result['review']['ownership_level']=='未知'
    assert result['input_snapshot']['requirements']['scoring_profile']=='internal_ai'
    assert not result['stale']


def test_jd_parse_preserves_profile_and_old_jobs_remain_generic(client,app,ready):
    jid=ready['id']
    client.patch('/api/jobs/'+jid,json={'expected_version':1,'requirements':{'scoring_profile':'toc'},'confirmed':True})
    tid=client.post(f'/api/jobs/{jid}/parse').json()['task_id'];drain(app)
    assert client.get('/api/tasks/'+tid).json()['output']['requirements']['scoring_profile']=='toc'
    assert Requirements.model_validate({'skills':['Python']}).scoring_profile=='generic'
    assert len(client.get('/api/scoring-profiles').json())==3


def test_specialized_jd_requirements_are_validated_to_template_dimensions():
    req = Requirements(scoring_profile='toc', rubric_requirements={'growth_results': ['负责用户增长']})
    assert req.rubric_requirements['growth_results'] == ['负责用户增长']
    with pytest.raises(ValidationError):
        Requirements(scoring_profile='toc', rubric_requirements={'invented_dimension': ['不应出现']})


def test_deleting_job_preserves_shared_resumes_and_other_results(client,app,ready):
    jid=ready['id'];rid=upload(client,jid)
    other=client.post('/api/jobs',json={'name':'Other','requirements':{'skills':['Python']},'confirmed':True}).json()['id']
    for job in [jid,other]:
        client.post(f'/api/jobs/{job}/matches',json={'resume_ids':[rid]})
    drain(app)
    assert client.delete('/api/jobs/'+jid).json()=={'deleted':True}
    assert client.get('/api/jobs/'+jid).status_code==404
    assert client.delete('/api/jobs/'+jid).status_code==404
    assert client.get(f'/api/resumes/{rid}/file').status_code==200
    assert client.get(f'/api/jobs/{other}/matches').json()['total']==1
    assert not app.state.store.all('SELECT * FROM analysis_tasks WHERE job_id=?',(jid,))
    assert not app.state.store.all('SELECT * FROM match_results WHERE job_id=?',(jid,))


def test_delete_during_analysis_revokes_result_commit(client,app,ready):
    jid=ready['id'];rid=upload(client,jid)
    tid=client.post(f'/api/jobs/{jid}/matches',json={'resume_ids':[rid]}).json()['tasks'][0]['task_id']
    FixedAdapter.on_evaluate=lambda:client.delete('/api/jobs/'+jid)
    drain(app)
    assert client.get('/api/tasks/'+tid).status_code==404
    assert client.get('/api/resumes/'+rid).status_code==200
    assert app.state.store.all('SELECT * FROM match_results')==[]


def test_deleting_queued_jobs_leaves_no_executable_task(client,app,ready):
    jid=ready['id'];rid=upload(client,jid)
    client.post(f'/api/jobs/{jid}/matches',json={'resume_ids':[rid]})
    client.post(f'/api/jobs/{jid}/parse')
    client.delete('/api/jobs/'+jid)
    assert not asyncio.run(app.state.worker.run_once())


def test_old_queued_rule_snapshot_is_explicitly_rejected(client,app,ready):
    jid=ready['id'];rid=upload(client,jid)
    tid=client.post(f'/api/jobs/{jid}/matches',json={'resume_ids':[rid]}).json()['tasks'][0]['task_id']
    with app.state.store.connect(write=True) as db:
        payload=json.loads(db.execute('SELECT payload FROM analysis_tasks WHERE id=?',(tid,)).fetchone()[0]);payload['scoring_version']='1'
        db.execute('UPDATE analysis_tasks SET payload=? WHERE id=?',(json.dumps(payload),tid))
    drain(app)
    assert client.get('/api/tasks/'+tid).json()['error']['code']=='rules_changed'
