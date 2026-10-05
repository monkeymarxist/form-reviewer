# Form Review

Browser-based PDF reviewer with two independently scrolling document panes, separate zoom controls, word-level text comparisons, filled form-value and checkbox comparison, red/green page highlights, and a navigable change list.

Use **Open PDF** in each pane or drag a PDF into a pane. Select **Review changes** to compare. **Try Form 1065 sample** opens the official IRS 2023 and 2024 forms included in `dist/samples`.

Documents are processed locally in the browser, with no document upload or storage. Rendering dependencies are bundled locally. Scanned/image-only text requires OCR first. The comparison covers extractable text and AcroForm values, not graphical/formatting changes, signatures, or arbitrary annotation edits. PDF reading order may affect comparison of complex layouts. Password-protected PDFs must be unlocked first. Current limits: 100 MB, 150 pages, and 100,000 extracted words/values per document.

## Run locally

From this folder:

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory dist
```

Then open http://127.0.0.1:8765. Serve over HTTP; opening index.html directly is not supported because PDF.js uses JavaScript modules and a worker.

## Validation

- Both official IRS Form 1065 PDFs render all six pages and produce a navigable comparison.
- A controlled 2024 Form 1065 pair changing a text field from “Example Partners LLC” to “Example Partners LP” and checking one checkbox produces exactly two changes.
- Comparing an identical filled form pair produces zero changes.
- Scrolling the original pane changes only its scroll position.
- JavaScript syntax checked with Node.

## Sample sources

- https://www.irs.gov/pub/irs-prior/f1065--2023.pdf
- https://www.irs.gov/pub/irs-prior/f1065--2024.pdf

Libraries: Mozilla PDF.js 4.10.38 (Apache 2.0) and jsdiff 7.0.0 (BSD). Licenses are included in dist/vendor.
