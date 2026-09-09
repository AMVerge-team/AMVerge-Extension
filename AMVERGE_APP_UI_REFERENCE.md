# AMVergeApp UI Reference — Design & Component Patterns

> Source: `C:\Users\Moongetsu\Documents\GitHub\AMVerge-Org\AMVergeApp\frontend`
>
> Tech: React 19 + TypeScript + plain CSS + Tauri v2 (desktop shell)
>
> This doc extracts UI patterns, design tokens, and component logic for reuse in the CEP extension.

---

## Design Tokens

### CSS Custom Properties (`:root`)

| Variable | Value | Usage |
|---|---|---|
| `--accent` | `#22c55e` | Primary accent — buttons, borders, highlights, active states |
| `--accent-rgb` | `34 197 94` | RGB triplet for `rgba()` usage |
| `--bg-accent` | `#001a00` | Dark green gradient complement |
| `--selector-active-bg` | `#003a23` | Active dropdown item background |
| `--selector-active-fg` | `#00f07a` | Active dropdown item foreground |
| `--selector-active-border` | `#0b8f56` | Active dropdown item border |
| `--selector-active-desc` | `rgba(0,240,122,0.82)` | Active dropdown description text |
| `--app-bg-image` | `none` (dynamic) | User-set background media |
| `--app-bg-opacity` | `1` | Background opacity slider |
| `--app-bg-blur` | `0px` | Background blur slider |

### Body

- Background: `#000` + `linear-gradient(160deg, #000000 50%, var(--bg-accent) 100%)`
- Text: `white` primary, `rgba(255,255,255,0.6–0.9)` secondary
- `overflow: hidden` (no body scroll)
- `user-select: none` on everything
- Font: `'Jersey 10'` for UI, monospace for console/code

### Surfaces

- Panel backgrounds: `rgba(0,0,0,0.22–0.95)` with `backdrop-filter: blur(4–12px)`
- Borders: `rgba(255,255,255,0.1–0.25)`
- Border radius: `8px` standard, `12px` for larger panels, `15px` for clip tiles
- Shadows: `0 10px 30px rgba(0,0,0,0.3)`, `0 8px 32px rgba(0,0,0,0.5)`

---

## CSS Architecture

21 plain CSS files, no Tailwind/modules/Styled Components:

```
styles/
  index.css            @import hub
  variables.css        :root custom properties + Google Fonts import
  base.css             resets, body, .buttons, .status-dot, .beta-badge
  navbar.css           top navbar
  sidebar.css          sidebar, episode panel, context menus, modals
  common/
    animations.css     @keyframes: spin, shimmer, fadeIn, clipFadeIn, introFadeUp
    dropdown.css       custom <Dropdown> component
    colorPicker.css    custom <ColorPicker> + react-colorful overrides
    overlays.css       loading overlay, import terminal, drag overlay, bg-progress-bar
    startupNotification.css
  home/
    layout.css         .app-root, .window-wrapper, .split-layout, .divider
    clipsGrid.css      .clips-container, .clips-grid, .clip-wrapper, .clip-download-btn
    preview.css        .preview-container, .preview-window, .export-panel
    importButtons.css  .clips-import, .import-button, .checkbox-row, .custom-checkbox
  menu/
    menu.css, about.css, console.css, patchnotes.css, credits.css, bugreport.css
  settings/
    settings.css       settings rows, dropdowns, profile icon picker
    cropModal.css      crop modal + react-image-crop overrides
```

No dark/light theme switching — dark-only with accent color customization.

---

## Layout Patterns

### App Shell (3-Column)

```
┌──────────────┬──┬──────────────────────────────┐
│  Sidebar     │D │  Content Area                 │
│  (220px–     │I │  ┌───────────────────────┐    │
│   60vw)      │V │  │  Navbar               │    │
│              │I │  ├───────────────────────┤    │
│  ┌────────┐  │D │  │  Main Content         │    │
│  │ Nav    │  │E │  │  ┌───LEFT───┬───RIGHT─┤    │
│  │ Home   │  │R │  │  │ Clips    │ Preview │    │
│  │ Menu   │  │  │  │  │ Grid     │ +Export │    │
│  │Settings│  │  │  │  │          │         │    │
│  ├────────┤  │  │  │  └──────────┴─────────┘    │
│  │Episode │  │  │  │                             │
│  │Panel   │  │  │  └───────────────────────┘    │
│  └────────┘  │  │                               │
└──────────────┴──┴──────────────────────────────┘
```

Key CSS:
```css
.app-root { display: flex; flex-direction: column; height: 100vh; }
.window-wrapper, .content-wrapper, .main-content { display: flex; flex: 1; }
.sidebar-container { width: var(--amverge-sidebar-width, 280px); flex: 0 0 var(...); }
.split-layout { display: flex; flex: 1; }
.left-pane { flex: 1; min-width: 0; }
.right-pane { min-width: 280px; }
.divider { width: 10px; cursor: col-resize; }
```

