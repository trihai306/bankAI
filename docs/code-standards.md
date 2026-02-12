# Code Standards

## General Principles
- **KISS**: Keep It Simple, Stupid.
- **DRY**: Don't Repeat Yourself.
- **YAGNI**: You Aren't Gonna Need It.

## File Organization
- **Electron Backend**: All logic in `electron/`.
- **Frontend Pages**: One file per major route in `src/pages/`.
- **Frontend Components**: Reusable UI in `src/components/`.
- **Python**: ML-heavy scripts in `python/` with a shared `venv`.

## Naming Conventions
- **Files**: `kebab-case.js`, `PascalCase.jsx` for components/pages.
- **Variables/Functions**: `camelCase`.
- **CSS Classes**: Tailwind utility classes.
- **IPC Namespaces**: Short, descriptive names (`db`, `tts`, `qwen`).

## Frontend Patterns (React)
- **State**: Use Zustand (`src/store/useStore.js`) for global state.
- **Styling**: Tailwind CSS 3. Use glassmorphism and glow effects for consistency.
- **Icons**: `lucide-react`.
- **API Access**: Strictly through `window.electronAPI`. Check availability for browser-mode safety.

## Backend Patterns (Electron)
- **IPC**: Use `ipcMain.handle` for async operations (returns Promise to renderer).
- **Subprocesses**: Use `spawnPython` helper for AI scripts to handle stdout/stderr consistently.
- **Database**: Use `better-sqlite3` with prepared statements for security.
- **File System**: Validate all paths before I/O. Use `path.join` and `app.getPath`.

## Python Standards
- Use `argparse` for CLI arguments.
- Return results as a single JSON line on the final `stdout`.
- Maintain a `requirements.txt` in the root or `python/` dir.
- Use explicit logging to `stderr` so it doesn't pollute JSON output on `stdout`.

## Error Handling
- **Frontend**: Catch errors in Zustand actions or component `useEffect` and display toast/error states.
- **Backend**: Wrap IPC handlers in `try-catch`. Return informative error objects to the renderer.
- **AI**: Detect and report model availability or resource exhaustion.
