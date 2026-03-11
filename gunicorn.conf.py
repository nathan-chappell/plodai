from pathlib import Path

bind = "0.0.0.0:8000"
workers = 2
worker_class = "uvicorn.workers.UvicornWorker"
timeout = 120
accesslog = "-"
errorlog = "-"

_cert_dir = Path(__file__).resolve().parent / "backend" / "dev-certs"
_cert_file = _cert_dir / "dev-cert.pem"
_key_file = _cert_dir / "dev-key.pem"

if _cert_file.exists() and _key_file.exists():
    certfile = str(_cert_file)
    keyfile = str(_key_file)
