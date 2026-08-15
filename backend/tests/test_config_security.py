from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.config import router as config_router


def test_llm_configuration_requires_an_authenticated_session():
    app = FastAPI()
    app.include_router(config_router, prefix="/api/config")

    with TestClient(app) as client:
        assert client.get("/api/config/llm").status_code == 401
        assert client.post(
            "/api/config/llm/providers",
            json={
                "name": "untrusted",
                "base_url": "https://example.invalid/v1",
                "model": "test",
                "api_key": "must-not-be-stored",
            },
        ).status_code == 401
