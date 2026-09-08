# 3D Model Downloader

A high-performance, developer-grade browser extension for inspecting, capturing, and exporting 3D models (GLB, STL, OBJ, USDZ, and PBR Textures) across web-based 3D generation and repository platforms (Meshy, Tripo3D, Luma AI, Rodin / Hyper3D, Sketchfab, Poly Pizza, and Poly Haven).

---

## Features

- **Multi-Provider Architecture**: Decoupled provider modules for Meshy (`meshy.ai`), Tripo3D (`tripo3d.ai`), Luma AI (`lumalabs.ai`), Rodin / Hyper3D (`hyperhuman.deemos.com`), Sketchfab (`sketchfab.com`), Poly Pizza (`poly.pizza`), and Poly Haven (`polyhaven.com`), extensible for future platforms without rewriting UI or background code.
- **Multi-Format 3D Export**: Export captured 3D models to Universal GLB (glTF 2.0 binary), STL (for 3D printing slicers), Wavefront OBJ (mesh geometry & UVs), Apple AR USDZ (iOS Quick Look), and PBR Texture Pack (ZIP archive with albedo, normal, metallic-roughness, ambient occlusion, and emissive maps + README guide).
- **Per-Tab State Isolation**: Each browser tab maintains its own isolated model state (`Record<number, TabModelState>`). Switching between tabs or opening different models in different tabs will never cross-contaminate models.
- **Stale Async Protection**: Generation counters, revision tracking, and `AbortController` cancel obsolete operations and prevent older in-flight requests from overwriting newer active models when rapidly switching models (`A -> B -> C`).
- **SPA Navigation Tracking**: Hooks into `pushState`, `replaceState`, and `popstate` to react immediately to client-side routing changes without aggressive polling or full DOM re-scans.
- **Strict GLB Validation**: Validates binary headers (`glTF` magic `0x46546C67`, version 2, declared lengths, JSON chunk integrity) and rejects HTML error pages, API error JSONs, images, or empty payloads.
- **High-Fidelity Model Preservation**: Preserves scene hierarchy, nodes, meshes, primitives, vertex positions, normals, tangents, UV channels, vertex colors, indices, materials, textures, samplers, skins, bones, inverse bind matrices, animations, and morph targets.
- **Meshopt & Dequantization**: Integrated `meshoptimizer` WebAssembly decoder and `@gltf-transform` pipeline to decompress and dequantize models cleanly without loss of geometry or texture binding.
- **Texture Fallback & Transcoding**: Detects separate texture channels where models are served untextured, embeds PNG textures into the GLB BIN chunk, and optionally transcodes textures to WebP, PNG, or JPEG.
- **Zero Base64 Memory Overhead**: Eliminates large base64 conversions over messaging; uses native structured-cloned `ArrayBuffer` objects and fast blob URL revocation to easily handle models from 10 MB to 500+ MB.
- **Zero Telemetry & Strict Privacy**: No analytics, no backend server, no tracking, no logging of credentials or signatures, and zero retention of sensitive tokens.
- **Polished Developer-Grade UI**: Compact (~380px) dark-neutral popup displaying live model statistics (meshes, triangles, vertices, materials, textures, animations) and local download history.

---

## Supported Platforms

| Platform | URL Pattern | Detection Strategy | Export Formats |
| :--- | :--- | :--- | :--- |
| **Meshy** | `https://www.meshy.ai/*` | Web Worker decode intercept + `model.meshy` / `model.json` detection | GLB, STL, OBJ, USDZ, PBR ZIP |
| **Tripo3D** | `https://studio.tripo3d.ai/*`<br>`https://www.tripo3d.ai/*` | Resource timing observation of `tripo_pbr_model_*_meshopt.glb` | GLB, STL, OBJ, USDZ, PBR ZIP |
| **Luma AI** | `https://lumalabs.ai/*`<br>`https://cdn.lumalabs.ai/*` | Network observation of Genie 3D assets | GLB, STL, OBJ, USDZ, PBR ZIP |
| **Rodin / Hyper3D** | `https://hyperhuman.deemos.com/*`<br>`https://hyper3d.ai/*` | Model asset request interception & dequantization | GLB, STL, OBJ, USDZ, PBR ZIP |
| **Sketchfab** | `https://sketchfab.com/*` | Viewer asset stream interception & ZIP unpack | GLB, STL, OBJ, USDZ, PBR ZIP |
| **Poly Pizza** | `https://poly.pizza/*`<br>`https://polypizza.net/*` | Direct asset detection & glTF/OBJ capture | GLB, STL, OBJ, USDZ, PBR ZIP |
| **Poly Haven** | `https://polyhaven.com/*`<br>`https://polyhaven.org/*` | Asset CDN download stream & glTF processing | GLB, STL, OBJ, USDZ, PBR ZIP |

---

## Supported Browsers

- **Google Chrome** (Manifest V3)
- **Mozilla Firefox** (Manifest V3)
- **Brave**, **Microsoft Edge**, **Arc**, and other Chromium-based browsers

