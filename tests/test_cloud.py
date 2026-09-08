import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from backend.app import create_app


def configure(monkeypatch, tmp_path):
    for key, value in {'RESUME_CLOUD':'1','RESUME_ACCESS_TOKEN':'a'*40,
        'RESUME_FRONTEND_ORIGIN':'https://resume.netlify.app',
        'RESUME_ALLOWED_HOST':'resume.onrender.com','RESUME_DATA_DIR':str(tmp_path),
        'RESUME_MASTER_KEY':Fernet.generate_key().decode()}.items():
        monkeypatch.setenv(key,value)


def test_cloud_refuses_incomplete_config(monkeypatch, tmp_path):
    configure(monkeypatch,tmp_path)
    monkeypatch.setenv('RESUME_ACCESS_TOKEN','short')
    with pytest.raises(RuntimeError):
        create_app(worker_enabled=False)


def test_cloud_auth_cors_and_persistent_store(monkeypatch, tmp_path):
    configure(monkeypatch,tmp_path)
    app=create_app(worker_enabled=False)
    headers={'Authorization':'Bearer '+'a'*40,'Origin':'https://resume.netlify.app'}
    with TestClient(app,base_url='https://resume.onrender.com') as client:
        assert client.get('/api/health').status_code==200
        for path in ['/api/jobs','/api/model-config','/api/resumes/any/file','/api/resumes/any/history?job_id=x']:
            assert client.get(path).status_code==401
        assert client.get('/api/jobs',headers={'Authorization':'Bearer wrong'}).status_code==401
        good=client.get('/api/jobs',headers=headers)
        assert good.status_code==200
        assert good.headers['access-control-allow-origin']=='https://resume.netlify.app'
        assert client.get('/api/jobs',headers={**headers,'Origin':'https://evil.example'}).status_code==403
        preflight=client.options('/api/jobs',headers={'Origin':headers['Origin'],'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'})
        assert preflight.status_code==200
        assert client.post('/api/jobs',headers=headers,json={'name':'Cloud saved job'}).status_code==201
    with TestClient(create_app(worker_enabled=False),base_url='https://resume.onrender.com') as client:
        assert client.get('/api/jobs',headers=headers).json()[0]['name']=='Cloud saved job'
