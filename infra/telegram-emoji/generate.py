"""Генератор набора кастомных эмодзи noova для Telegram.

Статика: SVG-мастер -> PNG/WEBP 100x100 (требование Telegram для emoji).
Анимация: Lottie JSON -> .tgs (gzip), холст 512x512, 60 fps, <= 3 c, <= 64 KB.

Всё рисуется в «дизайн-пространстве» 100x100; для Lottie координаты
умножаются на 5.12.

Запуск: python generate.py --font Sora.ttf --out dist
"""

import argparse
import gzip
import json
import re
from pathlib import Path

import resvg_py
from fontTools.pens.basePen import BasePen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from PIL import Image

PINK = '#ec5a8b'  # --primary (dark theme) — цвет контура сердца в логотипе
CORAL = '#ff9a70'  # --accent (dark theme) — цвет «капли»
LETTERS = 'nova'
FONT_WEIGHT = 700  # логотип в шапке сайта: Sora 700

# Контуры логотипа из infra/backup/bot-icons/noova.svg (координаты 0..100).
HEART_OUTER = 'M50,82 C30,64 12,52 12,34 C12,20 24,12 36,16 C44,18 48,24 50,30 C52,24 56,18 64,16 C76,12 88,20 88,34 C88,52 70,64 50,82 Z'
HEART_INNER = 'M50,68 C42,60 42,52 50,42 C58,52 58,60 50,68 Z'
# На 100px (и тем более ~20px в строке) исходная толщина 6 слишком тонкая.
HEART_STROKE = 7.5
# Вписываем сердце (с учётом толщины линии) в 100x100 с полями.
HEART_SCALE = 1.12
HEART_CENTER = (50, 48.4)

LOTTIE_SIZE = 512
K = LOTTIE_SIZE / 100
FPS = 60


# ---------------------------------------------------------------- геометрия

def parse_abs_path(d):
    """Разбор пути из M/C/Z (абсолютные координаты) в список контуров.

    Контур: (start, [(c1, c2, end), ...]).
    """
    tokens = re.findall(r'[MCZ]|-?\d+(?:\.\d+)?', d)
    contours, i = [], 0
    while i < len(tokens):
        cmd = tokens[i]
        i += 1
        if cmd == 'M':
            start = (float(tokens[i]), float(tokens[i + 1]))
            i += 2
            contours.append((start, []))
        elif cmd == 'C':
            nums = [float(t) for t in tokens[i:i + 6]]
            i += 6
            contours[-1][1].append(((nums[0], nums[1]), (nums[2], nums[3]), (nums[4], nums[5])))
    return contours


def transform_contours(contours, fn):
    return [
        (fn(start), [(fn(c1), fn(c2), fn(end)) for c1, c2, end in segs])
        for start, segs in contours
    ]


def contours_to_svg(contours):
    parts = []
    for start, segs in contours:
        parts.append(f'M{start[0]:.2f},{start[1]:.2f}')
        for c1, c2, end in segs:
            parts.append(f'C{c1[0]:.2f},{c1[1]:.2f} {c2[0]:.2f},{c2[1]:.2f} {end[0]:.2f},{end[1]:.2f}')
        parts.append('Z')
    return ' '.join(parts)


class CubicPen(BasePen):
    """Собирает контуры глифа, переводя TrueType-квадратики в кубики."""

    def __init__(self, glyphset):
        super().__init__(glyphset)
        self.contours = []

    def _moveTo(self, pt):
        self.contours.append((pt, []))

    def _lineTo(self, pt):
        p0 = self._getCurrentPoint()
        self.contours[-1][1].append((p0, pt, pt))

    def _curveToOne(self, c1, c2, pt):
        self.contours[-1][1].append((c1, c2, pt))

    def _qCurveToOne(self, q, pt):
        p0 = self._getCurrentPoint()
        c1 = (p0[0] + 2 / 3 * (q[0] - p0[0]), p0[1] + 2 / 3 * (q[1] - p0[1]))
        c2 = (pt[0] + 2 / 3 * (q[0] - pt[0]), pt[1] + 2 / 3 * (q[1] - pt[1]))
        self.contours[-1][1].append((c1, c2, pt))

    def _closePath(self):
        start, segs = self.contours[-1]
        end = segs[-1][2] if segs else start
        if end != start:
            segs.append((end, start, start))