### Split Layout (Home Page)

Resizable horizontal split:
- Left: `ClipsContainer` (scrollable grid)
- Right: `PreviewContainer` (preview player + export panel)
- Divider: 10px wide, `col-resize` cursor

### Sidebar

- Fixed width range: 220px – 60vw, draggable resize
- Top: 3 nav buttons (Home/Menu/Settings) in CSS grid `repeat(3, 1fr)`
- Bottom: Episode panel (folder tree, episode list, context menus)
- Border: right-side separator

---

## Component Patterns (Adaptable to Vanilla JS)

### 1. Navigation / Tab System

**Sidebar buttons:**
```css
.sidebar-button > .sidebar-nav-button.is-active {
    background: rgb(var(--accent-rgb) / 0.18);
    color: var(--accent);
    border-color: rgb(var(--accent-rgb) / 0.9);
}
```

Page switching via state enum `"home" | "menu" | "settings"`.
Home page stays **always mounted** (hidden via `display`), preserving scroll position.

### 2. Buttons

```css
.buttons {
    height: 30px; font-size: 20px;
    border: 1px solid white;
    background: rgba(15, 0, 0, 0.1);
    backdrop-filter: blur(4px);
    color: white; border-radius: 8px;
}
.buttons:hover {
    border-color: var(--accent);
    background: rgb(var(--accent-rgb) / 0.16);
    color: var(--accent);
}
```

### 3. Custom Dropdown

Full select replacement. Structure:
```html
<div class="custom-dropdown [open] [open-up] [disabled]">
  <div class="dropdown-trigger">
    <span class="dropdown-value [rich]">...</span>
    <span class="dropdown-icon [rotate]">▼</span>
  </div>
  <div class="dropdown-menu">
    <div class="dropdown-item [active]">
      <div class="dropdown-item-main">
        <span class="dropdown-item-icon">...</span>
        <div class="dropdown-item-content">
          <span class="dropdown-item-label">Label</span>
          <span class="dropdown-item-description">Desc</span>
        </div>
      </div>
    </div>
  </div>
</div>
```

Features: opens up/down based on viewport, rich items (icon + label + desc), keyboard navigation, fade-in animation.

### 4. Custom Checkbox

```css
.custom-checkbox { /* invisible native checkbox */ }
.checkmark { /* styled box */ }
.custom-checkbox:checked + .checkmark { background: var(--accent); }
```

### 5. Color Picker

Popover with `react-colorful` hex picker + preset color grid + manual hex input.
```css
.color-picker-popover {
    background: rgba(0,0,0,0.95); backdrop-filter: blur(10px);
    border: 1px solid rgba(255,255,255,0.15); border-radius: 12px;
}
.color-presets-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; }
```

### 6. Settings Form Rows

```css
.settings-row {
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px; height: 40px;
}
.settings-label { font-size: 22px; }
.settings-label.compact { font-size: 18px; color: rgb(255 255 255 / 0.78); }
.settings-control { display: flex; align-items: center; gap: 10px; }
```

Input styles:
```css
.settings-text-input, .settings-number-input {
    height: 32px; border: 1px solid rgb(255 255 255 / 0.16);
    border-radius: 8px; background: rgb(255 255 255 / 0.08); color: white;
    font-family: inherit; font-size: 20px;
}
.settings-text-input:focus { border-color: var(--accent); box-shadow: 0 0 10px rgb(var(--accent-rgb) / 0.24); }
.settings-select {
    background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15);
    border-radius: 8px; color: rgba(255,255,255,0.85); padding: 6px 12px;
}
```

Range slider:
```css
input[type="range"]::-webkit-slider-runnable-track { background: rgba(255,255,255,0.1); height: 6px; border-radius: 3px; }
input[type="range"]::-webkit-slider-thumb { background: var(--accent); height: 16px; width: 16px; border-radius: 50%; box-shadow: 0 0 10px var(--accent); }
```

### 7. Clip Tiles (Card Grid)

```css
.clips-grid {
    --cell-size: 180px;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--cell-size)), min(100%, var(--cell-size))));
    gap: 15px; padding: 15px;
}
.clip-wrapper {
    aspect-ratio: 1 / 1; border-radius: 15px;
    contain: layout paint; cursor: pointer;
    transition: transform 0.18s ease-out, box-shadow 0.18s ease-out;
}
.clip-wrapper:hover {
    transform: translateY(-6px) scale(1.04);
    box-shadow: 0 10px 30px rgb(var(--accent-rgb) / 0.15), 0 0 0 1px rgb(var(--accent-rgb) / 0.25);
}
```

### 8. Modal Overlay

