# Vendored runtime notices

`onnxruntime-1.21.0/LICENSE` and `ThirdPartyNotices.txt` are copied verbatim from Microsoft's official `v1.21.0` tag because the Node npm package omits them:

- https://github.com/microsoft/onnxruntime/blob/v1.21.0/LICENSE
- https://github.com/microsoft/onnxruntime/blob/v1.21.0/ThirdPartyNotices.txt

The build copies these notices into the payload. Dependency pruning refuses a different ORT version until its policy and notices are reviewed. Node's complete LICENSE is copied from the official build runtime; all package-provided licenses/notices are retained in the physical dependency closure.
