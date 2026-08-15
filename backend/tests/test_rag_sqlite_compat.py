import sys
import types

from app.services import rag


def test_old_system_sqlite_uses_packaged_compatibility_module_temporarily(monkeypatch):
    original_sqlite = sys.modules["sqlite3"]
    compatibility_module = types.ModuleType("pysqlite3")
    monkeypatch.setattr(rag.sqlite3, "sqlite_version_info", (3, 34, 1))
    monkeypatch.setitem(sys.modules, "pysqlite3", compatibility_module)

    with rag._chroma_sqlite_compat():
        assert sys.modules["sqlite3"] is compatibility_module

    assert sys.modules["sqlite3"] is original_sqlite
