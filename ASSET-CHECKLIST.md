# Flowerpot — Asset & Content Checklist

Fill in everything below. Anything left blank, I'll placeholder so we can keep building.
Check `[x]` when an item is delivered.

---

## 1. Text content

### 1.1 Background line
- [x] Confirm exact text (default: `Pick one for yourself <3`)

> **Text:** _______________________________________________

### 1.2 Flower hover popups (one short line each)
Map each line to a specific flower so I wire them correctly.

| Flower | Filename (see §3) | Popup text |
|--------|-------------------|------------|
| Flower 1 | `flower_01.glb` | _______________________________ |
| Flower 2 | `flower_02.glb` | _______________________________ |
| Flower 3 | `flower_03.glb` | _______________________________ |

### 1.3 Poem (right side, scroll-reveals)
Paste the full poem. Mark line/stanza breaks how you want them revealed
(blank line = new reveal group is fine, or tell me your preference).

```
(paste poem here)


```

- [ ] Reveal granularity: `[ ] per line   [ ] per stanza   [ ] all at once`

### 1.4 Signature
- [ ] Confirm exact text (default: `love, omu`)

> **Signature:** _______________________________________

---

## 2. Font

- [ ] I want to pick a specific font  →  name / file: ______________________
- [ ] Claude, choose a handwritten-style font that matches the sketches

Delivery: drop a `.woff2` (preferred) or `.ttf` into `assets/fonts/`.

- [ ] Same font for background 3D text as for the poem/UI?  `[ ] yes  [ ] different (specify): ______`

---

## 3. 3D models  (`.glb`, painterly, hand-painted baseColor)

Export rules that keep code clean (see notes at bottom):

- [ ] Bloom morph target named **`bloom`** (range 0→1) on **all three** flowers
- [ ] Flower origin at **base of stem**, neutral rotation
- [ ] Consistent scale across the three flowers
- [ ] Head has an empty/locator node named **`flower_anchor`** placed in the hair
- [ ] Empty/locator export **enabled** in exporter settings

| Asset | Filename | Delivered | Bloom morph OK | Origin/anchor OK |
|-------|----------|-----------|----------------|------------------|
| Flower 1 | `flower_01.glb` | [ ] | [ ] | [ ] |
| Flower 2 | `flower_02.glb` | [ ] | [ ] | [ ] |
| Flower 3 | `flower_03.glb` | [ ] | [ ] | [ ] |
| Head     | `head.glb`      | [ ] | n/a | [ ] |

---

## 4. Textures

| Texture | For | Delivered | Notes |
|---------|-----|-----------|-------|
| baseColor (painted) | flower 1 | [ ] | baked to UVs |
| baseColor (painted) | flower 2 | [ ] | |
| baseColor (painted) | flower 3 | [ ] | |
| baseColor | head | [ ] | painted or flat |
| AO map *(optional)* | per model | [ ] | enables depth-shading toggle; skip = runtime light fallback |

- [ ] Textures embedded in `.glb`  **or**  [ ] separate files in `assets/textures/`

---

## 5. "Painted-in" transition brush

- [ ] Claude generates the reveal mask (default)
- [ ] I'll supply a **seamless grayscale brush-stroke texture** → `assets/textures/brush_mask.png`

---

## 6. Audio (optional)

- [ ] Silent (default)
- [ ] Hover chime → file: ______________________
- [ ] Ambient loop → file: ______________________

---

## Folder layout (drop files here)

```
assets/
  models/    flower_01.glb  flower_02.glb  flower_03.glb  head.glb
  textures/  (only if not embedded)  brush_mask.png (optional)
  fonts/     yourfont.woff2
  audio/     (optional)
```

---

## Why the export rules matter
- **Identical morph name (`bloom`)** → hover-bloom works on all flowers with zero special-casing. Mismatched names fail silently.
- **`flower_anchor` locator exported** → flower snaps exactly into the hair; survives you re-tweaking the head later. If stripped on export, position gets hardcoded and breaks on head edits.
