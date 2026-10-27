# Regenerates all app icons from resources/icon-source.jpg
from PIL import Image, ImageDraw, ImageFont, ImageChops
import os
R='android/app/src/main/res'
src=Image.open('resources/icon-source.jpg').convert('RGB')
r,g,b=src.split()
mask=r.point(lambda v:255 if v>40 else 0)
bbox=mask.getbbox(); print('bbox',bbox)
art=src.crop(bbox); W,H=art.size
# alpha: brightness-based so edges blend on any background
alpha=art.split()[0].point(lambda v:min(255,int(v*2.2)))
def trident(h):
    w=round(W*h/H); return art.resize((w,h),Image.LANCZOS), alpha.resize((w,h),Image.LANCZOS)
def canvas(size,frac,bg=(0,0,0)):
    im=Image.new('RGB',(size,size),bg); t,a=trident(round(size*frac))
    im.paste(t,((size-t.width)//2,(size-t.height)//2),a); return im
D={'mdpi':1,'hdpi':1.5,'xhdpi':2,'xxhdpi':3,'xxxhdpi':4}
for d,s in D.items():
    p=f'{R}/mipmap-{d}'
    canvas(round(48*s),0.86).save(f'{p}/ic_launcher.png')
    c=canvas(round(48*s),0.80); m=Image.new('L',c.size,0); ImageDraw.Draw(m).ellipse((0,0,c.width-1,c.height-1),fill=255)
    o=Image.new('RGBA',c.size,(0,0,0,0)); o.paste(c,(0,0),m); o.save(f'{p}/ic_launcher_round.png')
    fs=round(108*s); fg=Image.new('RGBA',(fs,fs),(0,0,0,0)); t,a=trident(round(fs*62/108))
    fg.paste(t.convert('RGBA'),((fs-t.width)//2,(fs-t.height)//2),a); fg.save(f'{p}/ic_launcher_foreground.png')
    mo=Image.new('RGBA',(fs,fs),(0,0,0,0)); wh=Image.new('RGBA',t.size,(255,255,255,255))
    mo.paste(wh,((fs-t.width)//2,(fs-t.height)//2),a); mo.save(f'{p}/ic_launcher_monochrome.png')
for n in ['ic_launcher','ic_launcher_round']:
    open(f'{R}/mipmap-anydpi-v26/{n}.xml','w').write('''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>
</adaptive-icon>
''')
open(f'{R}/values/ic_launcher_background.xml','w').write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#000000</color>\n</resources>\n')
canvas(512,0.86).save('docs/play-store/icon-512.png')
os.makedirs('public/icons',exist_ok=True)
for s in (192,512): canvas(s,0.86).save(f'public/icons/icon-{s}.png')
canvas(512,62/108).save('public/icons/maskable-512.png')
canvas(180,0.86).save('public/icons/apple-touch-icon.png'); canvas(64,0.9).save('public/favicon.png')
# feature graphic
fgi=Image.new('RGB',(1024,500),(0,0,0)); t,a=trident(440); fgi.paste(t,(800-t.width//2,30),a)
dr=ImageDraw.Draw(fgi); F='/usr/share/fonts/truetype/dejavu/DejaVuSans'
dr.text((62,165),'Patrol Radar',font=ImageFont.truetype(F+'-Bold.ttf',72),fill='white')
f2=ImageFont.truetype(F+'.ttf',28); dr.text((62,262),'Passive Bluetooth awareness map',font=f2,fill=(200,200,210)); dr.text((62,305),'Coarse. Delayed. Private.',font=f2,fill=(200,200,210))
fgi.save('docs/play-store/feature-graphic-1024x500.png')
# preview: circle, squircle, rounded square of adaptive (108dp, show 72dp viewport)
pv=Image.new('RGB',(3*300+80,340),(235,235,240))
full=canvas(432,62/108); view=full.crop((72,72,360,360)).resize((260,260),Image.LANCZOS)
for i,k in enumerate(['circle','squircle','rounded']):
    m=Image.new('L',(260,260),0); d=ImageDraw.Draw(m)
    if k=='circle': d.ellipse((0,0,259,259),fill=255)
    elif k=='rounded': d.rounded_rectangle((0,0,259,259),radius=40,fill=255)
    else:
        for y in range(260):
            for x in range(260):
                if abs((x-129.5)/130)**4+abs((y-129.5)/130)**4<=1: m.putpixel((x,y),255)
    pv.paste(view,(40+i*300,30),m); ImageDraw.Draw(pv).text((40+i*300+100,300),k,fill='black',font=ImageFont.truetype(F+'.ttf',20))
pv.save('/workspace/trident-icon-preview.png')