def load_glyphs(font_path):
    font = TTFont(font_path)
    if 'fvar' in font:
        font = instantiateVariableFont(font, {'wght': FONT_WEIGHT})
    glyphset = font.getGlyphSet()
    cmap = font.getBestCmap()
    out = {}
    for ch in LETTERS:
        pen = CubicPen(glyphset)
        glyphset[cmap[ord(ch)]].draw(pen)
        out[ch] = pen.contours
    return out


def bbox(contours):
    pts = [p for start, segs in contours for p in [start] + [e for _, _, e in segs]]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def layout_letters(glyphs):
    """Общий масштаб и общая базовая линия: набранные подряд n-o-o-v-a
    стоят ровно, как слово. Каждая буква центрируется по горизонтали."""
    boxes = {ch: bbox(c) for ch, c in glyphs.items()}
    max_w = max(b[2] - b[0] for b in boxes.values())
    max_h = max(b[3] - b[1] for b in boxes.values())
    scale = 72 / max(max_w, max_h)
    y_min = min(b[1] for b in boxes.values())
    y_max = max(b[3] for b in boxes.values())
    # y в шрифте растёт вверх — переворачиваем; блок x-height по центру.
    y_off = 50 + (y_max + y_min) / 2 * scale
    laid = {}
    for ch, contours in glyphs.items():
        x0, _, x1, _ = boxes[ch]
        x_off = 50 - (x0 + x1) / 2 * scale
        laid[ch] = transform_contours(contours, lambda p, xo=x_off: (p[0] * scale + xo, y_off - p[1] * scale))
    baseline = y_off - y_min * scale  # низ букв в дизайн-пространстве
    return laid, baseline


def heart_contours():
    cx, cy = HEART_CENTER

    def fn(p):
        return (50 + (p[0] - cx) * HEART_SCALE, 50 + (p[1] - cy) * HEART_SCALE)

    return (
        transform_contours(parse_abs_path(HEART_OUTER), fn),
        transform_contours(parse_abs_path(HEART_INNER), fn),
    )


# -------------------------------------------------------------------- статика

GRADIENT_FROM, GRADIENT_TO = (18, 12), (82, 88)


def svg_logo(outer, inner):
    sw = HEART_STROKE * HEART_SCALE
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <g fill="none" stroke-linejoin="round" stroke-linecap="round" stroke-width="{sw:.2f}">
    <path d="{contours_to_svg(outer)}" stroke="{PINK}"/>
    <path d="{contours_to_svg(inner)}" stroke="{CORAL}"/>
  </g>
</svg>
'''


def svg_letter(contours):
    (x1, y1), (x2, y2) = GRADIENT_FROM, GRADIENT_TO
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <defs>
    <linearGradient id="g" gradientUnits="userSpaceOnUse" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}">
      <stop offset="0" stop-color="{PINK}"/>
      <stop offset="1" stop-color="{CORAL}"/>
    </linearGradient>
  </defs>
  <path d="{contours_to_svg(contours)}" fill="url(#g)"/>
</svg>
'''


def render_svg(svg, path_png, size):
    data = bytes(resvg_py.svg_to_bytes(svg_string=svg, width=size, height=size))
    path_png.write_bytes(data)


def export_static(name, svg, out):
    (out / 'svg' / f'{name}.svg').write_text(svg)
    render_svg(svg, out / 'png-512' / f'{name}.png', 512)
    # 100x100 делаем даунскейлом с 512 — чище края, чем прямой рендер в 100.
    img = Image.open(out / 'png-512' / f'{name}.png').convert('RGBA').resize((100, 100), Image.LANCZOS)
    img.save(out / 'static' / f'{name}.png')
    img.save(out / 'static' / f'{name}.webp', lossless=True)


# -------------------------------------------------------------------- lottie

def hex_rgb(h):
    return [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]


