import importlib.util
import json
import sqlite3
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location("demo_bundle", Path(__file__).parents[1] / "scripts/prepare_demo_bundle.py")
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


def test_demo_export_filters_accounts_children_and_sessions_without_mutating_source(tmp_path):
    source, target = tmp_path / "source.db", tmp_path / "export.db"
    with sqlite3.connect(source) as db:
        db.executescript("""
        CREATE TABLE user_accounts(id TEXT PRIMARY KEY, login TEXT, password_hash TEXT);
        CREATE TABLE user_sessions(token_hash TEXT, user_id TEXT);
        CREATE TABLE agent_runs(id TEXT PRIMARY KEY, owner_id TEXT);
        CREATE TABLE agent_run_events(event_id TEXT PRIMARY KEY, run_id TEXT, payload TEXT);
        CREATE TABLE procedure_skills(id TEXT PRIMARY KEY, owner_id TEXT);
        CREATE TABLE procedure_skill_versions(id TEXT PRIMARY KEY, skill_id TEXT);
        CREATE TABLE llm_provider_configs(id TEXT PRIMARY KEY, api_key TEXT);
        INSERT INTO user_accounts VALUES('demo', 'furia', 'existing hash'),('other', 'private', 'private hash');
        INSERT INTO user_sessions VALUES('old session', 'demo'),('private session','other');
        INSERT INTO agent_runs VALUES('run1','demo'),('run2','other');
        INSERT INTO agent_run_events VALUES('event1','run1','demo event'),('event2','run2','private event');
        INSERT INTO procedure_skills VALUES('skill1','demo'),('skill2','other'),('builtin','__system__');
        INSERT INTO procedure_skill_versions VALUES('v1','skill1'),('v2','skill2'),('v3','builtin');
        INSERT INTO llm_provider_configs VALUES('provider','test-only-secret');
        """)
    original = source.read_bytes()
    report = bundle.export_database(source, target, "furia")
    assert report["excluded_accounts"] == 1
    with sqlite3.connect(target) as db:
        assert db.execute("SELECT * FROM user_accounts").fetchall() == [('demo', 'furia', 'existing hash')]
        assert db.execute("SELECT count(*) FROM user_sessions").fetchone()[0] == 0
        assert db.execute("SELECT event_id FROM agent_run_events").fetchall() == [('event1',)]
        assert set(db.execute("SELECT id FROM procedure_skill_versions")) == {('v1',), ('v3',)}
        assert db.execute("SELECT api_key FROM llm_provider_configs").fetchone()[0] == 'test-only-secret'
    assert source.read_bytes() == original
    assert b'private hash' not in target.read_bytes()
    assert b'private event' not in target.read_bytes()
    with pytest.raises(ValueError, match="new file"):
        bundle.export_database(source, source, "furia")


def test_unknown_table_requires_ownership_review(tmp_path):
    source = tmp_path / 'source.db'
    with sqlite3.connect(source) as db:
        db.executescript("CREATE TABLE user_accounts(id TEXT,login TEXT); INSERT INTO user_accounts VALUES('demo','furia'); CREATE TABLE new_private_data(secret TEXT);")
    with pytest.raises(ValueError, match="new_private_data"):
        bundle.export_database(source, tmp_path / 'out.db', 'furia')


def test_media_export_copies_only_owned_files_and_relocates_video(tmp_path):
    source, output = tmp_path / 'media', tmp_path / 'export'
    (source / 'code_visualizations').mkdir(parents=True)
    (source / 'video_tasks/demo').mkdir(parents=True)
    (source / 'demo.mp4').write_bytes(b'demo-video')
    for owner in ['demo', 'private']:
        (source / f'code_visualizations/{owner}.json').write_text(json.dumps({'student_id':owner,'result':{'html':owner}}))
    (source / 'video_tasks/demo/progress.json').write_text(json.dumps({'student_id':'demo','file_path':str(source/'demo.mp4')}))
    exported = bundle.export_media(source, output, 'demo')
    assert len(exported) == 3
    assert not (output/'code_visualizations/private.json').exists()
    data = json.loads((output/'video_tasks/demo/progress.json').read_text())
    assert data['file_path'] == '__XUESHU_MEDIA_ROOT__/demo.mp4'
    assert (output/'demo.mp4').read_bytes() == b'demo-video'
