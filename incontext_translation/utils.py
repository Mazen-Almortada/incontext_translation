from __future__ import annotations
import re
from typing import Dict, List, Tuple, Optional
import frappe

IDX_VER_KEY = "inctx_idx_ver:{lang}"
IDX_DATA_KEY = "inctx_idx_data:{lang}:{ver}"

_placeholder_re = re.compile(r"\{\d+\}")
_digits_re = re.compile(r"\d+", re.UNICODE)
_ws_re = re.compile(r"\s+", re.UNICODE)

def normalize_for_match(text: str) -> str:

    if not text:
        return ""
    i = 0
    def repl(_m):
        nonlocal i
        s = f"{{{i}}}"
        i += 1
        return s

    s = _digits_re.sub(repl, text.strip())
    s = _ws_re.sub(" ", s)
    return s

def _get_idx_version(lang: str) -> int:
    ver = frappe.cache().get_value(IDX_VER_KEY.format(lang=lang))
    return int(ver or 1)

def _bump_idx_version(lang: str) -> int:
    ver = _get_idx_version(lang) + 1
    frappe.cache().set_value(IDX_VER_KEY.format(lang=lang), ver)
    return ver

def _load_or_build_index(lang: str) -> Dict[str, List[str]]:

    ver = _get_idx_version(lang)
    cache_key = IDX_DATA_KEY.format(lang=lang, ver=ver)
    cached = frappe.cache().get_value(cache_key)
    if cached:
        return cached


    from frappe.translate import get_full_dict
    full = get_full_dict(lang) or {}

    idx: Dict[str, List[str]] = {}
    for en_src, tr in full.items():
        if not tr:
            continue
        n = normalize_for_match(tr)
        if not n:
            continue
        idx.setdefault(n, [])
        if en_src not in idx[n]:
            idx[n].append(en_src)

    frappe.cache().set_value(cache_key, idx)
    return idx

def invalidate_index(lang: str):
    _bump_idx_version(lang)

def get_field_label_source(doctype: str, fieldname: str) -> Optional[str]:

    if not (doctype and fieldname):
        return None
    try:
        meta = frappe.get_meta(doctype)
        df = meta.get_field(fieldname)
        if df and df.label:
            return str(df.label).strip()
    except Exception:
        pass
    return None

def find_english_source_from_displayed(displayed_text: str, lang: str) -> Tuple[List[str], str]:

    n = normalize_for_match(displayed_text)
    if not n:
        return ([], n)
    idx = _load_or_build_index(lang)
    cands = idx.get(n, [])
    return (cands, n)

def placeholders_set(s: str) -> List[str]:
    return sorted(set(_placeholder_re.findall(s or "")))

def check_placeholders_match(src: str, dst: str) -> Optional[str]:
    a = placeholders_set(src)
    b = placeholders_set(dst)
    if a != b:
        return f"Placeholders mismatch. Source: {', '.join(a) or '∅'} vs Translation: {', '.join(b) or '∅'}"
    return None
