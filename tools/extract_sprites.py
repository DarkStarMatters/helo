"""Slice fbcatsprites.png into transparent animation strips for the game.

The source sheet is a flat RGB illustration on a dark navy background, so each
frame is cropped from a hand-measured cell, the background is keyed out by
flood-filling from the cell border, and stray slivers of neighbouring frames
are dropped. Hue-shifted copies of the cat become the rival clan enemies.

Run from the repo root:  python tools/extract_sprites.py
Outputs assets/sprites/**.png and assets/atlas.js (window.ATLAS metadata).
"""
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHEET = os.path.join(ROOT, "fbcatsprites.png")
OUT = os.path.join(ROOT, "assets", "sprites")
BG = np.array([0, 4, 20], dtype=float)

# anim name -> (frame centre xs or explicit (x0, x1) ranges, cell width, y0, y1, fps, loop)
ANIMS = {
    "idle":    ([63, 151, 238, 325, 413, 498, 586, 672], 92, 222, 330, 8, True),
    "run":     ([814, 914, 1007, 1101, 1195, 1290, 1383, 1472], 98, 218, 332, 12, True),
    "claw":    ([80, 168, 260, 350, 436, 522, 608, 697], 92, 384, 492, 18, False),
    "roar":    ([815, 912, 1011, 1105, 1195, 1287, 1378, 1473], 98, 381, 494, 12, False),
    "special": ([210, 285, 360, 435], 80, 548, 652, 8, False),
    "jump":    ([(886, 999), (1004, 1099), (1103, 1193), (1196, 1287), (1290, 1367),
                 (1371, 1441), (1444, 1512)], 114, 543, 654, 12, False),
    "hit":     ([58, 133, 204, 280, 357], 76, 706, 810, 14, False),
    "death":   ([467, 549, 630, 699, 769, 839, 909, 978], 84, 706, 810, 9, False),
}

# single images: name -> (x0, y0, x1, y1)
SINGLES = {
    "fx_fireball": (1043, 718, 1166, 812),
    "fx_slash":    (1164, 712, 1232, 818),
    "fx_orb":      (1234, 710, 1332, 822),
    "fx_bolt":     (1332, 708, 1371, 822),
    "fx_star":     (1373, 710, 1440, 822),
    "fx_crownfire": (1443, 706, 1508, 826),
    "crown":       (1055, 880, 1202, 992),
    "spikes":      (1205, 880, 1334, 990),
    "gem":         (1339, 880, 1396, 990),
    "crownfire":   (1401, 866, 1514, 996),
    "portrait_normal": (22, 860, 132, 976),
    "portrait_roar":   (135, 860, 248, 976),
    "portrait_angry":  (251, 860, 360, 976),
    "portrait_hurt":   (364, 860, 474, 976),
    "portrait_death":  (478, 860, 592, 976),
    "human":       (646, 912, 718, 976),
    "logo":        (380, 10, 800, 120),
}
# opaque backdrops (no keying)
BACKDROPS = {
    "bg_citadel": (830, 4, 1240, 186),
    "bg_face":    (4, 4, 372, 186),
}

VARIANTS = {  # hue rotation in degrees, saturation boost
    "boss": (0, 1.0),
    "solar": (160, 1.15),     # Solar Tabby Legion
    "void": (-115, 1.05),     # Void Siamese Syndicate
    "crimson": (100, 1.2),     # Crimson Persian Court
}


def dist(rgb):
    return np.sqrt(((rgb.astype(float) - BG) ** 2).sum(-1))


def key(rgb, drop_edge_slivers=True):
    """Return RGBA: a solid silhouette of the lit pixels, plus a faint glow halo."""
    d = dist(rgb)
    solid = ndimage.binary_fill_holes(
        ndimage.binary_closing(d > 38, structure=np.ones((3, 3)), iterations=2))

    if drop_edge_slivers:
        fg, n = ndimage.label(solid, structure=np.ones((3, 3)))
        if n > 1:
            sizes = ndimage.sum(np.ones_like(fg), fg, range(1, n + 1))
            biggest = sizes.max()
            h, w = fg.shape
            for i, sl in enumerate(ndimage.find_objects(fg), start=1):
                touches = (sl[1].start <= 1 or sl[1].stop >= w - 1 or
                           sl[0].start <= 1 or sl[0].stop >= h - 1)
                if (touches and sizes[i - 1] < 0.3 * biggest) or sizes[i - 1] < 8:
                    solid &= fg != i

    alpha = np.where(solid, 1.0, 0.0)
    # glow halo: lit pixels outside the silhouette keep partial alpha
    halo = ~solid & (d > 18) & ndimage.binary_dilation(solid, iterations=6)
    alpha[halo] = np.clip((d[halo] - 18) / 90.0, 0, 0.55)
    return np.dstack([rgb, (alpha * 255).astype(np.uint8)])


