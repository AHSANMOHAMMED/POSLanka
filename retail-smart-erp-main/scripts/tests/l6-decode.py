"""
L6 barcode decode helper (used by l6-label-roll.ts / l6-label-browser-pdf.ts).

stdin: JSON [{ "file": "page.pgm|png", "crops": [[x, y, w, h], ...] }, ...]
stdout: JSON [[{ "text": str|null, "format": str|null, "dark": fraction of dark pixels }, ...per crop], ...per file]

Needs zxing-cpp + pillow (pip install zxing-cpp pillow). Exit 3 if missing.
"""
import json
import sys

try:
    import zxingcpp  # type: ignore
    from PIL import Image  # type: ignore
except Exception as e:  # pragma: no cover
    print(json.dumps({"error": str(e)}))
    sys.exit(3)

LINEAR = zxingcpp.BarcodeFormat.LinearCodes if hasattr(zxingcpp.BarcodeFormat, "LinearCodes") else None


def decode(img):
    kw = {}
    if LINEAR is not None:
        kw["formats"] = LINEAR
    res = zxingcpp.read_barcodes(img, **kw)
    dark = sum(img.histogram()[:128]) / float(max(1, img.width * img.height))
    if not res:
        return {"text": None, "format": None, "count": 0, "dark": dark}
    r = res[0]
    return {"text": r.text, "format": str(r.format).split(".")[-1], "count": len(res), "dark": dark}


def main():
    jobs = json.load(sys.stdin)
    out = []
    for job in jobs:
        im = Image.open(job["file"]).convert("L")
        row = []
        for (x, y, w, h) in job.get("crops") or [[0, 0, im.width, im.height]]:
            row.append(decode(im.crop((x, y, x + w, y + h))))
        out.append(row)
    print(json.dumps(out))


main()
