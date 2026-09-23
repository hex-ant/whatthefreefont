# WhatTheFreeFont

What the Free Font is a small tool for finding Google Fonts that look like text in an image. It is for designers and developers who have a screenshot, logo, or photo but do not know the font name. The results are visual suggestions, not a guarantee that the original font is in the catalog.

## How to use it and how it works

Add an image, select one line of text, correct the recognized text if needed, and search. The app compares the selected letters with a prebuilt Google Fonts index, then renders the strongest candidates for a closer match. Image processing, text recognition, and matching run in your browser; the site itself is static.

Built with Nuxt 4, Vue 3, TypeScript, Web Workers, PaddleOCR through ONNX Runtime Web, and Tesseract.js as an OCR fallback.

Project code is [MIT licensed](LICENSE). Third-party assets have their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
