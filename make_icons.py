#!/usr/bin/env python3
"""Generate the Dart Shark app icon — a gold shark fin that doubles as a dart's
flight, streaking into a bullseye on navy. Zero dependencies (stdlib only)."""
import math
import struct
import zlib

NAVY  = (16, 22, 41)
GOLD  = (214, 178, 104)
GOLDB = (233, 201, 128)

# shark fin (also the dart's flight), normalized 0..1, y down, leaning right
FIN = [
    (0.200, 0.770), (0.255, 0.620), (0.330, 0.470), (0.430, 0.350),
    (0.540, 0.270), (0.600, 0.235),                                   # tip
    (0.590, 0.345), (0.567, 0.475), (0.545, 0.595), (0.520, 0.695), (0.500, 0.770),
]
ARROW = [(0.665, 0.270), (0.762, 0.244), (0.706, 0.356)]             # dart point into the bull
BULL   = (0.762, 0.248)
DART_A = (0.455, 0.545)
DART_B = (0.716, 0.292)


def blend(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


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


def dist_seg(x, y, a, b):
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / L2))
    return math.hypot(x - (ax + t * dx), y - (ay + t * dy))


def sample(nx, ny):
    col = NAVY
    r = math.hypot(nx - BULL[0], ny - BULL[1])           # bullseye rings + dot
    for R in (0.090, 0.048):
        if abs(r - R) < 0.011:
            col = blend(col, GOLD, 0.85)
    if r < 0.024:
        col = GOLDB
    if dist_seg(nx, ny, DART_A, DART_B) < 0.017:         # dart shaft
        col = GOLD
    if point_in_poly(nx, ny, ARROW):                     # dart point
        col = GOLDB
    if point_in_poly(nx, ny, FIN):                       # fin (hero), subtle gradient
        col = blend(GOLDB, GOLD, (ny - 0.235) / (0.77 - 0.235))
    return col


def render(size):
    raw = bytearray()
    ss = 3                                               # 3x3 supersample for clean edges
    inv = 1.0 / (ss * ss)
    for y in range(size):
        raw.append(0)
        for x in range(size):
            r = g = b = 0.0
            for sy in range(ss):
                for sx in range(ss):
                    nx = (x + (sx + 0.5) / ss) / size
                    ny = (y + (sy + 0.5) / ss) / size
                    c = sample(nx, ny)
                    r += c[0]; g += c[1]; b += c[2]
            raw += bytes((round(r * inv), round(g * inv), round(b * inv), 255))
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
