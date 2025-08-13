from __future__ import annotations
import frappe
from frappe import _
from typing import Optional, Dict, Any, List
from .utils import (
    get_field_label_source, find_english_source_from_displayed,
    check_placeholders_match, invalidate_index
)
from deep_translator import GoogleTranslator

def _force_context_dict(raw) -> Dict[str, Any]:
    if not raw:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8", errors="ignore")
    if isinstance(raw, str):
        for _ in range(2):
            try:
                parsed = frappe.parse_json(raw)
            except Exception:
                parsed = None
            if isinstance(parsed, dict):
                return parsed
            if isinstance(parsed, str) and parsed != raw:
                raw = parsed
                continue
            break
        return {}
    return {}

def _lookup_existing_translation(lang: str, source_text: str, context: Optional[str]) -> Optional[str]:
    if context:
        name = frappe.db.get_value("Translation",
                                   {"language": lang, "source_text": source_text, "context": context},
                                   "name")
        if name:
            return frappe.db.get_value("Translation", name, "translated_text")

    name = frappe.db.get_value("Translation",
                               {"language": lang, "source_text": source_text},
                               "name")
    if name:
        return frappe.db.get_value("Translation", name, "translated_text")
    return None

@frappe.whitelist()
def resolve_source_and_existing(displayed, context=None, target_lang="ar"):

    try:
        ctx = _force_context_dict(context)
        doctype = (ctx.get("doctype") or "").strip() or None
        fieldname = (ctx.get("fieldname") or "").strip() or None
        route = (ctx.get("route") or "").strip() or None

        displayed = (displayed or "").strip()

        src = None
        if doctype and fieldname:
            src = get_field_label_source(doctype, fieldname)

        candidates: List[str] = []
        normalized_displayed = ""
        if not src and displayed:
            candidates, normalized_displayed = find_english_source_from_displayed(displayed, target_lang)
            if len(candidates) == 1:
                src = candidates[0]

        existing = None
        if src:
            existing = _lookup_existing_translation(target_lang, src, route)

        return {
            "source": src,
            "candidates": candidates,
            "normalized_displayed": normalized_displayed,
            "existing": existing,
            "lang": target_lang,
            "route": route,
        }
    except Exception:
        frappe.log_error(frappe.get_traceback(), "inctx: resolve_source_and_existing")
        return {
            "source": None,
            "candidates": [],
            "normalized_displayed": "",
            "existing": None,
            "lang": target_lang,
            "route": None,
        }

@frappe.whitelist()
def suggest_translation(source_text: str, target_lang: str) -> str:
    if not source_text or not target_lang:
        return ""
    try:
        return GoogleTranslator(source='auto', target=target_lang).translate(source_text)
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "In-Context Translation Suggestion Failed")
        return ""
    
@frappe.whitelist()
def save_custom_translation(language: str, source_text: str, translated_text: str, context: str = ""):
    frappe.only_for(("System Manager", "Translation Editor"))

    if not (language and source_text and translated_text):
        frappe.throw(_("language, source_text and translated_text are required"))

    msg = check_placeholders_match(source_text, translated_text)
    if msg:
        frappe.throw(_(msg))

    filters = {"language": language, "source_text": source_text}
    if context:
        filters["context"] = context

    existing = frappe.get_all("Translation", filters=filters, pluck="name", limit_page_length=1)
    if existing:
        doc = frappe.get_doc("Translation", existing[0])
        doc.translated_text = translated_text
        if context:
            doc.context = context
        doc.save()
    else:
        doc = frappe.get_doc({
            "doctype": "Translation",
            "language": language,
            "source_text": source_text,
            "translated_text": translated_text,
            "context": context or None
        })
        doc.insert()

    frappe.db.commit()
    invalidate_index(language)
    frappe.publish_realtime("translation_updated", {"lang": language, "source": source_text})
