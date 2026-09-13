#!/usr/bin/env python3
"""PreToolUse guard. Blocks writes, edits and shell commands that touch secrets.

Exit 2 tells Claude Code to deny the tool call before it reaches disk.
"""
import json
import re
import sys

SECRET_PATH_PATTERNS = [
    r"(^|/)\.env$",
    r"(^|/)\.env\.(?!example$)[^/]+$",
    r"\.pem$",
    r"\.p12$",
    r"\.pfx$",
    r"\.key$",
    r"\.keystore$",
    r"\.jks$",
    r"\.cer$",
    r"\.crt$",
    r"\.der$",
    r"\.mobileprovision$",
    r"\.provisionprofile$",
    r"\.certSigningRequest$",
    r"(^|/)credentials\.json$",
    r"(^|/)secrets\.json$",
    r"(^|/)google-services\.json$",
    r"(^|/)GoogleService-Info\.plist$",
    r"(^|/)\.netrc$",
    r"(^|/)id_rsa",
    r"(^|/)id_ed25519",
    r"\.sqlite3?$",
    r"\.db$",
    r"\.dump$",
    r"\.sql\.gz$",
]

SECRET_CONTENT_PATTERNS = [
    (r"-----BEGIN [A-Z ]*PRIVATE KEY-----", "private key block"),
    (r"-----BEGIN CERTIFICATE-----", "certificate block"),
    (r"\bAKIA[0-9A-Z]{16}\b", "aws access key id"),
    (r"\bASIA[0-9A-Z]{16}\b", "aws temporary key id"),
    (r"\bgh[pousr]_[A-Za-z0-9]{20,}", "github token"),
    (r"\bgithub_pat_[A-Za-z0-9_]{20,}", "github fine-grained token"),
    (r"\bxox[abprs]-[A-Za-z0-9-]{10,}", "slack token"),
    (r"\bsk-[A-Za-z0-9_-]{20,}", "openai-style api key"),
    (r"\bsk-ant-[A-Za-z0-9_-]{20,}", "anthropic api key"),
    (r"\bAIza[0-9A-Za-z_-]{35}\b", "google api key"),
    (r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}", "jwt"),
]

PLACEHOLDER = re.compile(
    r"(process\.env|import\.meta\.env|os\.environ|\$\{|\$[A-Z_]|<[^>]+>|xxx|your[_-]|changeme|placeholder|example|dummy|fake|redacted|\*{4,})",
    re.I,
)
ASSIGNMENT = re.compile(
    r"\b([A-Za-z_]*(?:API[_-]?KEY|SECRET|PASSWORD|PASSWD|TOKEN|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|CLIENT[_-]?SECRET|AUTH[_-]?TOKEN))\b\s*[:=]\s*[\"']([^\"']{12,})[\"']",
    re.I,
)

# Files that stay local: SPEC.md carries personal health data (CLAUDE.md, security section).
NEVER_COMMIT = [r"(^|/)SPEC\.md$"]

# A path pattern anchored with $ matches a whole filename. Inside a shell command the
# filename is followed by more text, so both anchors become token boundaries instead.
TOKEN_END = r"(?=$|[\s'\";|&)>,])"


def as_command_pattern(pattern):
    return pattern.replace("(^|/)", r"(?:^|[\s/=:'\"])").replace("$", TOKEN_END)


COMMAND_PATH_PATTERNS = [as_command_pattern(p) for p in SECRET_PATH_PATTERNS + NEVER_COMMIT]

# A filename inside a heredoc body is prose being written, not a file being touched.
# Strip those bodies before scanning for paths; content scanning still sees them.
HEREDOC_BODY = re.compile(r"<<-?\s*['\"]?(\w+)['\"]?\n.*?\n\1", re.S)

GIT_STAGING = re.compile(r"\bgit\s+(add|commit|stash\s+push|update-index)\b")
GIT_FORCE_ADD = re.compile(r"\bgit\s+add\b[^\n;&|]*\s(-f|--force)\b")


def deny(reason):
    print("BLOCKED by .claude/hooks/block-secrets.py: " + reason, file=sys.stderr)
    sys.exit(2)


def check_path(path, where):
    for pattern in SECRET_PATH_PATTERNS:
        if re.search(pattern, path, re.I):
            deny(f"{where} touches a credential or database file ({path}). "
                 "Secrets live in environment variables on the ingestion server, never in this repo.")
    for pattern in NEVER_COMMIT:
        if re.search(pattern, path):
            deny(f"{where} touches {path}, which must stay local and out of git.")


def check_content(text, where):
    for pattern, label in SECRET_CONTENT_PATTERNS:
        if re.search(pattern, text):
            deny(f"{where} contains what looks like a {label}.")
    for match in ASSIGNMENT.finditer(text):
        if not PLACEHOLDER.search(match.group(2)):
            deny(f"{where} assigns a literal value to {match.group(1)}.")


def main():
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        deny(f"could not parse hook payload: {exc}")

    tool = payload.get("tool_name", "")
    tool_input = payload.get("tool_input", {}) or {}

    if tool in ("Write", "Edit", "NotebookEdit", "MultiEdit"):
        path = tool_input.get("file_path") or tool_input.get("notebook_path") or ""
        check_path(path, f"{tool} to {path}" if path else tool)
        for field in ("content", "new_string", "new_source"):
            value = tool_input.get(field)
            if isinstance(value, str) and value:
                check_content(value, f"{tool} to {path}")
        for edit in tool_input.get("edits", []) or []:
            value = edit.get("new_string")
            if isinstance(value, str) and value:
                check_content(value, f"{tool} to {path}")

    elif tool == "Bash":
        command = tool_input.get("command", "") or ""
        if GIT_FORCE_ADD.search(command):
            deny("git add -f bypasses .gitignore, which is the only thing keeping "
                 "secrets and SPEC.md out of a public repo.")
        paths_only = HEREDOC_BODY.sub("<<STRIPPED", command)
        for pattern in COMMAND_PATH_PATTERNS:
            if re.search(pattern, paths_only, re.I):
                if GIT_STAGING.search(paths_only) or re.search(r">>?|tee\b|cp\b|mv\b|install\b", paths_only):
                    deny(f"command writes or stages a protected file: {command}")
        check_content(command, "Bash command")

    sys.exit(0)


if __name__ == "__main__":
    main()
