"""Schemas for the Python learning compiler and code visualizer."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class CodeExecuteRequest(BaseModel):
    code: str = Field(min_length=1, max_length=10000)
    language: Literal["python"] = "python"
    include_ai_review: bool = False
    context: str = Field(default="", max_length=2000)


class CodeExerciseGenerateRequest(BaseModel):
    student_id: str = Field(min_length=1, max_length=64)
    learning_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    context_title: str = Field(default="今日学习内容", max_length=240)
    learning_context: str = Field(default="", max_length=6000)


class CodeExerciseSubmitRequest(BaseModel):
    student_id: str = Field(min_length=1, max_length=64)
    code: str = Field(min_length=1, max_length=10000)
    language: Literal["python"] = "python"


class CodeEligibilityRequest(BaseModel):
    code: str = Field(min_length=1, max_length=50000)
    language: Literal["python"] = "python"


class CodeVisualizationRestoreRequest(BaseModel):
    code: str = Field(min_length=1, max_length=10000)
    student_id: str = Field(min_length=1, max_length=64)
    resource_id: str = Field(min_length=1, max_length=180)


class CodeVisualizeRequest(BaseModel):
    code: str = Field(min_length=1, max_length=10000)
    language: Literal["python"] = "python"
    title: str = Field(default="代码运行演示", max_length=200)
    context: str = Field(default="", max_length=3000)
    student_id: str = Field(default="", max_length=64)
    resource_id: str = Field(default="", max_length=180)
