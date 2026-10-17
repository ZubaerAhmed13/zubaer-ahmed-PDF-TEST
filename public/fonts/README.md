# Local Unicode font

DocFlowSans.woff is a subset of DejaVu Sans 2.37 from Debian's fonts-dejavu-core package. Source: https://dejavu-fonts.github.io/ . Copyright and distribution terms are in DejaVu-LICENSE.txt. The name does not use the reserved Bitstream or Vera names.

Created with fonttools 4.61.1:

```
pyftsubset DejaVuSans.ttf --unicodes='U+0020-024F,U+0370-052F,U+1E00-1EFF,U+2000-206F,U+20A0-20CF' --layout-features='kern,liga' --flavor=woff --output-file=DocFlowSans.woff
```

Added page text uses the same font for browser preview and a subset embedded by pdf-lib/fontkit in the PDF. Latin, Greek and Cyrillic are tested. Coverage is checked against the font's character set. Complex shaping and bidi scripts are explicitly rejected. Native comment strings use PDF Unicode strings and do not depend on this font.
