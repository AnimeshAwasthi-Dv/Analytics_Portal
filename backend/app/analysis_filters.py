"""Shared service families for job names and billing names from different portals."""
from sqlalchemy import func, or_

FAMILIES = ("X-Ray", "Special X-Ray", "CT", "MRI", "Mammography", "USG", "PET-CT")
PREFIXES = {
    "X-Ray": ("xray", "x ray", "xr", "chest x ray"),
    "Special X-Ray": ("special xray", "special x ray"),
    "CT": ("ct",),
    "MRI": ("mri", "mr"),
    "Mammography": ("mammography", "mammo", "mammogram"),
    "USG": ("usg", "ultrasound", "sonography"),
    "PET-CT": ("pet ct", "pet"),
}


def family_condition(column, family):
    normalized = func.lower(func.replace(func.replace(column, "-", " "), "_", " "))
    # Prefixes are application constants. Request text is never used as a SQL pattern.
    return or_(*[condition for prefix in PREFIXES[family]
                 for condition in (normalized == prefix, normalized.like(prefix + " %"))])
