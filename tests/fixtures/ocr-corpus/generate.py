"""Regenerate synthetic R4 corpus with Pillow and Debian DejaVu fonts. No private documents."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from pathlib import Path
import json
root=Path(__file__).parent
texts={
'eng':['DocFlow document quality check.', 'The meeting starts at nine tomorrow morning.', 'Please review the invoice before payment.', 'Reference number 2026 and total amount 125 euros.', 'All files remain on this device.'],
'deu':['DocFlow prüft die Qualität der Dokumente.', 'Die Besprechung beginnt morgen um neun Uhr.', 'Bitte prüfen Sie die Rechnung vor der Zahlung.', 'Für größere Aufträge beträgt der Preis 125 Euro.', 'Alle Dateien bleiben auf diesem Gerät.'],
'mixed':['Please review the invoice before payment.', 'Bitte prüfen Sie die Rechnung vor der Zahlung.', 'Grüße aus Köln und München.', 'All files remain on this device.']}
rows=[]
for lang,lines in texts.items():
 for style in (['sans','serif','bold','skew','low-contrast'] if lang!='mixed' else ['sans']):
  image=Image.new('RGB',(1400,700),(255,255,255));draw=ImageDraw.Draw(image)
  name={'sans':'DejaVuSans.ttf','serif':'DejaVuSerif.ttf','bold':'DejaVuSans-Bold.ttf','skew':'DejaVuSans.ttf','low-contrast':'DejaVuSans.ttf'}[style]
  font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/'+name,40)
  for i,line in enumerate(lines):draw.text((65,70+i*100),line,font=font,fill=(100,100,100) if style=='low-contrast' else (0,0,0))
  if style=='skew':image=image.rotate(5,resample=Image.Resampling.BICUBIC,expand=True,fillcolor='white')
  if style=='low-contrast':image=image.filter(ImageFilter.GaussianBlur(1.5))
  filename=f'{lang}-{style}.png';image.save(root/filename,optimize=True)
  rows.append({'file':filename,'language':'eng+deu' if lang=='mixed' else lang,'category':'mixed' if lang=='mixed' else 'difficult' if style in ['skew','low-contrast'] else 'clean','reference':' '.join(lines)})
(root/'corpus.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
