import type { Project, StageWindow, WindowKind } from '../types';

export const DURATION_MS = 20_000;
export const STORAGE_KEY = 'desktop-stage-project-v1';

export const WINDOW_PRESETS: Record<WindowKind, Pick<StageWindow, 'title' | 'content' | 'color'>> = {
  browser: { title: 'New browser', content: 'Welcome to a new page.\n\nAdd your story here.', color: '#5ca9ff' },
  code: { title: 'untitled.ts', content: '// Begin writing\n\nconst scene = createWindow();', color: '#47db91' },
  note: { title: 'New note', content: 'A thought worth keeping.', color: '#ff75a0' },
};

export const STARTER_PROJECT: Project = {
  version: 1,
  windows: [
    { id: 'code', kind: 'code', title: 'src/login.ts', content: "// Validate a user session\nconst user = await db.user.find(id);\n\nif (!user) {\n  return res.status(401).json({ error: 'No session' });\n}\n\nreturn { name: user.name, plan: user.plan };", color: '#7c6cff', x: 82, y: 102, width: 350, height: 310, opacity: 1, scale: 1, z: 1 },
    { id: 'terminal', kind: 'code', title: 'terminal — zsh', content: 'Session started\nstudio@desktop ~ % npm run render\n\n  Desktop Stage ready\n  Preview: localhost:5173\n\nstudio@desktop ~ % _', color: '#47db91', x: 380, y: 80, width: 420, height: 250, opacity: 1, scale: 1, z: 3 },
    { id: 'browser', kind: 'browser', title: 'Studio Dashboard', content: 'A calm place to build scenes.\n\nOpen windows, arrange the story,\nand let the desktop do the talking.', color: '#fa9d4c', x: 520, y: 200, width: 380, height: 285, opacity: 1, scale: 1, z: 4 },
    { id: 'chat', kind: 'note', title: 'Chats', content: 'M. Boss  — check it out ✨\nBeta Test  — nearly there\nPanda  — You good?\nWilliams  — Yo, you up?', color: '#ff6b8b', x: 180, y: 350, width: 245, height: 205, opacity: 1, scale: 1, z: 2 },
  ],
  keyframes: {},
};

export function createStarterProject(): Project {
  return structuredClone(STARTER_PROJECT);
}
