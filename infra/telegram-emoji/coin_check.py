import sys
from pathlib import Path

from PIL import Image
from rlottie_python import LottieAnimation


def unpremultiply(img):
    # rlottie отдаёт premultiplied alpha — без этого полупрозрачное темнеет на светлом фоне.
    return Image.frombytes('RGBa', img.size, img.tobytes()).convert('RGBA')

out = Path(sys.argv[1])
f = out / 'animated' / 'coin-spin.tgs'
print(f'size {f.stat().st_size / 1024:.1f} KB')
a = LottieAnimation.from_tgs(str(f))
total = a.lottie_animation_get_totalframe()
worst = 999
for i in range(total):
    bb = a.render_pillow_frame(frame_num=i).getchannel('A').getbbox()
    if bb:
        worst = min(worst, bb[0], bb[1], 512 - bb[2], 512 - bb[3])
print('frames', total, 'min margin', worst)

CELL, COLS = 128, 10
frames = list(range(0, total, 6))
rows = (len(frames) + COLS - 1) // COLS
sheet = Image.new('RGB', (CELL * COLS, CELL * rows * 2), 'white')
for n, fr in enumerate(frames):
    img = unpremultiply(a.render_pillow_frame(frame_num=fr, width=CELL, height=CELL))
    for b, bg in enumerate([(255, 255, 255), (24, 24, 28)]):
        cell = Image.new('RGB', (CELL, CELL), bg)
        cell.paste(img, (0, 0), img)
        sheet.paste(cell, ((n % COLS) * CELL, ((n // COLS) * 2 + b) * CELL))
sheet.save(out / 'preview-coin.png')
