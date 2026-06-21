#!/usr/bin/env python3
"""Bundle Dart Shark into ONE self-contained, offline `Dart Shark.html`.

Inlines styles.css, every js/*.js, and the icons (as base64 data URIs) into a single
file with no external references — so it runs straight from the file on an iPad
(AirDrop it, open in Safari/Files) with zero server and zero Wi-Fi. localStorage
(games, tournaments, history) still works from a local file. Pure stdlib.
"""
import base64
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
JS_ORDER = ["engine", "modes", "sound", "storage", "tracer", "ui", "app"]


def read(p):
    with open(os.path.join(HERE, p), encoding="utf-8") as f:
        return f.read()


def data_uri(rel):
    with open(os.path.join(HERE, rel), "rb") as f:
        return "data:image/png;base64," + base64.b64encode(f.read()).decode()


def main():
    html = read("index.html")
    css = read("styles.css")
    # icons -> data URIs (so nothing is fetched)
    icon192 = data_uri("icons/icon-192.png")
    apple = data_uri("icons/apple-touch-icon-180.png")
    favicon = data_uri("icons/favicon-64.png")
    board = data_uri("icons/board-fill.png")

    # 1) drop the manifest + SW-shell links (no server in a single file)
    html = re.sub(r'\s*<link rel="manifest"[^>]*>', "", html)
    # 2) apple-touch-icon + favicon -> data URIs
    html = html.replace("./icons/apple-touch-icon-180.png", apple)
    html = html.replace("./icons/favicon-64.png", favicon)
    # 3) inline the stylesheet
    html = re.sub(r'<link rel="stylesheet" href="\./styles\.css"\s*/?>',
                  "<style>\n" + css + "\n</style>", html)
    # 4) inline every script, in order, replacing the <script src> tags
    bundle = []
    for name in JS_ORDER:
        bundle.append("/* ==== %s.js ==== */\n%s" % (name, read("js/%s.js" % name)))
    js = "\n".join(bundle)
    # rewrite the in-JS asset paths to the inlined data URIs
    js = js.replace("./icons/icon-192.png", icon192)
    js = js.replace("./icons/board-fill.png", board)
    # remove the individual <script src=...> lines, then inject one combined block
    html = re.sub(r'\s*<script src="\./js/[^"]+"></script>', "", html)
    html = html.replace("</body>", "  <script>\n" + js + "\n  </script>\n</body>")

    out = os.path.join(HERE, "Dart Shark.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    size = os.path.getsize(out)
    # sanity: no leftover external references
    leftovers = re.findall(r'(?:href|src)="\.\/[^"]+"', html)
    print("wrote", out, "(%.0f KB)" % (size / 1024))
    print("external refs remaining:", leftovers or "none")
    # also drop a copy on the Desktop for easy AirDrop
    desk = os.path.expanduser("~/Desktop/Dart Shark.html")
    try:
        with open(desk, "w", encoding="utf-8") as f:
            f.write(html)
        print("copied to", desk)
    except Exception as e:  # noqa: BLE001
        print("(could not copy to Desktop:", e, ")")


if __name__ == "__main__":
    main()
