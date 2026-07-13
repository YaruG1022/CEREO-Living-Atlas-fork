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
from urllib.parse import quote

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
        # endpoint_key -> (timestamp, payload)
        self._cache = {}

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

    def _base_url(self) -> str:
        return os.environ.get(
            "ARCGIS_REST_SERVICES_URL",
            "https://gis.ecology.wa.gov/serverext/rest/services",
        ).strip().rstrip("/")

    def _fetch_json(self, endpoint_key: str, url: str) -> dict:
        now = time.time()
        cached = self._cache.get(endpoint_key)
        if cached and (now - cached[0]) < self._CACHE_TTL_SECONDS:
            return cached[1]

        response = requests.get(url, params={"f": "pjson"}, timeout=10)
        response.raise_for_status()
        payload = response.json()
        self._cache[endpoint_key] = (now, payload)
        return payload

    def _fetch_root_catalog(self) -> dict:
        return self._fetch_json("root", self._base_url())

    def _fetch_folder_catalog(self, folder: str) -> dict:
        safe_folder = "/".join(quote(part, safe="") for part in folder.split("/"))
        return self._fetch_json(f"folder:{folder}", f"{self._base_url()}/{safe_folder}")

    def _pick_folder_targets(self, question: str, folders: List[str], terms: List[str]) -> List[str]:
        lowered = question.lower()
        folder_targets = []

        for folder in folders:
            f_lower = str(folder).lower()
            explicit = (
                f"folder {f_lower}" in lowered
                or f"in {f_lower}" in lowered
                or f"under {f_lower}" in lowered
            )
            by_term = terms and any(term in f_lower for term in terms)
            if explicit or by_term:
                folder_targets.append(str(folder))

        if not folder_targets and folders:
            # If the user asks for folder details but didn't provide a valid name,
            # probe a couple of folders as examples.
            if "folder" in lowered or "folders" in lowered:
                folder_targets = [str(folders[0])]

        return folder_targets[:3]

    def run(self, question: str) -> SkillResult:
        try:
            payload = self._fetch_root_catalog()
            folders = payload.get("folders") or []
            services = payload.get("services") or []

            if not isinstance(folders, list):
                folders = []
            if not isinstance(services, list):
                services = []

            terms = self._extract_terms(question)
            matched_folders = []
            matched_services = []
            source_snippets = []

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

            folder_targets = self._pick_folder_targets(
                question,
                [str(f) for f in folders],
                terms,
            )
            folder_drill_blocks = []

            for folder in folder_targets:
                try:
                    folder_payload = self._fetch_folder_catalog(folder)
                    folder_services = folder_payload.get("services") or []
                    if not isinstance(folder_services, list):
                        folder_services = []

                    matched_folder_services = []
                    for svc in folder_services:
                        if not isinstance(svc, dict):
                            continue
                        name = str(svc.get("name", ""))
                        svc_type = str(svc.get("type", ""))
                        target = f"{name} {svc_type}".lower()
                        if not terms or any(term in target for term in terms):
                            matched_folder_services.append((name, svc_type))

                    preview = matched_folder_services[:10]
                    if preview:
                        rendered = ", ".join(f"{n} ({t})" for n, t in preview)
                        folder_drill_blocks.append(
                            f"- Folder '{folder}' matching services ({len(matched_folder_services)}): {rendered}"
                        )

                        source_snippets.append(
                            f"[ArcGIS live catalog] folder endpoint: {self._base_url()}/{folder}"
                        )
                        first_name, first_type = preview[0]
                        source_snippets.append(
                            f"[ArcGIS live catalog] matched service in folder '{folder}': {first_name} ({first_type})"
                        )
                    else:
                        folder_drill_blocks.append(
                            f"- Folder '{folder}' has no direct service match for the query terms."
                        )
                except Exception as folder_exc:
                    folder_drill_blocks.append(
                        f"- Folder '{folder}' drill-down request failed: {folder_exc}"
                    )

            lines = [
                "ArcGIS REST services catalog (live):",
                f"- Source: {os.environ.get('ARCGIS_REST_SERVICES_URL', 'https://gis.ecology.wa.gov/serverext/rest/services')}",
                f"- Total folders: {len(folders)}",
                f"- Total root services: {len(services)}",
            ]
            source_snippets.append(
                f"[ArcGIS live catalog] root endpoint: {self._base_url()}"
            )

            if matched_folders:
                lines.append("- Matching folders: " + ", ".join(matched_folders[:12]))
                source_snippets.append(
                    "[ArcGIS live catalog] matched folders: " + ", ".join(matched_folders[:8])
                )

            if matched_services:
                svc_text = ", ".join(
                    f"{name} ({svc_type})" for name, svc_type in matched_services[:15]
                )
                lines.append("- Matching services: " + svc_text)
                first_root_name, first_root_type = matched_services[0]
                source_snippets.append(
                    f"[ArcGIS live catalog] matched root service: {first_root_name} ({first_root_type})"
                )

            if folder_targets:
                lines.append("- Drill-down folders queried: " + ", ".join(folder_targets))
                lines.extend(folder_drill_blocks)

            if not matched_folders and not matched_services and terms:
                lines.append("- No direct folder/service name match for the query terms.")

            if source_snippets:
                lines.append("- Structured source snippets:")
                for snippet in source_snippets[:8]:
                    lines.append(f"  - {snippet}")

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
