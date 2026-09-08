"""Render entrypoint: one API/worker process backed by a persistent disk."""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

if __name__ == '__main__':
    import uvicorn
    if os.environ.get('RESUME_CLOUD') != '1':
        raise SystemExit('RESUME_CLOUD must be 1 for the cloud entrypoint.')
    uvicorn.run('backend.app:create_app', factory=True, host='0.0.0.0',
                port=int(os.environ.get('PORT', '10000')), workers=1, access_log=False)
