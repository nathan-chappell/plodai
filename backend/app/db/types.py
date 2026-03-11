"""Legacy module kept only for import stability.

Password hashes are stored as plain strings in the SQLAlchemy model and are
produced by passlib's bcrypt context in auth_service.py.
"""
