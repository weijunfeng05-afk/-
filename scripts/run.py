"""Start the local, same-origin app and its managed async worker."""
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    from cryptography.fernet import Fernet
    import uvicorn
    if not (ROOT / 'frontend/dist/index.html').exists():
        raise SystemExit('Frontend build missing. Run scripts/setup.ps1 first.')
    env_path = ROOT / '.env'
    if not os.environ.get('RESUME_MASTER_KEY'):
        if not env_path.exists():
            # Exclusive creation prevents replacing a key during simultaneous starts.
            try:
                with env_path.open('x', encoding='utf-8') as f:
                    f.write('RESUME_MASTER_KEY=' + Fernet.generate_key().decode() + '\n')
            except FileExistsError:
                pass
        for line in env_path.read_text(encoding='utf-8-sig').splitlines():
            if line.startswith('RESUME_MASTER_KEY='):
                os.environ['RESUME_MASTER_KEY'] = line.partition('=')[2].strip()
    if not os.environ.get('RESUME_MASTER_KEY'):
        raise SystemExit('Set RESUME_MASTER_KEY in .env or the process environment.')
    port = int(os.environ.get('RESUME_PORT', '8000'))
    uvicorn.run('backend.app:create_app', factory=True, host='127.0.0.1', port=port, access_log=False, log_level='warning')


if __name__ == '__main__':
    main()
