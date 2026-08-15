"""Reusable prompt skills for the video generation agent."""

from app.agents.video_skills.garden_web_video_presentation import (
    GARDEN_SKILL_ID,
    load_garden_video_skill,
)

__all__ = ["GARDEN_SKILL_ID", "load_garden_video_skill"]
