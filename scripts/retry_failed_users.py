#!/usr/bin/env python3
"""Retry the 4 users that hit SHOPIFY_SYNC_FAILED on the first bulk pass."""
import csv
import json
import urllib.request
import urllib.error
from bulk_create_users import post_register, classify, PASSWORD

FAILED_EMAILS = {
    "ana.correa@scania.com",
    "yesica.munoz@scania.com",
    "adriana.davy.cambron@scania.com",
    "adriana.islas@scania.com",
}


def main():
    with open("usuarios_creados.csv") as f:
        rows = list(csv.DictReader(f))

    targets = [r for r in rows if r["email"] in FAILED_EMAILS]
    print(f"Reintentando {len(targets)} usuarios:")

    results = []
    for r in targets:
        # Reconstruct first_name / last_name from previous row
        nombre = r["nombre"]
        local = r["email"].split("@", 1)[0]
        first = local.split(".", 1)[0].replace("-", " ").title()
        words = nombre.split()
        last = " ".join(w.title() for w in words[:2]) if len(words) >= 2 else (words[0].title() if words else "")
        user = {"email": r["email"], "first_name": first, "last_name": last}
        status, body = post_register(user, PASSWORD)
        code, msg = classify(status, body)
        print(f"  {r['email']} -> {code} {msg[:80]}")
        results.append({**r, "status": code, "error": msg})

    # Merge back into usuarios_creados.csv
    updated = []
    for r in rows:
        match = next((x for x in results if x["email"] == r["email"]), None)
        updated.append(match if match else r)

    with open("usuarios_creados.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["num_emp", "nombre", "email", "password", "status", "error"])
        w.writeheader()
        w.writerows(updated)
    print(f"\n✓ usuarios_creados.csv actualizado")


if __name__ == "__main__":
    main()
