#!/usr/bin/env python3
"""Generate the Dart Shark app icon — an authentic dartboard with a bold steel
shark fin rising in front of it — as PNGs, zero dependencies (stdlib only)."""
import math
import struct
import zlib

ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5]

BG        = (14, 15, 19)
BLACK_SEG = (26, 26, 28)
CREAM_SEG = (210, 202, 182)
RED       = (200, 48, 40)
GREEN     = (28, 124, 68)
WIRE      = (62, 64, 70)

FIN_TOP   = (228, 234, 242)   # bright steel near the tip
FIN_BOT   = (96, 112, 132)    # darker steel near the base
FIN_LINE  = (12, 13, 17)      # outline
GOLD      = (240, 185, 70)    # accent (the eye)

# Shark fin outline (normalized 0..1, y down), clockwise — raked back, notched rear.
FIN = [
    (0.275, 0.745),                                                 # base left
    (0.315, 0.62), (0.365, 0.50), (0.425, 0.385),
    (0.495, 0.285), (0.565, 0.215), (0.625, 0.18),                  # apex (sharp, leaning right)
    (0.655, 0.255), (0.695, 0.40), (0.735, 0.545), (0.765, 0.655),  # trailing edge to rear tip
    (0.645, 0.625),                                                 # concave notch cut in
    (0.705, 0.725),                                                 # rear foot
    (0.585, 0.745),                                                 # base right
]


def lerp(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def board_color(px, py, size):
    cx = cy = size / 2.0
    dx = px - cx + 0.5
    dy = py - cy + 0.5
    r = math.hypot(dx, dy) / (size / 2.0)
    if r > 0.96:
        return BG
    ang = math.degrees(math.atan2(dx, -dy)) % 360.0
    seg = int(((ang + 9.0) % 360.0) // 18.0)
    even = (seg % 2 == 0)
    single_col = BLACK_SEG if even else CREAM_SEG
    ring_col = RED if even else GREEN
    if r < 0.055:    col = RED
    elif r < 0.115:  col = GREEN
    elif r < 0.585:  col = single_col
    elif r < 0.66:   col = ring_col
    elif r < 0.88:   col = single_col
    elif r < 0.945:  col = ring_col
    else:            col = (18, 19, 23)
    seg_edge = (ang + 9.0) % 18.0
    near_radial = (seg_edge < 0.5 or seg_edge > 17.5) and r > 0.115
    near_ring = any(abs(r - e) < 0.006 for e in (0.055, 0.115, 0.585, 0.66, 0.88, 0.945))
    if near_radial or near_ring:
        col = lerp(col, WIRE, 0.7)
    if r > 0.93:
        col = lerp(col, BG, (r - 0.93) / 0.03)
    return lerp(col, BG, 0.18)   # dim the board so the fin is the hero


def point_in_poly(x, y, poly):
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def dist_to_poly(x, y, poly):
    best = 1e9
    n = len(poly)
    for i in range(n):
        ax, ay = poly[i]
        bx, by = poly[(i + 1) % n]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / L2))
        px, py = ax + t * dx, ay + t * dy
        d = math.hypot(x - px, y - py)
        if d < best:
            best = d
    return best


def pixel(px, py, size):
    col = board_color(px, py, size)
    nx, ny = (px + 0.5) / size, (py + 0.5) / size
    if not (0.27 < nx < 0.79 and 0.18 < ny < 0.77):   # quick reject outside fin bbox
        return col
    inside = point_in_poly(nx, ny, FIN)
    d = dist_to_poly(nx, ny, FIN)
    if d < 0.012:
        return FIN_LINE
    if inside:
        t = (ny - 0.205) / (0.74 - 0.205)
        fin = lerp(FIN_TOP, FIN_BOT, t)
        if nx < 0.48 and ny < 0.58:                   # sheen on the leading edge
            fin = lerp(fin, (255, 255, 255), 0.20)
        eye = math.hypot(nx - 0.515, ny - 0.40)       # gold eye
        if eye < 0.030:
            return GOLD if eye < 0.021 else FIN_LINE
        return fin
    return col


def render(size):
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            r, g, b = pixel(x, y, size)
            raw += bytes((r, g, b, 255))
    return raw


def write_png(path, size):
    comp = zlib.compress(bytes(render(size)), 9)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", comp))
        f.write(chunk(b"IEND", b""))
    print("wrote", path, f"{size}x{size}")


if __name__ == "__main__":
    import os
    here = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons")
    write_png(os.path.join(here, "icon-512.png"), 512)
    write_png(os.path.join(here, "icon-192.png"), 192)
    write_png(os.path.join(here, "apple-touch-icon-180.png"), 180)
    write_png(os.path.join(here, "favicon-64.png"), 64)
