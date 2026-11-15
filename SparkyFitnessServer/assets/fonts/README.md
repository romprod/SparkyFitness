# Appointment report fonts

Bundled upstream, unmodified TrueType fonts from the Noto Project, licensed under
SIL Open Font License 1.1. The complete copyright and licence text is in OFL.txt.
Fonts may be bundled and embedded; no runtime download or system font is used.

Pinned source repository: https://github.com/notofonts/noto-fonts
Revision: ffebf8c1ee449e544955a7e813c54f9b73848eac

- hinted/ttf/NotoSans/NotoSans-Regular.ttf
- hinted/ttf/NotoSans/NotoSans-Bold.ttf
- hinted/ttf/NotoSansMath/NotoSansMath-Regular.ttf
- LICENSE (copied as OFL.txt)

The coverage maps are derived from these exact fonts using PDFKit's fontkit
2.0.4 dependency. coverage.json is the intersection of regular and bold cmap
codepoints. math-coverage.json lists math-font cmap codepoints. No font was
modified. Noto Sans covers Latin, Greek and Cyrillic text; Noto Sans Math supplies
clinical comparison signs and the Unicode minus sign missing from Noto Sans.

Unsupported characters use a reversible [U+XXXX] codepoint representation and a
report note, instead of silent replacement. The report does not claim universal
script coverage. These assets are inside the server package and are included by
the existing backend Dockerfile COPY and pnpm deploy flow.
