"""把 img-src/ 的原图压缩成 img/（网页只读 img/）。用法：python3 build-img.py
- 7 张动作图：img-src/{id}.png → 去掉奶油色底（从四角泛洪）→ 560×560 透明 PNG（量化调色盘）
- hero.png → 宽 900（保持比例）；card-bg.png → 1080×1920（居中裁成 9:16 再缩）；tip-*.png → 360×360（居中裁方）
  非动物图：PNG 量化 与 JPEG q80 选较小者
- 档案不存在就跳过。最后写 img/manifest.js：window.IMG = {名字: 路径}，网页靠它知道哪些图存在（缺的走 SVG 云朵后备，不发 404 请求）。"""
import os, json
from PIL import Image, ImageDraw, ImageFilter, ImageChops

HERE = os.path.dirname(os.path.abspath(__file__))
SRC, OUT = os.path.join(HERE, 'img-src'), os.path.join(HERE, 'img')
os.makedirs(OUT, exist_ok=True)
MOVES = ['plane', 'tree', 'windmill', 'sway', 'rocket', 'tiptoe', 'plank']
TIPS = ['tip-clear', 'tip-clothes', 'tip-adult', 'tip-window']
manifest = {}

def cover(im, w, h):
    r = max(w / im.width, h / im.height)
    im = im.resize((round(im.width * r), round(im.height * r)), Image.LANCZOS)
    x, y = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((x, y, x + w, y + h))

def cutout(im, size=560):
    """去底：底色＝四角平均；「颜色平滑变化（地面软阴影）且离底色不远」的区域，只要和边缘相连就算背景。"""
    import numpy as np
    from scipy import ndimage as ndi
    rgb = im.convert('RGB').resize((size, size), Image.LANCZOS)
    a = np.asarray(rgb).astype(np.int16)
    bg = np.mean([a[0, 0], a[0, -1], a[-1, 0], a[-1, -1]], axis=0)
    dist = np.abs(a - bg).max(axis=2)
    gx = np.abs(np.diff(a, axis=1, prepend=a[:, :1])).max(axis=2)
    gy = np.abs(np.diff(a, axis=0, prepend=a[:1])).max(axis=2)
    cand = ((np.maximum(gx, gy) <= 4) & (dist <= 95)) | (dist <= 22)
    lab, _ = ndi.label(cand)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])); edge = edge[edge > 0]
    bgm = np.isin(lab, edge)
    body = Image.fromarray(((~bgm) * 255).astype('uint8'))
    body = body.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))  # 收 1px 去毛边＋柔边
    out = rgb.convert('RGBA'); out.putalpha(body)
    return out.quantize(colors=256, method=Image.FASTOCTREE, dither=Image.NONE)

def save_smaller(im, name):
    png = os.path.join(OUT, name + '.png'); jpg = os.path.join(OUT, name + '.jpg')
    im.convert('RGB').quantize(colors=256, method=Image.MEDIANCUT).save(png, optimize=True)
    im.convert('RGB').save(jpg, quality=80, optimize=True, progressive=True)
    if os.path.getsize(jpg) < os.path.getsize(png): os.remove(png); return f'img/{name}.jpg'
    os.remove(jpg); return f'img/{name}.png'

for n in MOVES:
    p = os.path.join(SRC, n + '.png')
    if not os.path.exists(p): continue
    dst = os.path.join(OUT, n + '.png')
    cutout(Image.open(p)).save(dst, optimize=True)
    manifest[n] = f'img/{n}.png'
for n, fn in [('hero', lambda im: im.convert('RGB').resize((900, round(900 * im.height / im.width)), Image.LANCZOS)),
              ('card-bg', lambda im: cover(im.convert('RGB'), 1080, 1920))]:
    p = os.path.join(SRC, n + '.png')
    if os.path.exists(p): manifest[n] = save_smaller(fn(Image.open(p)), n)
for n in TIPS:
    p = os.path.join(SRC, n + '.png')
    if os.path.exists(p): manifest[n] = save_smaller(cover(Image.open(p).convert('RGB'), 360, 360), n)

with open(os.path.join(OUT, 'manifest.js'), 'w', encoding='utf-8') as f:
    f.write('// 由 build-img.py 生成，不要手改\nwindow.IMG = ' + json.dumps(manifest, separators=(',', ':')) + ';\n')
for k, v in manifest.items(): print(k, v, os.path.getsize(os.path.join(HERE, v)) // 1024, 'KB')
print('缺少（走后备）:', [n for n in ['hero', 'card-bg'] + TIPS if n not in manifest])