def lottie_path(contour):
    start, segs = contour
    pts = [start] + [e for _, _, e in segs]
    closes = pts[-1] == pts[0]
    if closes:
        pts = pts[:-1]
    n = len(pts)
    v = [[p[0] * K, p[1] * K] for p in pts]
    i_t = [[0, 0] for _ in range(n)]
    o_t = [[0, 0] for _ in range(n)]
    for k, (c1, c2, end) in enumerate(segs):
        a = k
        b = (k + 1) % n if closes else k + 1
        o_t[a] = [(c1[0] - pts[a][0]) * K, (c1[1] - pts[a][1]) * K]
        i_t[b] = [(c2[0] - end[0]) * K, (c2[1] - end[1]) * K]
    return {'ty': 'sh', 'ks': {'a': 0, 'k': {'c': True, 'v': v, 'i': i_t, 'o': o_t}}}


def static(v):
    return {'a': 0, 'k': v}


def anim(keys, ease=(0.33, 0.0, 0.67, 1.0)):
    """keys: [(frame, value), ...]; ease — cubic-bezier между ключами."""
    ox, oy, ix, iy = ease
    # Ключи с одинаковым временем (например delay=0) схлопываем — оставляем последний.
    keys = [k for n, k in enumerate(keys) if n == len(keys) - 1 or keys[n + 1][0] != k[0]]
    frames = []
    for idx, (t, val) in enumerate(keys):
        val = val if isinstance(val, list) else [val]
        kf = {'t': t, 's': val}
        if idx < len(keys) - 1:
            d = len(val)
            kf['o'] = {'x': [ox] * d, 'y': [oy] * d}
            kf['i'] = {'x': [ix] * d, 'y': [iy] * d}
        frames.append(kf)
    return {'a': 1, 'k': frames}


def transform(anchor=(50, 50), position=None, scale=None, opacity=None, rotation=None):
    pos = position or static([anchor[0] * K, anchor[1] * K, 0])
    return {
        'a': static([anchor[0] * K, anchor[1] * K, 0]),
        'p': pos,
        's': scale or static([100, 100, 100]),
        'r': rotation or static(0),
        'o': opacity or static(100),
    }


def group(items):
    items = items + [{'ty': 'tr', 'p': static([0, 0]), 'a': static([0, 0]), 's': static([100, 100]),
                      'r': static(0), 'o': static(100)}]
    return {'ty': 'gr', 'it': items}


def stroke(color, width):
    return {'ty': 'st', 'c': static(hex_rgb(color) + [1]), 'o': static(100),
            'w': static(width * K), 'lc': 2, 'lj': 2}


def gradient_fill():
    c0, c1 = hex_rgb(PINK), hex_rgb(CORAL)
    return {'ty': 'gf', 'o': static(100), 'r': 1, 't': 1,
            's': static([GRADIENT_FROM[0] * K, GRADIENT_FROM[1] * K]),
            'e': static([GRADIENT_TO[0] * K, GRADIENT_TO[1] * K]),
            'g': {'p': 2, 'k': static([0, *c0, 1, *c1])}}


def layer(ind, name, shapes, ks, op):
    return {'ddd': 0, 'ind': ind, 'ty': 4, 'nm': name, 'sr': 1, 'ks': ks, 'ao': 0,
            'shapes': shapes, 'ip': 0, 'op': op, 'st': 0, 'bm': 0}


def animation(name, layers, op):
    return {'tgs': 1, 'v': '5.5.2', 'fr': FPS, 'ip': 0, 'op': op, 'w': LOTTIE_SIZE, 'h': LOTTIE_SIZE,
            'nm': name, 'ddd': 0, 'assets': [], 'layers': layers}


SW = HEART_STROKE * HEART_SCALE


def anim_heartbeat(outer, inner):
    """Двойной удар сердца «тук-тук», потом пауза. 2 c."""
    op = 120
    s = lambda v: [v, v, 100]
    beat = anim([(0, s(100)), (7, s(106)), (14, s(98)), (21, s(103)), (32, s(100)), (op, s(100))])
    drop = anim([(3, s(100)), (10, s(118)), (17, s(94)), (24, s(110)), (36, s(100)), (op, s(100))])
    ic = HEART_CENTER[0], 50 + (55 - HEART_CENTER[1]) * HEART_SCALE  # центр капли
    return animation('noova heartbeat', [
        layer(1, 'drop', [group([lottie_path(c) for c in inner] + [stroke(CORAL, SW)])],
              transform(anchor=ic, scale=drop), op),
        layer(2, 'heart', [group([lottie_path(c) for c in outer] + [stroke(PINK, SW)])],
              transform(scale=beat), op),
    ], op)


