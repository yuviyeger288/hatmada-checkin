"""Turn the week-2 slides into the app's reading view.

Same reason as week 1: a 1920×1080 slide is unreadable on a phone, and a PDF
cannot render inside the app on iPhone at all. So the slides become text and
the app lays them out itself.

These slides are written with classes rather than inline styles, so the block
kind is read off the class — `lead`, `said`, `body`, `t`, `d` — instead of
being guessed from a font size. Presenter notes are dropped: they are the
coach's running order, not the client's reading material.
"""
import html
import json
import re
import sys
from pathlib import Path

SRC = Path(r"C:\Users\yuval\Documents\hatmada\program\week-2-deck\project")
OUT = Path(r"C:\Users\yuval\Documents\hatmada\site\deck-week2.json")
sys.stdout.reconfigure(encoding="utf-8")

# class on the element -> how the app should show it
KIND = {"lead": "lead", "said": "lead", "statement": "lead",
        "formula": "lead", "t": "lead", "what": "lead",
        "body": "note", "d": "note", "cap": "note", "quiet": "note",
        "v": "item", "big": "lead", "n": "eyebrow", "tag": "eyebrow",
        "eyebrow": "eyebrow", "k": None}


def text(s):
    s = re.sub(r"<br\s*/?>", " ", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s).replace("\u200f", "").replace("\u200e", "")
    return re.sub(r"\s+", " ", s).strip()


def parse(path):
    raw = path.read_text(encoding="utf-8")
    raw = re.sub(r"<aside>.*?</aside>", "", raw, flags=re.S)

    title = ""
    m = re.search(r"<h[12][^>]*>(.*?)</h[12]>", raw, flags=re.S)
    if m:
        title = text(m.group(1))

    eyebrow = ""
    body = []
    for m in re.finditer(r"<(p|li)([^>]*)>(.*?)</\1>", raw, flags=re.S):
        attrs, inner = m.group(2), m.group(3)
        t = text(inner)
        if not t:
            continue
        cls = re.search(r'class="([^"]*)"', attrs)
        names = cls.group(1).split() if cls else []
        kind = next((KIND[c] for c in names if c in KIND), "note")
        if kind is None:
            continue
        if kind == "eyebrow" and not eyebrow and not body:
            eyebrow = t
            continue
        if "foot" in names:
            continue
        body.append({"k": "note" if kind == "eyebrow" else kind, "t": t})

    if not title and body:
        title = body.pop(0)["t"]
    return {"title": title, "eyebrow": eyebrow, "body": body}


deck = json.loads((SRC / "deck.json").read_text(encoding="utf-8"))
slides = []
for name in deck["order"]:
    p = SRC / "slides" / f"{name}.html"
    if not p.exists():
        print(f"  חסר: {name}")
        continue
    s = parse(p)
    s["id"] = name
    if not s["eyebrow"]:
        s.pop("eyebrow")
    slides.append(s)

OUT.write_text(json.dumps({"title": deck.get("title", ""), "slides": slides},
                          ensure_ascii=False, indent=1), encoding="utf-8")
print(f"-> {OUT.name}  ({len(slides)} שקפים)")
for s in slides[:3]:
    print(f"  {s['id']}: {s['title'][:38]}  ({len(s['body'])} בלוקים)")
