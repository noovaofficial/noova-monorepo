"""Проверка: рендер TGS через rlottie (движок Telegram) в контакт-лист
кадров на светлом и тёмном фоне + отчёт по размерам и параметрам."""

import gzip
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw
from rlottie_python import LottieAnimation


def unpremultiply(img):
    # rlottie отдаёт premultiplied alpha — без этого полупрозрачное темнеет на светлом фоне.
    return Image.frombytes('RGBa', img.size, img.tobytes()).convert('RGBA')

out = Path(sys.argv[1])
BGS = [(255, 255, 255), (24, 24, 28)]
CELL = 96

files = sorted((out / 'animated').glob('*.tgs'))
for f in files:
    data = json.loads(gzip.decompress(f.read_bytes()))
    print(f'{f.name:24} {f.stat().st_size / 1024:5.1f} KB  {data["w"]}x{data["h"]}  fr={data["fr"]}  '
          f'{(data["op"] - data["ip"]) / data["fr"]:.2f}s')

N = 12
sheet = Image.new('RGB', (CELL * N, CELL * len(files) * 2), 'white')
for row, f in enumerate(files):
    anim = LottieAnimation.from_tgs(str(f))
    total = anim.lottie_animation_get_totalframe()
    for col in range(N):
        frame = unpremultiply(anim.render_pillow_frame(frame_num=int(col * total / N), width=CELL, height=CELL))
        for b, bg in enumerate(BGS):
            cell = Image.new('RGB', (CELL, CELL), bg)
            cell.paste(frame, (0, 0), frame)
            sheet.paste(cell, (col * CELL, (row * 2 + b) * CELL))
sheet.save(out / 'preview-animated.png')

statics = sorted((out / 'static').glob('*.png'))
sizes = [100, 40, 20]  # 20px — примерно так эмодзи выглядит в строке текста
w = sum(sizes) + 20 * len(sizes)
st = Image.new('RGB', (w * 2, 110 * len(statics)), 'white')
for r, f in enumerate(statics):
    img = Image.open(f).convert('RGBA')
    for b, bg in enumerate(BGS):
        ImageDraw.Draw(st).rectangle([b * w, r * 110, b * w + w - 1, r * 110 + 109], fill=bg)
        x = b * w + 5
        for s in sizes:
            im = img.resize((s, s), Image.LANCZOS)
            st.paste(im, (x, r * 110 + 5), im)
            x += s + 20
st.save(out / 'preview-static.png')
print('ok')
