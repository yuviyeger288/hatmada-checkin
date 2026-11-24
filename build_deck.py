"""Turn the slide HTML into content the app can render on a phone.

The deck was built as 1920×1080 slides. Serving that to a phone — as a PDF
or as an iframe — gives a picture the client has to pinch to read, and on
iPhone a PDF cannot render in the page at all, so the app had to hand it to
the device's own viewer and the client left the app to read it. That is the
bug, and no amount of back-button work fixes it.

So the slides become **text**: a title and a few blocks per slide, which the
app lays out at phone sizes in its own screen. No PDF, no iframe, no
navigation, and the way back is always on screen.

Presenter notes (`<aside>`) are dropped: they are the coach's running order,
not the client's reading material.
"""
import html
import json
import re
import sys
from pathlib import Path

SRC = Path(r"C:\Users\yuval\Documents\hatmada\program\habit-loop-deck\project")
OUT = Path(r"C:\Users\yuval\Documents\hatmada\site\deck-week1.json")
sys.stdout.reconfigure(encoding="utf-8")


def text(s):
    s = re.sub(r"<br\s*/?>", " ", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    s = s.replace("\u200f", "").replace("\u200e", "")
    return re.sub(r"\s+", " ", s).strip()


def size_of(tag):
    m = re.search(r"font-size:\s*(\d+)px", tag)
    return int(m.group(1)) if m else 0


def parse(path):
    raw = path.read_text(encoding="utf-8")
    raw = re.sub(r"<aside>.*?</aside>", "", raw, flags=re.S)
    blocks = []
    for m in re.finditer(r"<(h1|h2|h3|p|li)([^>]*)>(.*?)</\1>", raw, flags=re.S):
        tag, attrs, inner = m.group(1), m.group(2), m.group(3)
        t = text(inner)
        if not t:
            continue
        blocks.append({"tag": tag, "size": size_of(attrs), "t": t})
    if not blocks:
        return None

    # the biggest line on the slide is its title; everything else is body,
    # and a line in an accent colour before it is the eyebrow
    # A block that is only a number is a label on the diagram, not a line of
    # its own: on the loop slide it came out as "2" and "חשק" on separate
    # rows. Fold it into what follows.
    merged = []
    for b in blocks:
        if re.fullmatch(r"\d+", b["t"]) and merged is not blocks:
            b["num"] = b["t"]
            merged.append(b)
            continue
        if merged and merged[-1].get("num") and merged[-1]["t"] == merged[-1]["num"]:
            prev = merged.pop()
            b = dict(b, t=prev["num"] + ". " + b["t"],
                     size=max(b["size"], prev["size"]))
        merged.append(b)
    blocks = [b for b in merged if not re.fullmatch(r"\d+", b["t"])]
    if not blocks:
        return None

    head = max(blocks, key=lambda b: b["size"])
    out = {"title": head["t"], "body": []}
    for b in blocks:
        if b is head:
            continue
        kind = "lead" if b["size"] >= head["size"] * 0.42 else "note"
        if b["tag"] == "li":
            kind = "item"
        out["body"].append({"k": kind, "t": b["t"]})
    if out["body"] and out["body"][0]["k"] == "note" and \
            blocks[0] is not head and blocks[0]["size"] < head["size"] * 0.42:
        out["eyebrow"] = out["body"].pop(0)["t"]
    return out


deck = json.loads((SRC / "deck.json").read_text(encoding="utf-8"))
slides = []
for name in deck["order"]:
    p = SRC / "slides" / f"{name}.html"
    if not p.exists():
        print(f"  חסר: {name}")
        continue
    s = parse(p)
    if s:
        s["id"] = name
        slides.append(s)

OUT.write_text(json.dumps(
    {"title": deck.get("title", ""), "slides": slides},
    ensure_ascii=False, indent=1), encoding="utf-8")
print(f"-> {OUT.name}  ({len(slides)} שקפים)")
for s in slides[:3]:
    print(f"  {s['id']}: {s['title'][:40]}  ({len(s['body'])} בלוקים)")
