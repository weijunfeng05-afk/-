import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app import create_app
from backend.domain import AppError, Requirements
from backend.model import ModelAdapter
from backend.rubrics import PROFILES
from conftest import FixedAdapter, upload, drain


@pytest.mark.parametrize('profile', ['toc', 'internal_ai'])
def test_jd_maps_exact_source_to_selected_template(profile):
    keys = [key for key, _, _ in PROFILES[profile]['criteria']]
    mapping = {key: [] for key in keys}
    mapping[keys[0]] = ['负责业务增长']
    def handler(request):
        body = json.loads(request.content)
        payload = json.loads(body['messages'][1]['content'])['data']
        assert payload['scoring_profile'] == profile
        assert [c['weight'] for c in payload['rubric']['criteria']] == [30, 25, 20, 15, 10]
        result = {'scoring_profile': profile, 'rubric_requirements': mapping}
        return httpx.Response(200, json={'choices': [{'message': {'content': json.dumps(result)}}]})
    adapter = ModelAdapter({'base_url':'https://example.com','model':'test','api_key':'test'}, transport=httpx.MockTransport(handler))
    result = asyncio.run(adapter.parse_jd('主要职责：负责业务增长。', profile))
    assert result.rubric_requirements == mapping


@pytest.mark.parametrize('mapping', [{'ai_practice':['AI']}, {'invented':['other']}])
def test_wrong_template_is_rejected(mapping):
    with pytest.raises(ValidationError):
        Requirements(scoring_profile='toc', rubric_requirements=mapping)


@pytest.mark.parametrize('missing', [True, False])
def test_missing_dimensions_or_invented_jd_evidence_rejected(missing):
    class Fake(ModelAdapter):
        async def request(self, operation, payload, schema):
            mapping = {} if missing else {key: ['不存在的要求'] for key, _, _ in PROFILES['toc']['criteria']}
            return schema(scoring_profile='toc', rubric_requirements=mapping)
    with pytest.raises(AppError):
        asyncio.run(Fake({}).parse_jd('负责增长', 'toc'))


def test_files_parsed_facts_and_history_survive_app_recreation(client, app, ready):
    jid = ready['id']
    rid = upload(client, jid)
    for _ in range(2):
        client.post(f'/api/jobs/{jid}/matches', json={'resume_ids':[rid], 'force':True})
        drain(app)
    original = client.get(f'/api/resumes/{rid}/file').content
    restored = create_app(app.state.store.directory, worker_enabled=False, model_factory=FixedAdapter)
    with TestClient(restored) as other:
        assert other.get(f'/api/resumes/{rid}/file').content == original
        resume = other.get(f'/api/resumes/{rid}').json()
        assert resume['text_blocks'] and resume['parsed_json']['skills']
        history = other.get(f'/api/resumes/{rid}/history', params={'job_id':jid}).json()
        assert len(history) == 2 and history[0]['id'] != history[1]['id']
        assert all(row['input_snapshot']['requirements']['skills'] == ['Python'] for row in history)
        assert other.get(f'/api/jobs/{jid}/resumes').json()[0]['id'] == rid