```css
.loading-overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.6);
    display: flex; justify-content: center; align-items: center;
    z-index: 1000;
}
```

### 9. Progress Bar

```css
.progress-bar { width: 150px; height: 8px; background: #333; border-radius: 4px; overflow: hidden; }
.progress-fill { height: 100%; background: var(--accent); transition: width 0.2s ease; }
```

### 10. Toast / Status Indicator

```css
.status-dot { width: 10px; height: 10px; border-radius: 999px; }
.status-dot.ok { background: rgba(0,255,34,0.9); box-shadow: 0 0 8px rgba(0,255,34,0.9); }
.status-dot.bad { background: #ff3b3b; box-shadow: 0 0 8px rgba(255,59,59,0.9); }
```

### 11. Spinner

```css
.spinner {
    width: 60px; height: 60px;
    border: 6px solid rgba(255,255,255,0.2);
    border-top: 6px solid var(--accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
}
```

---

## Animations

```css
@keyframes spin { to { transform: rotate(360deg); } }

@keyframes shimmer {
    0% { background-position: 100% 0; }
    100% { background-position: 0 0; }
}
.clip-skeleton {
    background: linear-gradient(90deg, #161616 25%, rgb(var(--accent-rgb) / 0.25) 37%, #161616 63%);
    background-size: 400% 100%;
    animation: shimmer 1.2s infinite;
}

@keyframes clipFadeIn {
    from { opacity: 0; transform: translateY(10px) scale(0.97); }
    to { opacity: 1; transform: translateY(0) scale(1); }
}
.clip-appear {
    animation: clipFadeIn 0.4s cubic-bezier(0.22, 1, 0.36, 1) backwards;
    animation-delay: var(--appear-delay, 0ms);
}

@keyframes introFadeUp {
    from { opacity: 0; transform: translateY(14px); }
    to { opacity: 1; transform: translateY(0); }
}

@keyframes dropdown-fade-in {
    from { opacity: 0; transform: translateY(-8px); }
    to { opacity: 1; transform: translateY(0); }
}
```

Transition curves: `0.18s ease-out` (tiles), `0.2s ease` (dropdowns), `0.25s cubic-bezier(0.4, 0, 0.2, 1)` (triggers), `0.4s cubic-bezier(0.22, 1, 0.36, 1)` (entrance).

---

## Key Dependencies (For Reference)

| Package | Purpose |
|---|---|
| `react-icons` (Fa/Fi) | All icons |
| `react-colorful` | Color picker widget |
| `react-markdown` | Markdown rendering (patch notes) |
| `zustand` | State management (persist middleware) |
| `react-image-crop` | Image cropping |

Icons used: `FiHome`, `FiMenu`, `FiSettings`, `FiDownload`, `FiChevronDown`, `FiX`, `FiCheck`, `FiTrash2`, `FiFolder`, `FiPlus`, `FiSearch`.

---

## State Management Pattern (React → Vanilla JS Mapping)

| Zustand Store | Vanilla JS Equivalent |
|---|---|
| `UIStore` → `activePage`, `cols`, `sidebarWidth` | `App._activePage`, DOM class toggles |
| `appStore` → `clips[]`, `loading`, `selectedClips` | `window.App.clips = []`, render on change |
| `settingsStore` → settings + export profiles | `App.settings` object + `StorageManager` |
| `episodeStore` → episodes, folders | Project/collection data in `localStorage` |
| `scenePreviewStore` → WebP paths per clip | Per-clip state in clip data objects |

Core concept: single global `App` object (or `window.App`) holds all mutable state. Components read from `App.*`, write via `App.method()`, which triggers re-render of affected DOM regions. No virtual DOM — targeted innerHTML or element manipulation.

---

## To Adapt for CEP Extension

### CSS to Port Directly
1. `variables.css` — design tokens (change font to Archivo for CEP)
2. `base.css` — resets, body gradient, button base, status dots
3. `dropdown.css` — custom dropdown (most useful component)
4. `animations.css` — spin, shimmer, fadeIn
5. `overlays.css` — modal overlay, spinner, progress bar, terminal
6. `settings.css` — form rows, inputs, sliders, selects
7. `colorPicker.css` — color picker popover (simplified, no react-colorful dependency)

### Patterns to Implement in Vanilla JS
1. **Tab navigation** — sidebar buttons + page switching via `display:none/block`
2. **Custom dropdown** — click trigger → positioned menu → item select → callback
3. **Custom checkbox** — hidden native input + styled `.checkmark`
4. **Resizable split panels** — mousedown on divider → track mousemove → update flex
5. **Skeleton loading** — shimmer animation on placeholder elements
6. **Clip tile grid** — CSS grid with hover lift + accent glow
7. **Toast notifications** — fixed-position overlay, auto-dismiss timer
