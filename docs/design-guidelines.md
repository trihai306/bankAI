# Design Guidelines

## Visual Style: "Modern Violet AI"
The application uses a dark, high-contrast theme focused on violet and purple tones with neon glow effects.

### Color Palette (Tailwind)
- **Primary**: `violet-600` (#7c3aed)
- **Secondary**: `purple-600` (#9333ea)
- **Accent**: `fuchsia-500` (#d946ef)
- **Background**: `gray-950` (#030712)
- **Surface**: `gray-900/50` with backdrop blur (glassmorphism)

## UI Patterns

### Glassmorphism
Apply transparency and backdrop blur to cards and sidebars:
```html
<div class="bg-gray-900/50 backdrop-blur-md border border-gray-800">...</div>
```

### Glow Effects
Use text-shadow and box-shadow for "AI" elements:
```html
<div class="shadow-[0_0_15px_rgba(139,92,246,0.3)]">...</div>
```

### Typography
- **Headings**: Sans-serif, bold, often with gradients.
- **Body**: Standard sans-serif for high readability.
- **Monospace**: Used for logs, transcripts, and model outputs.

## Component Standards

### Navigation
- Vertical sidebar on the left.
- Icons from `lucide-react`.
- Active states should have a violet glow/indicator.

### Data Visualization
- **Waveforms**: Canvas-based real-time visualization for audio.
- **Resource Bars**: Custom progress bars for CPU/RAM monitoring.
- **Stats**: Large, bold numbers with descriptive labels.

### Layout
- **Max Width**: The app is designed for desktop resolutions (1280px+).
- **Spacing**: Generous use of `gap-6` and `p-6` for a spacious feel.
- **Transitions**: Use `framer-motion` or CSS transitions for page changes and hover states.