def rgb_to_hsv(rgb):
    r, g, b = [rgb[..., i] for i in range(3)]
    mx = rgb.max(-1)
    mn = rgb.min(-1)
    df = mx - mn
    h = np.zeros_like(mx)
    m = df > 1e-6
    rm = m & (mx == r)
    gm = m & (mx == g) & ~rm
    bm = m & ~rm & ~gm
    h[rm] = ((g - b)[rm] / df[rm]) % 6
    h[gm] = (b - r)[gm] / df[gm] + 2
    h[bm] = (r - g)[bm] / df[bm] + 4
    h = h / 6.0
    s = np.where(mx > 1e-6, df / np.maximum(mx, 1e-6), 0)
    return h, s, mx


def hsv_to_rgb(h, s, v):
    i = np.floor(h * 6).astype(int) % 6
    f = h * 6 - np.floor(h * 6)
    p = v * (1 - s)
    q = v * (1 - f * s)
    t = v * (1 - (1 - f) * s)
    choices = [
        np.stack([v, t, p], -1), np.stack([q, v, p], -1), np.stack([p, v, t], -1),
        np.stack([p, q, v], -1), np.stack([t, p, v], -1), np.stack([v, p, q], -1),
    ]
    out = np.zeros(h.shape + (3,))
    for k in range(6):
        out[i == k] = choices[k][i == k]
    return out


def recolor(rgba, deg, sat):
    if deg == 0 and sat == 1.0:
        return rgba
    rgb = rgba[..., :3].astype(float) / 255
    h, s, v = rgb_to_hsv(rgb)
    h = (h + deg / 360.0) % 1.0
    s = np.clip(s * sat, 0, 1)
    out = (hsv_to_rgb(h, s, v) * 255).clip(0, 255).astype(np.uint8)
    return np.dstack([out, rgba[..., 3]])


def save(arr, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray(arr).save(path, optimize=True)


def main():
    sheet = np.asarray(Image.open(SHEET).convert("RGB"))
    atlas = {"anims": {}, "images": {}}

    keyed = {}
    for name, (xs, w, y0, y1, fps, loop) in ANIMS.items():
        frames = []
        for cx in xs:
            if isinstance(cx, tuple):
                cell = key(sheet[y0:y1, cx[0]:cx[1]])
                pad = w - cell.shape[1]
                cell = np.pad(cell, ((0, 0), (pad // 2, pad - pad // 2), (0, 0)))
            else:
                x0 = int(round(cx - w / 2))
                cell = key(sheet[y0:y1, x0:x0 + w])
            frames.append(cell)
        strip = np.concatenate(frames, axis=1)
        rows = np.where((strip[..., 3] > 200).any(1))[0]
        foot = int(strip.shape[0] - 1 - rows.max())  # empty rows below the feet
        keyed[name] = (strip, len(xs), w, y1 - y0, fps, loop, foot)

    for variant, (deg, sat) in VARIANTS.items():
        atlas["anims"][variant] = {}
        for name, (strip, n, w, h, fps, loop, foot) in keyed.items():
            rel = f"assets/sprites/{variant}/{name}.png"
            save(recolor(strip, deg, sat), os.path.join(ROOT, rel))
            atlas["anims"][variant][name] = {
                "src": rel, "frames": n, "w": w, "h": h, "fps": fps, "loop": loop,
                "foot": foot}

    for name, (x0, y0, x1, y1) in SINGLES.items():
        rel = f"assets/sprites/{name}.png"
        save(key(sheet[y0:y1, x0:x1], drop_edge_slivers=name != "logo"), os.path.join(ROOT, rel))
        atlas["images"][name] = {"src": rel, "w": x1 - x0, "h": y1 - y0}

    for name, (x0, y0, x1, y1) in BACKDROPS.items():
        rel = f"assets/sprites/{name}.png"
        save(sheet[y0:y1, x0:x1], os.path.join(ROOT, rel))
        atlas["images"][name] = {"src": rel, "w": x1 - x0, "h": y1 - y0}

    with open(os.path.join(ROOT, "assets", "atlas.js"), "w") as f:
        f.write("// Generated by tools/extract_sprites.py - do not edit by hand.\n")
        f.write("window.ATLAS = " + json.dumps(atlas, indent=1) + ";\n")
    print("wrote", sum(len(v) for v in atlas["anims"].values()), "strips and",
          len(atlas["images"]), "images")


if __name__ == "__main__":
    main()
