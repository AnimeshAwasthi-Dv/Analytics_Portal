"""Normalize recognized modality codes without guessing from loose substrings."""

from __future__ import annotations

import re


MODALITY_CATEGORIES = (
    "X-Ray",
    "Special X-Ray",
    "CT",
    "MRI",
    "Mammography",
    "PET-CT",
    "USG",
    "SR",
)

_DIRECT_CODES = {
    "CR": "X-Ray",
    "CRI": "X-Ray",
    "DX": "X-Ray",
    "DR": "X-Ray",
    "XR": "X-Ray",
    "X": "X-Ray",
    "RAD": "X-Ray",
    "RADIOGRAPHY": "X-Ray",
    "RF": "Special X-Ray",
    "XRF": "Special X-Ray",
    "XA": "Special X-Ray",
    "FL": "Special X-Ray",
    "CT": "CT",
    "CATSCAN": "CT",
    "COMPUTED TOMOGRAPHY": "CT",
    "MR": "MRI",
    "MRI": "MRI",
    "MAGNETIC RESONANCE": "MRI",
    "US": "USG",
    "USG": "USG",
    "ULTRASOUND": "USG",
    "SONOGRAPHY": "USG",
    "MG": "Mammography",
    "MAMMO": "Mammography",
    "MAMMOGRAM": "Mammography",
    "MAMMOGRAPHY": "Mammography",
    "PT": "PET-CT",
    "PET": "PET-CT",
    "PET-CT": "PET-CT",
    "NM": "PET-CT",
    "SR": "SR",
    "STRUCTURED REPORT": "SR",
}

_SPECIAL_XRAY_INVESTIGATIONS = (
    "BARIUM SWALLOW",
    "BARIUM ENEMA",
    "MCU",
    "URETHROGRAM",
    "CYSTOURETHROGRAM",
    "GENITOURETHROGRAM",
    "FLUORO",
    "FLUOROSCOPY",
    "IVU",
    "CONTRAST SWALLOW",
    "FISTULOGRAM",
    "DYE STUDY",
    "ANGIOGRAPHY",
    "ANGIOGRAM",
)


def _clean(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().upper())


def normalize_modality(value: object, description: object = None) -> str | None:
    """Return a supported category only when the code/name is recognizable.

    CT, MRI and ultrasound are resolved from the modality field itself. Their
    appearance inside a longer study description is not enough to classify it.
    """
    raw = _clean(value)
    direct = _DIRECT_CODES.get(raw)
    if direct:
        return direct

    # Source modality fields can contain a comma-separated list (for example
    # ``CT, SR``). Treat only complete tokens as modality codes.
    tokens = [token.strip() for token in re.split(r"[,;|]+", raw) if token.strip()]
    token_categories = [_DIRECT_CODES[token] for token in tokens if token in _DIRECT_CODES]
    if token_categories:
        # For a study with an imaging modality plus SR, use the imaging type.
        return next((category for category in token_categories if category != "SR"), token_categories[0])

    # Accept common code-prefixed modality values from service type fields,
    # while requiring a delimiter after the code (so MCT is not mistaken for CT).
    for code, category in (("CT", "CT"), ("MR", "MRI"), ("MRI", "MRI"), ("US", "USG"), ("USG", "USG")):
        if re.match(rf"^{code}(?:\s*[-/:]\s*|\s+)", raw):
            return category

    # MCT is ambiguous in the supplied source rules, so it is deliberately not
    # classified as X-ray or CT without an explicit source mapping.
    if re.search(r"\bMCT\b", raw):
        return None

    text = _clean(description)
    if text in _DIRECT_CODES:
        return _DIRECT_CODES[text]
    if text in {"X-RAY", "XRAY", "X RAY"}:
        return "X-Ray"
    if any(
        text == exam or text.startswith(exam + " ") or text.startswith(exam + " -")
        for exam in _SPECIAL_XRAY_INVESTIGATIONS
    ):
        return "Special X-Ray"
    return None
