#!/usr/bin/env python3
"""Generate Goko Downloader app icons (pure stdlib: zlib + struct).

Outputs:
  extension/icons/icon16.png, icon32.png, icon48.png, icon128.png
  installer/goko.ico  (16, 32, 48, 256; PNG-encoded entries)

Design: rounded square with a vertical gradient (#FF4D4D -> #C81E5A),
white downward arrow above a horizontal bar. Rendered at 4x per axis and
box-downsampled for anti-aliased edges; corners are transparent (RGBA).
"""
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON_DIR = os.path.join(ROOT, 'extension', 'icons')
INSTALLER_DIR = os.path.join(ROOT, 'installer')

TOP = (0xFF, 0x4D, 0x4D)
BOTTOM = (0xC8, 0x1E, 0x5A)
CORNER_RADIUS = 0.22   # fraction of icon size
SUPERSAMPLE = 4

# Shapes in normalized [0, 1] coordinates (origin top-left).
SHAFT = (0.42, 0.19, 0.58, 0.53)           # x0, y0, x1, y1
HEAD = ((0.24, 0.47), (0.76, 0.47), (0.50, 0.71))
BAR = (0.28, 0.76, 0.72, 0.84)


def lerp_color(t):
    return tuple(round(a + (b - a) * t) for a, b in zip(TOP, BOTTOM))


def in_rounded_rect(u, v, r):
    dx = max(abs(u - 0.5) - (0.5 - r), 0.0)
    dy = max(abs(v - 0.5) - (0.5 - r), 0.0)
    return dx * dx + dy * dy <= r * r


def in_triangle(px, py, a, b, c):
    def sign(p1, p2, p3):
        return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])

    p = (px, py)
    d1 = sign(p, a, b)
    d2 = sign(p, b, c)
    d3 = sign(p, c, a)
    has_neg = d1 < 0 or d2 < 0 or d3 < 0
    has_pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (has_neg and has_pos)


def in_white_shape(u, v):
    x0, y0, x1, y1 = SHAFT
    if x0 <= u <= x1 and y0 <= v <= y1:
        return True
    if in_triangle(u, v, *HEAD):
        return True
    bx0, by0, bx1, by1 = BAR
    return bx0 <= u <= bx1 and by0 <= v <= by1


def render(size):
    """Return raw RGBA bytes (size*size*4) for the icon."""
    n = size * SUPERSAMPLE
    total = SUPERSAMPLE * SUPERSAMPLE
    out = bytearray(size * size * 4)
    for oy in range(size):
        for ox in range(size):
            count = 0
            sr = sg = sb = 0
            for sy in range(SUPERSAMPLE):
                v = (oy * SUPERSAMPLE + sy + 0.5) / n
                base = lerp_color(v)
                for sx in range(SUPERSAMPLE):
                    u = (ox * SUPERSAMPLE + sx + 0.5) / n
                    if not in_rounded_rect(u, v, CORNER_RADIUS):
                        continue
                    count += 1
                    if in_white_shape(u, v):
                        sr += 255
                        sg += 255
                        sb += 255
                    else:
                        sr += base[0]
                        sg += base[1]
                        sb += base[2]
            i = (oy * size + ox) * 4
            if count:
                # Colour is averaged over covered samples only, so transparent
                # corners do not bleed into the edge pixels.
                out[i] = round(sr / count)
                out[i + 1] = round(sg / count)
                out[i + 2] = round(sb / count)
                out[i + 3] = round(255 * count / total)
    return bytes(out)


def png_encode(size, rgba):
    stride = size * 4
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter type: None
        raw += rgba[y * stride:(y + 1) * stride]

    def chunk(tag, data):
        body = tag + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF)

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
            + chunk(b'IEND', b''))


def ico_encode(images):
    """images: list of (size, png_bytes)."""
    header = struct.pack('<HHH', 0, 1, len(images))
    entries = b''
    data = b''
    offset = 6 + 16 * len(images)
    for size, png in images:
        dim = 0 if size >= 256 else size
        entries += struct.pack('<BBBBHHII', dim, dim, 0, 0, 1, 32, len(png), offset)
        offset += len(png)
        data += png
    return header + entries + data


def check_png(path, expected_size):
    with open(path, 'rb') as f:
        head = f.read(33)
    assert head[:8] == b'\x89PNG\r\n\x1a\n', f'bad PNG signature: {path}'
    w, h = struct.unpack('>II', head[16:24])
    assert (w, h) == (expected_size, expected_size), f'bad size {w}x{h}: {path}'
    return w, h


def main():
    os.makedirs(ICON_DIR, exist_ok=True)
    os.makedirs(INSTALLER_DIR, exist_ok=True)

    pngs = {}
    for size in (16, 32, 48, 128, 256):
        pngs[size] = png_encode(size, render(size))
        print(f'rendered {size}x{size}')

    for size in (16, 32, 48, 128):
        path = os.path.join(ICON_DIR, f'icon{size}.png')
        with open(path, 'wb') as f:
            f.write(pngs[size])
        check_png(path, size)
        print('wrote', path)

    ico_path = os.path.join(INSTALLER_DIR, 'goko.ico')
    with open(ico_path, 'wb') as f:
        f.write(ico_encode([(s, pngs[s]) for s in (16, 32, 48, 256)]))
    with open(ico_path, 'rb') as f:
        ico = f.read()
    assert ico[:4] == b'\x00\x00\x01\x00' and struct.unpack('<H', ico[4:6])[0] == 4
    print('wrote', ico_path)


if __name__ == '__main__':
    main()
