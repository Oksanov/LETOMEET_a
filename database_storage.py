"""SQLite storage selection. Does not copy or overwrite existing databases."""
from pathlib import Path
import os
from sqlalchemy.engine import make_url


def resolve_storage(database_url, instance_path, environ=None):
    env = os.environ if environ is None else environ
    original = database_url or "sqlite:///school.db"
    if original.startswith("postgres://"):
        original = original.replace("postgres://", "postgresql://", 1)
    parsed = make_url(original)
    if parsed.get_backend_name() != "sqlite":
        return original, None
    if not parsed.database or parsed.database == ":memory:":
        return original, None

    explicit_root = env.get("LETOMEET_DATA_DIR", "").strip()
    # /data must already be mounted by the host; never manufacture that directory.
    root = Path(explicit_root) if explicit_root else (
        Path("/data") if not env.get("VERCEL") and Path("/data").is_dir() else None
    )
    if root is not None:
        if not root.is_absolute() or not root.is_dir():
            raise RuntimeError("LETOMEET_DATA_DIR must be an existing absolute persistent-storage directory")
        root = root.resolve()

    configured = Path(parsed.database)
    old_path = configured if configured.is_absolute() else Path(instance_path) / configured
    old_path = old_path.resolve()
    legacy_paths = {(Path(instance_path) / "school.db").resolve(), Path("/app/instance/school.db")}
    if root is None:
        return original, None

    target = root / "school.db"
    if old_path != target and old_path not in legacy_paths:
        if not explicit_root:
            return original, None
        # Do not silently replace a separately configured SQLite database.
        raise RuntimeError(
            "SQLite DATABASE_URL points outside the persistent school.db location. "
            "Back up the actual database, then set DATABASE_URL=sqlite:///" + target.as_posix()
        )
    if not os.access(root, os.W_OK):
        raise RuntimeError("Persistent-storage directory is not writable")
    return parsed.set(database=target.as_posix()).render_as_string(hide_password=False), root
