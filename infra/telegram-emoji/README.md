# Telegram emoji pack noova

Кастомные эмодзи: логотип и буквы `n o v a` (Sora 700, как логотип на сайте,
градиент `#ec5a8b` → `#ff9a70`).

| Папка | Что там | Требование Telegram |
|---|---|---|
| `dist/static/` | `noova`, `n`, `o`, `v`, `a` в `.png` и `.webp` | 100×100, прозрачный фон |
| `dist/animated/` | `.tgs` (Lottie + gzip) | холст 512×512, 60 fps, ≤ 3 с, ≤ 64 КБ |
| `dist/svg/`, `dist/png-512/` | мастер-файлы | — |
| `dist/lottie/` | несжатый JSON (открывается на lottiefiles.com) | — |

Анимации:
- `noova-heartbeat` — двойной удар сердца, 2 с;
- `noova-draw` — контур рисуется, капля выпрыгивает, всё стирается, 3 с;
- `{n,o,v,a}-hop` — буква подпрыгивает, 2 с;
- `wave-1-n` … `wave-5-a` — те же прыжки со сдвигом 10 кадров по позиции
  в слове: набранные подряд n-o-o-v-a дают «волну».

## Пересборка

```bash
python3 -m venv .venv && .venv/bin/pip install fonttools resvg-py Pillow rlottie-python
curl -sL -o Sora.ttf "https://github.com/google/fonts/raw/main/ofl/sora/Sora%5Bwght%5D.ttf"
.venv/bin/python generate.py --font Sora.ttf --out dist
.venv/bin/python preview.py dist   # проверка через rlottie + preview-*.png
```

## Загрузка

@Stickers → `/newemojipack` → тип (static / animated) → по одному файлу + эмодзи-алиас.
В @Stickers у набора один тип, поэтому статику и анимацию проще завести двумя наборами.
Через Bot API (`createNewStickerSet` / `addStickerToSet`, `format` у каждого файла)
форматы в одном наборе смешивать можно.
