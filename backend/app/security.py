import hashlib


API_KEY_HASH_PREFIX = "sha256$"


def hash_api_key(value: str) -> str:
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()
    return f"{API_KEY_HASH_PREFIX}{digest}"


def is_api_key_hash(value: str) -> bool:
    prefix, separator, digest = value.partition("$")
    if prefix != API_KEY_HASH_PREFIX.rstrip("$") or not separator:
        return False
    return (
        len(digest) == 64
        and digest == digest.lower()
        and all(character in "0123456789abcdef" for character in digest)
    )