def anim_draw(outer, inner):
    """Контур сердца рисуется «от руки», капля выпрыгивает, пауза,
    всё стирается — и по кругу без склейки. 3 c."""
    op = 180
    trim = {'ty': 'tm', 'm': 1, 'o': static(0),
            's': anim([(0, 0), (138, 0), (170, 100)], ease=(0.55, 0, 0.45, 1)),
            'e': anim([(0, 0), (48, 100)], ease=(0.55, 0, 0.45, 1))}
    s = lambda v: [v, v, 100]
    pop = anim([(0, s(0)), (40, s(0)), (54, s(122)), (64, s(94)), (72, s(100)),
                (140, s(100)), (156, s(0)), (op, s(0))])
    ic = HEART_CENTER[0], 50 + (55 - HEART_CENTER[1]) * HEART_SCALE
    return animation('noova draw', [
        layer(1, 'drop', [group([lottie_path(c) for c in inner] + [stroke(CORAL, SW)])],
              transform(anchor=ic, scale=pop), op),
        layer(2, 'heart', [group([lottie_path(c) for c in outer] + [trim, stroke(PINK, SW)])],
              transform(), op),
    ], op)


def anim_hop(ch, contours, baseline, delay=0):
    """Буква подпрыгивает со squash & stretch. 2 c.
    delay сдвигает прыжок: набор с задержками даёт «волну» по слову."""
    op = 120
    d = delay
    ax, ay = 50, baseline
    s = lambda x, y: [x, y, 100]
    p = lambda dy: [ax * K, (ay + dy) * K, 0]
    keys_s = [(0, s(100, 100)), (d, s(100, 100)), (d + 8, s(112, 86)), (d + 18, s(96, 104)),
              (d + 30, s(100, 100)), (d + 40, s(96, 104)), (d + 48, s(114, 84)), (d + 58, s(98, 102)),
              (d + 66, s(100, 100)), (op, s(100, 100))]
    keys_p = [(0, p(0)), (d + 8, p(0)), (d + 30, p(-10)), (d + 48, p(0)), (op, p(0))]
    return animation(f'noova {ch} hop', [
        layer(1, ch, [group([lottie_path(c) for c in contours] + [gradient_fill()])],
              transform(anchor=(ax, ay), position=anim(keys_p), scale=anim(keys_s)), op),
    ], op)


def export_tgs(name, data, out):
    raw = json.dumps(data, separators=(',', ':')).encode()
    (out / 'lottie' / f'{name}.json').write_bytes(raw)
    (out / 'animated' / f'{name}.tgs').write_bytes(gzip.compress(raw, 9))


# ---------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--font', required=True)
    ap.add_argument('--out', default='dist')
    args = ap.parse_args()
    out = Path(args.out)
    for sub in ('svg', 'png-512', 'static', 'lottie', 'animated'):
        (out / sub).mkdir(parents=True, exist_ok=True)

    outer, inner = heart_contours()
    letters, baseline = layout_letters(load_glyphs(args.font))

    export_static('noova', svg_logo(outer, inner), out)
    for ch, contours in letters.items():
        export_static(ch, svg_letter(contours), out)

    export_tgs('noova-heartbeat', anim_heartbeat(outer, inner), out)
    export_tgs('noova-draw', anim_draw(outer, inner), out)
    for ch, contours in letters.items():
        export_tgs(f'{ch}-hop', anim_hop(ch, contours, baseline), out)
    # «Волна»: n-o-o-v-a по позициям в слове, каждая следующая на 10 кадров позже.
    for pos, ch in enumerate('noova', start=1):
        export_tgs(f'wave-{pos}-{ch}', anim_hop(ch, letters[ch], baseline, delay=(pos - 1) * 10), out)


if __name__ == '__main__':
    main()
