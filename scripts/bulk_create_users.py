#!/usr/bin/env python3
"""
Bulk user creation for Scania from plantilla.xlsx.

Usage:
  python3 scripts/bulk_create_users.py --dry-run        # parse + show 3 sample posts
  python3 scripts/bulk_create_users.py --limit 5        # create first 5 only
  python3 scripts/bulk_create_users.py                  # create all
"""

import argparse
import csv
import json
import sys
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import OrderedDict

import openpyxl

BACKEND_URL = "https://scania-backend-production.up.railway.app"
ENDPOINT = "/api/v1/auth/register"
PASSWORD = "Scania2026!"
INPUT_XLSX = "plantilla.xlsx"
OUTPUT_CSV = "usuarios_creados.csv"
CONCURRENCY = 5


def title_case_es(s: str) -> str:
    s = (s or "").strip()
    if not s:
        return ""
    return " ".join(p.capitalize() for p in s.split())


def parse_user(row, header):
    def col(name):
        return row[header.index(name)] if name in header else None

    email_raw = col("CORREO")
    if not email_raw:
        return None
    email = str(email_raw).strip().lower()
    if "@" not in email:
        return None

    local = email.split("@", 1)[0]
    first_segment = local.split(".", 1)[0].replace("-", " ")
    first_name = title_case_es(first_segment)

    nombre = (col("NOMBRE") or "").strip()
    nombre_words = nombre.split()
    if len(nombre_words) >= 2:
        last_name = title_case_es(" ".join(nombre_words[:2]))
    elif nombre_words:
        last_name = title_case_es(nombre_words[0])
    else:
        last_name = ""

    return {
        "num_emp": col("NUM_EMP"),
        "nombre_full": nombre,
        "email": email,
        "first_name": first_name,
        "last_name": last_name,
    }


def load_users(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    header = list(rows[0])
    data_rows = [r for r in rows[1:] if any(c is not None for c in r)]
    parsed = [u for u in (parse_user(r, header) for r in data_rows) if u]
    deduped = OrderedDict()
    skipped_dupes = []
    for u in parsed:
        if u["email"] in deduped:
            skipped_dupes.append(u["email"])
        else:
            deduped[u["email"]] = u
    return list(deduped.values()), skipped_dupes


def post_register(user, password):
    payload = {
        "email": user["email"],
        "password": password,
        "firstName": user["first_name"] or None,
        "lastName": user["last_name"] or None,
    }
    payload = {k: v for k, v in payload.items() if v is not None}
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        BACKEND_URL + ENDPOINT,
        data=body,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")
    except Exception as e:
        return 0, f"NETWORK_ERROR: {e}"


def classify(status, body):
    if status == 201:
        return "OK", ""
    try:
        data = json.loads(body)
        code = data.get("error", {}).get("code") or ""
        msg = data.get("error", {}).get("message") or ""
        return code or f"HTTP_{status}", msg
    except Exception:
        return f"HTTP_{status}", body[:200]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--start", type=int, default=0, help="skip first N users")
    ap.add_argument("--out", default=OUTPUT_CSV)
    args = ap.parse_args()

    users, dupes = load_users(INPUT_XLSX)
    print(f"Usuarios únicos: {len(users)}")
    print(f"Duplicados omitidos: {len(dupes)} -> {dupes}")

    if args.start:
        users = users[args.start :]
    if args.limit:
        users = users[: args.limit]
    print(f"Procesando {len(users)} usuarios")

    if args.dry_run:
        print("\n=== DRY RUN — solo muestra los primeros 3 payloads ===")
        for u in users[:3]:
            payload = {
                "email": u["email"],
                "password": PASSWORD,
                "firstName": u["first_name"],
                "lastName": u["last_name"],
            }
            print(json.dumps({"num_emp": u["num_emp"], "nombre_orig": u["nombre_full"], "payload": payload}, ensure_ascii=False, indent=2))
        return

    results = []
    start = time.time()
    done = 0
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        future_map = {pool.submit(post_register, u, PASSWORD): u for u in users}
        for fut in as_completed(future_map):
            u = future_map[fut]
            status, body = fut.result()
            code, msg = classify(status, body)
            results.append({
                "num_emp": u["num_emp"],
                "nombre": u["nombre_full"],
                "email": u["email"],
                "password": PASSWORD,
                "status": code,
                "error": msg,
            })
            done += 1
            if done % 25 == 0 or done == len(users):
                elapsed = time.time() - start
                rate = done / elapsed if elapsed else 0
                eta = (len(users) - done) / rate if rate else 0
                print(f"  {done}/{len(users)} ({rate:.1f}/s, ETA {eta:.0f}s)")

    by_email = {u["email"]: i for i, u in enumerate(users)}
    results.sort(key=lambda r: by_email.get(r["email"], 0))

    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["num_emp", "nombre", "email", "password", "status", "error"])
        w.writeheader()
        w.writerows(results)

    ok = sum(1 for r in results if r["status"] == "OK")
    taken = sum(1 for r in results if r["status"] == "AUTH_EMAIL_TAKEN")
    fail = len(results) - ok - taken
    print(f"\n=== Resumen ===")
    print(f"  OK creados:       {ok}")
    print(f"  Ya existían:      {taken}")
    print(f"  Fallaron:         {fail}")
    print(f"  Output:           {args.out}")


if __name__ == "__main__":
    main()
