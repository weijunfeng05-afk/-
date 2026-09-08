import asyncio
import json
import httpx
import pytest
from backend.domain import AppError
from backend.model import ModelAdapter

CONFIG={'base_url':'https://api.example/v1','api_key':'hidden-key','model':'test'}


def adapter(handler):
    async def no_wait(_): pass
    return ModelAdapter(CONFIG,transport=httpx.MockTransport(handler),sleep=no_wait)


def test_real_http_contract_and_structure_retry():
    calls=[]
    def handler(request):
        assert str(request.url)=='https://api.example/v1/chat/completions'
        assert request.headers['Authorization']=='Bearer hidden-key'
        body=json.loads(request.content);calls.append(body)
        assert body['response_format']=={'type':'json_object'}
        return httpx.Response(200,json={'choices':[{'message':{'content':'bad' if len(calls)==1 else '{"ok":true}'}}]})
    assert asyncio.run(adapter(handler).test_connection())['ok']
    assert len(calls)==2
    assert 'hidden-key' not in json.dumps(calls)


@pytest.mark.parametrize('status,count,code',[(401,1,'model_auth'),(403,1,'model_auth'),(429,3,'model_busy'),(500,3,'model_busy'),(400,1,'model_request'),(302,1,'model_request')])
def test_http_error_retry_policy(status,count,code):
    calls=[]
    def handler(request):
        calls.append(request)
        return httpx.Response(status,json={'secret':'hidden-key'})
    with pytest.raises(AppError) as exc: asyncio.run(adapter(handler).test_connection())
    assert exc.value.code==code and len(calls)==count
    assert 'hidden-key' not in exc.value.message


def test_timeout_and_invalid_json_are_bounded():
    calls=[]
    def handler(request):
        calls.append(request);raise httpx.ReadTimeout('secret',request=request)
    with pytest.raises(AppError) as exc: asyncio.run(adapter(handler).test_connection())
    assert exc.value.code=='model_timeout' and len(calls)==3
    def malformed(request): return httpx.Response(200,json={'choices':[{'message':{'content':'{"wrong":true}'}}]})
    with pytest.raises(AppError) as exc: asyncio.run(adapter(malformed).test_connection())
    assert exc.value.code=='invalid_output'
