"""
chat_agent.py — lightweight agent framework for chatbot skills.

This module adds a simple, extensible agent layer that can run skills/tools
before LLM generation and inject live context into the system prompt.
"""

import os
import re
import time
from dataclasses import dataclass
from typing import List

import requests


@dataclass
class SkillResult:
    skill_name: str
    used: bool
    context_block: str
    warning: str = ""


class BaseSkill:
    name = "base-skill"

    def can_handle(self, question: str) -> bool:
        raise NotImplementedError

    def run(self, question: str) -> SkillResult:
        raise NotImplementedError


class ArcGISServiceCatalogSkill(BaseSkill):
    """Fetches live ArcGIS REST service catalog info."""

    name = "arcgis-service-catalog"
    _CACHE_TTL_SECONDS = 300

    def __init__(self) -> None:
        self._cached_at = 0.0
        self._cached_payload = None

    def can_handle(self, question: str) -> bool:
        lowered = question.lower()
        trigger_words = (
            "arcgis",
            "service",
            "services",
            "layer",
            "layers",
            "folder",
            "rest",
            "gis.ecology.wa.gov",
        )
        return any(word in lowered for word in trigger_words)

    def _extract_terms(self, question: str) -> List[str]:
        words = re.findall(r"[a-zA-Z]{3,}", question.lower())
        stop = {
            "what", "which", "show", "list", "about", "with", "from", "that",
            "arcgis", "service", "services", "layer", "layers", "folder", "rest",
            "the", "and", "for", "are", "can", "you", "this", "have", "any",
        }
        terms = []
        for word in words:
            if word not in stop and word not in terms:
                terms.append(word)
            if len(terms) >= 6:
                break
        return terms

    def _fetch_catalog(self) -> dict:
        now = time.time()
        if self._cached_payload and (now - self._cached_at) < self._CACHE_TTL_SECONDS:
            return self._cached_payload

        base_url = os.environ.get(
            "ARCGIS_REST_SERVICES_URL",
            "https://gis.ecology.wa.gov/serverext/rest/services",
        ).strip()

        response = requests.get(
            base_url,
            params={"f": "pjson"},
            timeout=10,
        )
        response.raise_for_status()
        payload = response.json()

        self._cached_payload = payload
        self._cached_at = now
        return payload

    def run(self, question: str) -> SkillResult:
        try:
            payload = self._fetch_catalog()
            folders = payload.get("folders") or []
            services = payload.get("services") or []

            if not isinstance(folders, list):
                folders = []
            if not isinstance(services, list):
                services = []

            terms = self._extract_terms(question)
            matched_folders = []
            matched_services = []

            if terms:
                for folder in folders:
                    folder_text = str(folder).lower()
                    if any(term in folder_text for term in terms):
                        matched_folders.append(str(folder))

                for svc in services:
                    name = str((svc or {}).get("name", ""))
                    svc_type = str((svc or {}).get("type", ""))
                    target = f"{name} {svc_type}".lower()
                    if any(term in target for term in terms):
                        matched_services.append((name, svc_type))
            else:
                matched_folders = [str(f) for f in folders[:8]]
                matched_services = [
                    (str(s.get("name", "")), str(s.get("type", "")))
                    for s in services[:10]
                    if isinstance(s, dict)
                ]

            lines = [
                "ArcGIS REST services catalog (live):",
                f"- Source: {os.environ.get('ARCGIS_REST_SERVICES_URL', 'https://gis.ecology.wa.gov/serverext/rest/services')}",
                f"- Total folders: {len(folders)}",
                f"- Total root services: {len(services)}",
            ]

            if matched_folders:
                lines.append("- Matching folders: " + ", ".join(matched_folders[:12]))

            if matched_services:
                svc_text = ", ".join(
                    f"{name} ({svc_type})" for name, svc_type in matched_services[:15]
                )
                lines.append("- Matching services: " + svc_text)

            if not matched_folders and not matched_services and terms:
                lines.append("- No direct folder/service name match for the query terms.")

            return SkillResult(
                skill_name=self.name,
                used=True,
                context_block="\n".join(lines),
            )
        except Exception as exc:
            return SkillResult(
                skill_name=self.name,
                used=True,
                context_block="",
                warning=f"ArcGIS live catalog fetch failed: {exc}",
            )


class ChatAgent:
    """Simple orchestrator for running chat skills."""

    def __init__(self, skills: List[BaseSkill]) -> None:
        self.skills = skills

    def build_skill_context(self, question: str) -> str:
        blocks = []
        warnings = []

        for skill in self.skills:
            if not skill.can_handle(question):
                continue
            result = skill.run(question)
            if result.context_block:
                blocks.append(f"=== SKILL: {result.skill_name} ===\n{result.context_block}")
            if result.warning:
                warnings.append(f"[{result.skill_name}] {result.warning}")

        if warnings:
            print("[chat-agent] warnings:", " | ".join(warnings))

        return "\n\n".join(blocks)


def build_default_chat_agent() -> ChatAgent:
    return ChatAgent(skills=[ArcGISServiceCatalogSkill()])
