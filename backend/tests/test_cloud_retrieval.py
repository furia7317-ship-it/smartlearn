import json

import httpx
import numpy as np
import pytest

from app.core.config import settings
from app.services.cloud_retrieval import CloudEmbedder, CloudReranker, CloudRetrievalError


@pytest.fixture(autouse=True)
def cloud_config(monkeypatch):
    monkeypatch.setattr(settings, 'SILICONFLOW_API_KEY', 'private-test-value')
    monkeypatch.setattr(settings, 'SILICONFLOW_BASE_URL', 'https://api.siliconflow.cn/v1')
    monkeypatch.setattr(settings, 'EMBEDDING_DIMENSIONS', 2)
    monkeypatch.setattr(settings, 'RAG_CLOUD_MAX_RETRIES', 0)


def client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_embedding_batches_preserve_provider_indexes_and_normalize(monkeypatch):
    requests = []
    monkeypatch.setattr(settings, 'RAG_EMBEDDING_BATCH_SIZE', 2)
    def respond(request):
        body = json.loads(request.content)
        assert request.url.path == '/v1/embeddings'
        assert request.headers['authorization'] == 'Bearer private-test-value'
        assert body['model'] == 'Qwen/Qwen3-VL-Embedding-8B'
        assert body['dimensions'] == 2
        requests.extend(body['input'])
        return httpx.Response(200, json={'data': [
            {'index': i, 'embedding': [i + 1, 2]} for i in reversed(range(len(body['input'])))
        ]})
    result = CloudEmbedder(client=client(respond)).encode(['一', '二', '三'])
    assert requests == ['一', '二', '三']
    np.testing.assert_allclose(result[0], np.array([1, 2]) / np.sqrt(5))
    np.testing.assert_allclose(result[1], np.array([2, 2]) / np.sqrt(8))
    np.testing.assert_allclose(np.linalg.norm(result, axis=1), 1)


@pytest.mark.parametrize('rows', [
    [], [{'index': 1, 'embedding': [1, 2]}],
    [{'index': 0, 'embedding': [1]}], [{'index': 0, 'embedding': [0, 0]}],
    [{'index': 0, 'embedding': ['invalid', 2]}],
])
def test_embedding_rejects_invalid_response(rows):
    model = CloudEmbedder(client=client(lambda _: httpx.Response(200, json={'data': rows})))
    with pytest.raises(CloudRetrievalError):
        model.encode(['问题'])


def test_rerank_restores_input_order_and_does_not_rescale_scores():
    def respond(request):
        body = json.loads(request.content)
        assert request.url.path == '/v1/rerank'
        assert body == {'model': 'Qwen/Qwen3-VL-Reranker-8B', 'query': '问题',
                        'documents': ['无关', '相关'], 'top_n': 2, 'return_documents': False}
        return httpx.Response(200, json={'results': [
            {'index': 1, 'relevance_score': 0.9}, {'index': 0, 'relevance_score': 0.1}]})
    result = CloudReranker(client=client(respond)).predict([('问题', '无关'), ('问题', '相关')])
    np.testing.assert_allclose(result, [0.1, 0.9])


@pytest.mark.parametrize('rows', [[], [{'index': 1, 'relevance_score': 0.5}],
                                   [{'index': 0, 'relevance_score': None}]])
def test_rerank_rejects_malformed_candidates(rows):
    model = CloudReranker(client=client(lambda _: httpx.Response(200, json={'results': rows})))
    with pytest.raises(CloudRetrievalError):
        model.predict([('问题', '文档')])


def test_rate_limit_retry_is_bounded(monkeypatch):
    monkeypatch.setattr(settings, 'RAG_CLOUD_MAX_RETRIES', 1)
    monkeypatch.setattr('app.services.cloud_retrieval.time.sleep', lambda _: None)
    calls = []
    def respond(request):
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(429, headers={'Retry-After': '1'})
        return httpx.Response(200, json={'data': [{'index': 0, 'embedding': [1, 2]}]})
    assert CloudEmbedder(client=client(respond)).encode(['问题']).shape == (1, 2)
    assert len(calls) == 2


def test_authentication_error_never_exposes_provider_body_or_key():
    calls = []
    def respond(request):
        calls.append(request)
        return httpx.Response(401, text='private-test-value and private document')
    model = CloudEmbedder(client=client(respond))
    with pytest.raises(CloudRetrievalError, match='HTTP 401') as exc:
        model.encode(['私人文档'])
    assert 'private' not in str(exc.value)
    assert len(calls) == 1


def test_missing_key_fails_without_loading_a_local_model(monkeypatch):
    monkeypatch.setattr(settings, 'SILICONFLOW_API_KEY', '')
    with pytest.raises(CloudRetrievalError, match='SILICONFLOW_API_KEY'):
        CloudEmbedder()


def test_stale_knowledge_manifest_is_not_queried(monkeypatch):
    from app.services import rag
    monkeypatch.setattr(rag, '_read_manifest', lambda: {
        'active_collection': 'knowledge_old', 'embedding_model_identity': 'bge-legacy'})
    with pytest.raises(rag.RetrievalUnavailable, match='重建'):
        rag._active_collection_name('knowledge')


def test_legacy_personal_vectors_migrate_once_without_overwriting_newer_text(monkeypatch, tmp_path):
    from app.services import rag
    monkeypatch.setattr(settings, 'CHROMA_PERSIST_DIR', str(tmp_path / 'chroma'))
    rag.reset_rag_runtime()
    class FakeEmbedder:
        def encode(self, texts, **_kwargs):
            return np.tile([0.1, 0.2, 0.3], (len(texts), 1))
    monkeypatch.setattr(rag, '_get_embedder', lambda: FakeEmbedder())
    try:
        old = rag.get_or_create_collection('personal_test', resolve_active=False)
        old.upsert(ids=['one'], documents=['旧文本'], embeddings=[[0.1, 0.2]], metadatas=[{'source': 'one.md'}])
        current = rag.get_or_create_collection('personal_test')
        assert current.get(include=['documents'])['documents'] == ['旧文本']
        assert len(current.get(include=['embeddings'])['embeddings'][0]) == 3
        current.upsert(ids=['one'], documents=['新文本'], embeddings=[[0.2, 0.3, 0.4]])
        rag._migrated_collections.clear()
        assert rag.get_or_create_collection('personal_test').get(include=['documents'])['documents'] == ['新文本']
        assert old.get(include=['documents'])['documents'] == ['旧文本']
    finally:
        rag.reset_rag_runtime()


def test_forgetting_memory_deletes_legacy_and_cloud_versions_without_inference(monkeypatch, tmp_path):
    from app.services import episodic_memory_index, rag
    monkeypatch.setattr(settings, 'CHROMA_PERSIST_DIR', str(tmp_path / 'forget'))
    monkeypatch.setattr(settings, 'SILICONFLOW_API_KEY', '')
    rag.reset_rag_runtime()
    try:
        names = ['memory_episodes_v1', 'memory_episodes_v1_cloud']
        for name in names:
            col = rag.get_or_create_collection(name, resolve_active=False)
            col.upsert(ids=['a', 'b'], documents=['本人内容', '他人内容'], embeddings=[[1, 0], [0, 1]],
                       metadatas=[{'student_id': 'a'}, {'student_id': 'b'}])
        episodic_memory_index._delete_student('a')
        for name in names:
            assert rag.get_or_create_collection(name, resolve_active=False).get()['ids'] == ['b']
    finally:
        rag.reset_rag_runtime()
