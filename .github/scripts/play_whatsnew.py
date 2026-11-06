"""Turn a Release Please changelog (stdin) into Google Play "What's new" text (stdout).

Play takes plain text of at most 500 characters, so this keeps the bullet points, drops scopes, commit links and
headings, and stops at the last bullet that fits.
"""

import re
import sys

LIMIT = 500
FALLBACK = "Bug fixes and improvements."


def bullets(markdown: str) -> list[str]:
    out = []
    for line in markdown.splitlines():
        m = re.match(r"^\s*[*-]\s+(.*)$", line)
        if not m:
            continue
        text = m.group(1)
        text = re.sub(r"^\*\*[^*]+:\*\*\s*", "", text)  # **scope:**
        text = re.sub(r"\s*\(\[[0-9a-f]{7,40}\]\([^)]*\)\)", "", text)  # ([abc1234](url))
        text = re.sub(r"\s*\(\[?#\d+\]?(\([^)]*\))?\)", "", text)  # (#12) or ([#12](url))
        text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)  # [text](url)
        text = text.replace("`", "").strip().rstrip(".")
        if text:
            out.append(f"• {text[0].upper()}{text[1:]}")
    return out


def whats_new(markdown: str) -> str:
    lines, length = [], 0
    for b in bullets(markdown):
        extra = len(b) + (1 if lines else 0)
        if length + extra > LIMIT:
            break
        lines.append(b)
        length += extra
    return "\n".join(lines) or FALLBACK


if __name__ == "__main__":
    print(whats_new(sys.stdin.read()))
