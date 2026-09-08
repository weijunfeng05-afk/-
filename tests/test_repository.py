"""Ensure a source checkout is reproducible and excludes local private data."""
import subprocess
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_private_and_generated_paths_are_ignored():
    paths=['.env','.env.local','data/app.sqlite3','data/files/resume.docx','.pnpm-store/cache','frontend/node_modules/example','frontend/dist/index.html','.qa/server.log','.venv/pyvenv.cfg']
    result=subprocess.run(['git','-c',f'safe.directory={ROOT.as_posix()}','check-ignore','-z','--stdin'],input=('\0'.join(paths)+'\0').encode(),capture_output=True,cwd=ROOT,check=True)
    assert set(result.stdout.decode().strip('\0').split('\0'))==set(paths)


def test_source_handoff_includes_setup_docs_and_lockfiles():
    for path in ['README.md','.env.example','requirements.lock','frontend/pnpm-lock.yaml','scripts/setup.ps1','scripts/start.ps1','scripts/verify.ps1','docs/template_baseline.json']:
        assert (ROOT/path).is_file(),path
    result=subprocess.run(['git','-c',f'safe.directory={ROOT.as_posix()}','check-ignore','.env.example'],capture_output=True,text=True,cwd=ROOT)
    assert result.returncode==1


def test_github_login_resolves_git_without_path():
    if os.name != 'nt':
        import pytest
        pytest.skip('Windows PowerShell login helper')
    powershell = Path(os.environ['SystemRoot'])/'System32/WindowsPowerShell/v1.0/powershell.exe'
    env = os.environ.copy()
    env['PATH'] = str(powershell.parent)
    result = subprocess.run([str(powershell), '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(ROOT/'scripts/github-login.ps1'), '-CheckOnly'], env=env, capture_output=True, text=True, cwd=ROOT, timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr
    assert 'git version ' in result.stdout
    assert 'Git executable:' in result.stdout
