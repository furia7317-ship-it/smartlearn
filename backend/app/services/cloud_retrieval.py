"""SiliconFlow HTTP clients for embedding and reranking, without local inference."""

from __future__ import annotations

import math
import time
from typing import Any
from urllib.parse import urlsplit

import httpx
import numpy as np

from app.core.config import settings


class CloudRetrievalError(RuntimeError):
    """A safe provider error; never includes request bodies or credentials."""


def embedding_identity() -> str:
    # Credentials must never enter index manifests. The vector space depends
    # on the provider/model/dimensions, not on the account used to call it.
    return f"siliconflow:{settings.SILICONFLOW_BASE_URL.rstrip('/')}:{settings.EMBEDDING_MODEL}:{settings.EMBEDDING_DIMENSIONS}"


class _CloudClient:
    def __init__(self, *, client: httpx.Client | None = None):
        self.base_url = settings.SILICONFLOW_BASE_URL.strip().rstrip('/')
        parsed = urlsplit(self.base_url)
        if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise CloudRetrievalError('SILICONFLOW_BASE_URL 必须是无凭据的 HTTPS 接口地址')
        self._key = settings.SILICONFLOW_API_KEY.strip()
        if not self._key:
            raise CloudRetrievalError('请在服务私有配置中设置 SILICONFLOW_API_KEY')
        self._client = client or httpx.Client(
            timeout=httpx.Timeout(settings.RAG_CLOUD_TIMEOUT_SECONDS, connect=10.0),
            follow_redirects=False,
        )

    def close(self) -> None:
        self._client.close()

    def _post(self, endpoint: str, payload: dict[str, Any]) -> dict[str, Any]:
        attempts = max(1, min(4, int(settings.RAG_CLOUD_MAX_RETRIES) + 1))
        failure = '网络连接失败'
        for attempt in range(attempts):
            delay = min(2 ** attempt, 4)
            try:
                response = self._client.post(
                    f'{self.base_url}/{endpoint}', json=payload,
                    headers={'Authorization': f'Bearer {self._key}'},
                )
                if response.status_code == 200:
                    try:
                        data = response.json()
                    except ValueError:
                        raise CloudRetrievalError(f'云端 {endpoint} 返回了无效 JSON') from None
                    if not isinstance(data, dict):
                        raise CloudRetrievalError(f'云端 {endpoint} 返回结构无效')
                    return data
                status = response.status_code
                failure = f'HTTP {status}'
                if status not in (408, 429, 500, 502, 503, 504):
                    raise CloudRetrievalError(f'云端 {endpoint} 请求失败（{failure}）')
                try:
                    delay = min(10.0, max(delay, float(response.headers.get('Retry-After', 0))))
                except ValueError:
                    pass
            except (httpx.TimeoutException, httpx.TransportError):
                failure = '连接超时或网络不可用'
            if attempt + 1 < attempts:
                time.sleep(delay)
        raise CloudRetrievalError(f'云端 {endpoint} 请求失败（{failure}），请稍后重试') from None


class CloudEmbedder(_CloudClient):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.model = settings.EMBEDDING_MODEL.strip()
        if not self.model:
            raise CloudRetrievalError('未配置云端嵌入模型')
        self.dimensions = int(settings.EMBEDDING_DIMENSIONS)
        self.available = False

    def encode(self, texts: list[str], *, normalize_embeddings: bool = True) -> np.ndarray:
        if not texts:
            return np.empty((0, self.dimensions), dtype=np.float32)
        if any(not isinstance(text, str) or not text.strip() for text in texts):
            raise CloudRetrievalError('嵌入内容必须是非空文本')
        batch_size = max(1, min(32, int(settings.RAG_EMBEDDING_BATCH_SIZE)))
        vectors: list[list[float]] = []
        self.available = False
        for offset in range(0, len(texts), batch_size):
            batch = texts[offset:offset + batch_size]
            data = self._post('embeddings', {
                'model': self.model, 'input': batch,
                'encoding_format': 'float', 'dimensions': self.dimensions,
            })
            rows = data.get('data')
            if not isinstance(rows, list) or len(rows) != len(batch):
                raise CloudRetrievalError('云端嵌入返回数量与输入不一致')
            ordered: dict[int, list[float]] = {}
            for row in rows:
                if not isinstance(row, dict):
                    raise CloudRetrievalError('云端嵌入返回条目无效')
                index, vector = row.get('index'), row.get('embedding')
                if type(index) is not int or not 0 <= index < len(batch) or index in ordered:
                    raise CloudRetrievalError('云端嵌入返回索引无效')
                if not isinstance(vector, list) or len(vector) != self.dimensions:
                    raise CloudRetrievalError('云端嵌入向量维度与配置不一致')
                if any(type(v) not in (int, float) or not math.isfinite(v) for v in vector):
                    raise CloudRetrievalError('云端嵌入包含无效数值')
                ordered[index] = vector
            vectors.extend(ordered[i] for i in range(len(batch)))
        values = np.asarray(vectors, dtype=np.float32)
        norms = np.linalg.norm(values, axis=1, keepdims=True)
        if not np.all(np.isfinite(norms)) or np.any(norms <= 0):
            raise CloudRetrievalError('云端嵌入返回无效零向量')
        self.available = True
        return values / norms if normalize_embeddings else values


class CloudReranker(_CloudClient):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.model = settings.RAG_RERANKER_MODEL.strip()
        if not self.model:
            raise CloudRetrievalError('未配置云端重排序模型')
        self.available = False

    def predict(self, pairs: list[tuple[str, str]]) -> np.ndarray:
        if not pairs:
            return np.empty(0, dtype=np.float32)
        query = pairs[0][0]
        if not query.strip() or any(q != query or not text.strip() for q, text in pairs):
            raise CloudRetrievalError('重排序需要同一非空问题和非空候选文本')
        self.available = False
        data = self._post('rerank', {
            'model': self.model, 'query': query,
            'documents': [text for _, text in pairs],
            'top_n': len(pairs), 'return_documents': False,
        })
        rows = data.get('results')
        if not isinstance(rows, list) or len(rows) != len(pairs):
            raise CloudRetrievalError('云端重排序返回数量与候选数量不一致')
        scores: dict[int, float] = {}
        for row in rows:
            if not isinstance(row, dict):
                raise CloudRetrievalError('云端重排序返回条目无效')
            index, score = row.get('index'), row.get('relevance_score')
            if type(index) is not int or not 0 <= index < len(pairs) or index in scores:
                raise CloudRetrievalError('云端重排序返回索引无效')
            if type(score) not in (float, int) or not math.isfinite(score):
                raise CloudRetrievalError('云端重排序返回分数无效')
            scores[index] = float(score)
        self.available = True
        return np.asarray([scores[i] for i in range(len(pairs))], dtype=np.float32)
