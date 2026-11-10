# Fonts

Bundled so captions look the same on every machine, and so a fresh clone can
render without hunting for a font file.

| Font | Licence |
|---|---|
| Anton (Regular) | SIL Open Font License 1.1 |
| Be Vietnam Pro (Bold, Medium) | SIL Open Font License 1.1 |
| Charm (Bold) | SIL Open Font License 1.1 |

Anton is the condensed display face. It is here because the heavy, narrow
caption is most of what reads as short-form video, and none of the other
faces can do it — a bold text face set large is simply large, not emphatic.
Latin only, so it is offered rather than imposed.

The OFL permits bundling and redistribution, including commercially, provided
the fonts are not sold on their own and the licence travels with them.

Deliberately **not** bundled: the CJK faces the original project shipped
(`MicrosoftYaHeiBold.ttc`, `STHeitiMedium.ttc`). Those are proprietary system
fonts from Microsoft and Apple, and redistributing them is not permitted —
regardless of the fact that they happen to carry Latin glyphs.

To use another font, drop a `.ttf` or `.otf` in this directory. It appears in
the caption font picker. For scripts these faces do not cover — Arabic, CJK,
Devanagari — you will need to add one that does.