---

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [pnpm](https://pnpm.io/) (v9 or higher; tested with v11)

### Development Setup

```bash
# Clone the repository
git clone https://github.com/shreeharsh-patil/3d-Model-Downoader.git
cd 3d-Model-Downoader

# Install dependencies
pnpm install

# Start development mode with hot reload (Chrome)
pnpm dev

# Start development mode for Firefox
pnpm dev:firefox
```

### Production Build

```bash
# Build for Chrome (Manifest V3)
pnpm build
# Output in: .output/chrome-mv3

# Build for Firefox (Manifest V3)
pnpm build:firefox
# Output in: .output/firefox-mv3
```

### Loading into Your Browser

1. **Chrome / Chromium**:
   - Navigate to `chrome://extensions/`.
   - Enable **Developer mode** in the top right.
   - Click **Load unpacked** and select `.output/chrome-mv3`.
2. **Firefox**:
   - Navigate to `about:debugging#/runtime/this-firefox`.
   - Click **Load Temporary Add-on...** and select `.output/firefox-mv3/manifest.json`.

---

## Architecture

The codebase enforces strict separation of concerns:

```
src/lib/
├── errors.ts              # Domain errors with user-friendly explanations
├── filename.ts            # Filesystem-safe filename sanitization & fallbacks
├── glb-validator.ts       # Binary GLB validator (magic bytes, version, JSON chunk, metadata)
├── logger.ts              # Scoped logger with sensitive credential scrubbing
├── messages.ts            # Strongly typed discriminated unions and type guards
├── storage.ts             # Local settings and download history management
├── tab-state.ts           # Per-tab state isolation & stale revision protection
├── texture-format.ts      # Texture transcoding (WebP, PNG, JPEG)
├── tripo-processing.ts    # Meshopt decoding and dequantization pipeline
├── meshy/                 # Meshy-specific modules
│   ├── gltf-normalizer.ts # Normalizes quantized POSITION accessors
│   ├── model-state.ts     # In-memory model cache & correlation
│   ├── page-context.ts    # Model title extraction from DOM/route
│   └── texture-embedder.ts# Embeds separate PNG textures into GLB BIN chunk
└── providers/             # Multi-provider abstraction
    ├── provider.interface.ts # ModelProvider interface
    ├── registry.ts           # Provider registry and matching
    ├── meshy/                # Meshy provider implementation & constants
    ├── tripo/                # Tripo provider implementation & constants
    ├── luma/                 # Luma AI provider implementation & constants
    ├── rodin/                # Rodin / Hyper3D provider implementation & constants
    ├── sketchfab/            # Sketchfab provider implementation & constants
    ├── polypizza/            # Poly Pizza provider implementation & constants
    └── polyhaven/            # Poly Haven provider implementation & constants
```

### Runtime Data Flow

1. **Detection**:
   - On Meshy, an unprivileged MAIN-world hook monitors worker messages for decoded model buffers and network requests for `model.json`/`model.meshy`.
   - On Tripo, Luma, Rodin, Sketchfab, Poly Pizza, and Poly Haven, content scripts and resource observers identify loaded model and asset URLs.
2. **Validation**:
   - Assets are checked through `validateGlb`. Non-GLB payloads (HTML error pages, JSON API errors, images) are rejected with human-readable errors.
3. **State Management**:
   - Detected models are registered in `tabStateManager` keyed by `tabId`. Bumping revision counters prevents older asynchronous callbacks from overwriting active models.
4. **Download**:
   - Initiated via `executeDownload` without base64 transcoding. The model is validated, sanitized, downloaded via DOM Blob, and the blob URL is revoked.

---

## Extension Permissions & CSP

| Permission | Purpose |
| :--- | :--- |
| `tabs` | Query active tab, isolate state per tab, detect navigation (`tabs.onUpdated`) to invalidate stale model state, and clean up closed tabs (`tabs.onRemoved`). |
| `storage` | Persist user preferences (preferred texture format, auto-prompt) and local download history (up to 20 items, containing no credentials). |
| `activeTab` | Temporary interaction with the active tab when opening the extension popup. |
| Host permissions | Strictly scoped to supported platforms (`*.meshy.ai`, `*.tripo3d.ai`, `*.lumalabs.ai`, `*.deemos.com`, `*.sketchfab.com`, `*.poly.pizza`, `*.polyhaven.com`, etc.). No `<all_urls>`. |

### Content Security Policy (CSP)

`script-src 'self' 'wasm-unsafe-eval'; object-src 'self';`

**Rationale for `'wasm-unsafe-eval'`**: Under Manifest V3, compiling WebAssembly binary modules (`meshoptimizer/decoder` for decoding compressed 3D models) requires `'wasm-unsafe-eval'` in extension pages. No remote code or dynamic code evaluation is used.

---

## Model Processing Fidelity Guarantee

All GLB processing strictly preserves:
- Node hierarchy & transforms
- Vertex attributes (positions, normals, tangents, colors, UV0, UV1+)
- Skinning, armatures, bones, inverse bind matrices
- Morph targets & blendshape weights
- Materials, PBR metallic-roughness factors, and textures
- Animations and animation tracks

The extension **never** performs automatic decimation, mesh reduction, vertex removal, or destructive simplification.

---

## Adding a New Provider

Future 3D providers can be added without modifying the popup UI or background service worker:

1. Create a folder in `src/lib/providers/<provider_id>/`.
2. Implement the `ModelProvider` interface (`matchesUrl`, `extractModelId`, `isModelAsset`, `formatFilename`).
3. Register the provider in `src/lib/providers/registry.ts`.
4. Add host permissions in `wxt.config.ts`.

---

## Testing & Quality

Automated tests are powered by [Vitest](https://vitest.dev/):

```bash
# Run automated test suite
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run TypeScript typecheck
pnpm typecheck

# Run linting check
pnpm lint
```

---

## Attribution & License

This project is licensed under the [Mozilla Public License 2.0](LICENSE).

Based in part on open-source contributions under the Mozilla Public License 2.0.
