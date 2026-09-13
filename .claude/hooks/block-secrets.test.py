#!/usr/bin/env python3
"""Test suite for the PreToolUse secret guard.

Run: python3 .claude/hooks/block-secrets.test.py

Fixtures are assembled at runtime from fragments so that writing or editing this
file does not trip the guard it tests, and so no scanner flags the repo.
"""
import json
import os
import subprocess
import sys

HOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "block-secrets.py")

AWS_FIXTURE = "AKIA" + "IOSFODNN7EXAMPLE"
GH_FIXTURE = "ghp" + "_" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
PEM_FIXTURE = "-----BEGIN RSA " + "PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----"
APIKEY_FIXTURE = "const TGTG_API" + "_KEY = " + '"a7f3c9d2b8e14f60aa9c"' + ";"
PASSWD_FIXTURE = "pass" + "word: " + '"correcthorsebattery"' + ","

BLOCK = [
    ("write .env", "Write", {"file_path": "/home/l/nexo/.env", "content": "x=1"}),
    ("write .env.production", "Write", {"file_path": ".env.production", "content": "x=1"}),
    ("write cert .pem", "Write", {"file_path": "certs/dist.pem", "content": "x"}),
    ("write signing .p12", "Write", {"file_path": "ios/app.p12", "content": "x"}),
    ("write .mobileprovision", "Write", {"file_path": "nexo.mobileprovision", "content": "x"}),
    ("write database file", "Write", {"file_path": "backup/nexo.sqlite", "content": "x"}),
    ("write a copy of SPEC.md", "Write", {"file_path": "docs/SPEC.md", "content": "peso 73 kg"}),
    ("private key in source", "Write", {"file_path": "src/keys.ts", "content": PEM_FIXTURE}),
    ("hardcoded api key", "Write", {"file_path": "src/deals/tgtg.ts", "content": APIKEY_FIXTURE}),
    ("token in ci script", "Write", {"file_path": "ci/deploy.sh", "content": GH_FIXTURE}),
    ("edit adds a password literal", "Edit", {"file_path": "src/config.ts", "new_string": PASSWD_FIXTURE}),
    ("git add .env", "Bash", {"command": "git add .env && git commit -m x"}),
    ("git add SPEC.md", "Bash", {"command": "git add SPEC.md"}),
    ("git add --force bypassing gitignore", "Bash", {"command": "git add -f build/app.p12"}),
    ("append to .env", "Bash", {"command": "echo FLIPP_TOKEN=abc123456789 >> .env"}),
    ("copy a provisioning profile in", "Bash", {"command": "cp ~/Downloads/nexo.mobileprovision ."}),
    ("echo an aws key", "Bash", {"command": "echo " + AWS_FIXTURE}),
    ("redirect into SPEC.md", "Bash", {"command": "echo peso > SPEC.md"}),
    ("secret inside a heredoc body", "Bash", {"command": "cat > src/k.ts <<'EOF'\n" + PEM_FIXTURE + "\nEOF"}),
]

ALLOW = [
    ("write app source", "Write", {"file_path": "src/core/score.ts", "content": "export const trainingWeight = 22;"}),
    ("write .env.example", "Write", {"file_path": ".env.example", "content": "FLASHFOOD_PASSWORD=your_password_here"}),
    ("write sql migration", "Write", {"file_path": "db/001_training.sql", "content": "create table training_exercise (id text primary key);"}),
    ("read a secret from an env var", "Write", {"file_path": "server/auth.ts", "content": "const pw = process.env.FLASHFOOD_PASSWORD;"}),
    ("normal commit", "Bash", {"command": 'git add src && git commit -m "feat(db): add schema"'}),
    ("read-only grep", "Bash", {"command": "grep -rn 'create table' db/"}),
    ("run this test suite", "Bash", {"command": "python3 .claude/hooks/block-secrets.test.py"}),
    ("prose naming a protected file in a heredoc body", "Bash",
     {"command": "cat > DECISIONS.md <<'EOF'\nRejected: publishing a redacted SPEC.md.\nEOF"}),
]


def call(tool, tool_input):
    payload = json.dumps({"tool_name": tool, "tool_input": tool_input})
    proc = subprocess.run([sys.executable, HOOK], input=payload, capture_output=True, text=True)
    return proc.returncode, (proc.stderr or "").strip()


def main():
    failures = 0

    print("must BLOCK (exit 2)")
    for label, tool, tool_input in BLOCK:
        code, err = call(tool, tool_input)
        if code == 2:
            print(f"  blocked  {label}")
            print(f"           -> {err.split(': ', 1)[-1]}")
        else:
            failures += 1
            print(f"  MISSED   {label} (exit {code})")

    print("\nmust ALLOW (exit 0)")
    for label, tool, tool_input in ALLOW:
        code, err = call(tool, tool_input)
        if code == 0:
            print(f"  allowed  {label}")
        else:
            failures += 1
            print(f"  FALSE POSITIVE  {label} (exit {code}) {err}")

    total = len(BLOCK) + len(ALLOW)
    print(f"\n{total - failures}/{total} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
