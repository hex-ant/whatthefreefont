# Static OCR model assets

These are the original, unmodified PaddleOCR PP-OCRv6 small ONNX inference archives.
The browser loads and runs them locally through `@paddleocr/paddleocr-js@0.4.2`.
They are included here because the upstream download host was slow during the first-use browser test.

| File | Upstream | SHA-256 |
| --- | --- | --- |
| PP-OCRv6_small_det.tar | https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv6_small_det_onnx_infer.tar | d218f6fbf0f1c23d2161bd6ac7f5eaa6104fa89955c09290497e31008e2618e4 |
| PP-OCRv6_small_rec.tar | https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv6_small_rec_onnx_infer.tar | d267ab077a44a0eedb1ea8f8c542d263f211de8e9d7a029bf9fcfff7e5a88fb1 |

Project: https://github.com/PaddlePaddle/PaddleOCR
License: Apache-2.0, copied to `LICENSE-APACHE-2.0.txt`.

Keep these as uncompressed `.tar` archives. The SDK expects `inference.onnx` and `inference.yml` inside each tar. Ordinary HTTP Content-Encoding compression by a CDN is fine.
