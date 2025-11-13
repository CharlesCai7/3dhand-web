# 3dhand-web
3dhand-web repo

## How to start

```
cd vision-hand-playback/src
npm run dev
```

hosting at:
```
http://localhost:5173/
```



https://github.com/user-attachments/assets/e2ceb034-dade-4a3c-9c48-9f647ffe99d2



Then upload the `hand-gesture-example copy.json` file and play around

## Core Features
- Drag & drop or click to upload JSON
- Floating control bar w/ Play/Pause, Speed, Loop, Axes, Fit
- Keyboard: Space, ←/→ step, Home/End, L toggle loop, A toggle axes

## Project structure (Important part only)
```
.
├── src
│   ├── App.css
│   ├── App.tsx
│   ├── assets
│   │   └── react.svg
│   ├── index.css
│   ├── main.tsx
│   ├── postcss.config.js
│   └── tailwind.config.js
├── index.html

```

## Pre Notes
Will need to set up npm and tsx environment

## Post Notes
When committing changes:
- Update the Project Structure section above if any files are added, removed, or reorganized.
**Maintainers should not approve commits that modify structure without updating this README.**

To quickly regenerate the structure:
```
cd your/project/directory
```
```
# Install tree if necessary:
brew install tree
```
```
tree
```
## Project Log
Whenever updating the project, please clearly confirm the following sections are updated in this README, **by updating this log**:
- New or changed features
- Requirements and Dependencies (if need update)
- Files that were modified (Project Structure)
- TODO
- Any breaking or relevant implementation notes

Format:
```
### Date (YYYY-MM-DD) (NAME of the Developer)
**Summary:** Short description of what changed.
```

Updating Log:

```
### 2025-11-7 Charles Yushi Cai
**Summary:** Initial Push
```

## TODOs
- Placeholder

## Debug Guiding
#### Meta:
- When implementing new features or fixing issues, verify that all existing functionality still works. Avoid solving one bug by introducing new ones.

#### Current Status:
- Placeholder
