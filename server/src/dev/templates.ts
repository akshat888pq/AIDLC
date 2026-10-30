import { fileExists, writeFile } from './workspace.js';

export interface ScaffoldTemplate {
  id: string;
  name: string;
  description: string;
  stack: string[];
  postCreate?: string;
  files: Record<string, string>;
}

const gitignore = `node_modules/
dist/
build/
.env
.venv/
__pycache__/
*.log
`;

const reactVite: Record<string, string> = {
  'package.json': JSON.stringify(
    {
      name: 'web-app',
      private: true,
      version: '0.1.0',
      type: 'module',
      scripts: { dev: 'vite', build: 'tsc -b && vite build', preview: 'vite preview' },
      dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' },
      devDependencies: {
        '@types/react': '^18.3.12',
        '@types/react-dom': '^18.3.1',
        '@vitejs/plugin-react': '^4.3.4',
        typescript: '^5.7.2',
        vite: '^6.0.3',
      },
    },
    null,
    2
  ),
  'tsconfig.json': JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2020',
        lib: ['ES2020', 'DOM', 'DOM.Iterable'],
        module: 'ESNext',
        moduleResolution: 'bundler',
        jsx: 'react-jsx',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
      include: ['src'],
    },
    null,
    2
  ),
  'vite.config.ts': `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5180 },
});
`,
  'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Web App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
  'src/main.tsx': `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`,
  'src/App.tsx': `import { useState } from 'react';

export default function App() {
  const [count, setCount] = useState(0);
  return (
    <main className="app">
      <h1>Hello from AIDLC</h1>
      <p>Edit <code>src/App.tsx</code> or ask the agent to build a feature.</p>
      <button onClick={() => setCount((c) => c + 1)}>Clicked {count} times</button>
    </main>
  );
}
`,
  'src/index.css': `:root { font-family: system-ui, sans-serif; color: #1e293b; background: #f8fafc; }
.app { max-width: 720px; margin: 4rem auto; padding: 0 1rem; }
button { padding: 0.5rem 1rem; border-radius: 6px; border: 1px solid #cbd5e1; background: white; cursor: pointer; }
`,
};

const expressApi: Record<string, string> = {
  'package.json': JSON.stringify(
    {
      name: 'api',
      private: true,
      version: '0.1.0',
      type: 'module',
      scripts: { dev: 'tsx watch src/index.ts', build: 'tsc', start: 'node dist/index.js' },
      dependencies: { express: '^4.21.1', cors: '^2.8.5' },
      devDependencies: {
        '@types/express': '^4.17.21',
        '@types/cors': '^2.8.17',
        tsx: '^4.19.2',
        typescript: '^5.7.2',
      },
    },
    null,
    2
  ),
  'tsconfig.json': JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        outDir: 'dist',
        rootDir: 'src',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
      },
      include: ['src'],
    },
    null,
    2
  ),
  'src/index.ts': `import express from 'express';
import cors from 'cors';
import { healthRouter } from './routes/health.js';

const app = express();
const PORT = Number(process.env.PORT ?? 4000);

app.use(cors());
app.use(express.json());
app.use('/api/health', healthRouter);

app.listen(PORT, () => console.log(\`API listening on http://localhost:\${PORT}\`));
`,
  'src/routes/health.ts': `import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});
`,
};

function prefix(files: Record<string, string>, dir: string): Record<string, string> {
  return Object.fromEntries(Object.entries(files).map(([p, c]) => [`${dir}/${p}`, c]));
}

export const TEMPLATES: ScaffoldTemplate[] = [
  {
    id: 'react-vite',
    name: 'React + Vite (TypeScript)',
    description: 'Single-page web app with React 18, Vite and strict TypeScript.',
    stack: ['React', 'Vite', 'TypeScript'],
    postCreate: 'npm install',
    files: { ...reactVite, '.gitignore': gitignore, 'README.md': '# Web App\n\n```bash\nnpm install\nnpm run dev\n```\n' },
  },
  {
    id: 'express-api',
    name: 'Express API (TypeScript)',
    description: 'REST API on Express with a health route and hot reload via tsx.',
    stack: ['Node.js', 'Express', 'TypeScript'],
    postCreate: 'npm install',
    files: { ...expressApi, '.gitignore': gitignore, 'README.md': '# API\n\n```bash\nnpm install\nnpm run dev\n```\n' },
  },
  {
    id: 'fullstack',
    name: 'Full-stack (React + Express)',
    description: 'Monorepo with a React client and an Express API side by side.',
    stack: ['React', 'Express', 'TypeScript', 'npm workspaces'],
    postCreate: 'npm install',
    files: {
      'package.json': JSON.stringify(
        {
          name: 'fullstack-app',
          private: true,
          workspaces: ['client', 'server'],
          scripts: {
            'dev:client': 'npm run dev --workspace=client',
            'dev:server': 'npm run dev --workspace=server',
          },
        },
        null,
        2
      ),
      ...prefix(reactVite, 'client'),
      ...prefix(expressApi, 'server'),
      '.gitignore': gitignore,
      'README.md': '# Full-stack App\n\n```bash\nnpm install\nnpm run dev:server\nnpm run dev:client\n```\n',
    },
  },
  {
    id: 'fastapi',
    name: 'Python FastAPI',
    description: 'Python API with FastAPI, uvicorn and a pytest smoke test.',
    stack: ['Python', 'FastAPI', 'pytest'],
    postCreate: 'python -m venv .venv',
    files: {
      'requirements.txt': 'fastapi>=0.115\nuvicorn[standard]>=0.32\npytest>=8.3\nhttpx>=0.27\n',
      'app/__init__.py': '',
      'app/main.py': `from fastapi import FastAPI

app = FastAPI(title="API")


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}
`,
      'tests/test_health.py': `from fastapi.testclient import TestClient
from app.main import app


def test_health():
    response = TestClient(app).get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
`,
      '.gitignore': gitignore,
      'README.md': '# FastAPI\n\n```bash\npython -m venv .venv\n.venv\\Scripts\\activate  # or source .venv/bin/activate\npip install -r requirements.txt\nuvicorn app.main:app --reload\n```\n',
    },
  },
  {
    id: 'static',
    name: 'Static site (HTML/CSS/JS)',
    description: 'No build step: plain HTML, CSS and JavaScript.',
    stack: ['HTML', 'CSS', 'JavaScript'],
    files: {
      'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Site</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <h1>Hello from AIDLC</h1>
    <script src="main.js"></script>
  </body>
</html>
`,
      'styles.css': 'body { font-family: system-ui, sans-serif; max-width: 720px; margin: 4rem auto; }\n',
      'main.js': "console.log('ready');\n",
    },
  },
];

export function getTemplate(id: string): ScaffoldTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

/** Write a template into the workspace. Existing files are kept and reported back. */
export function applyTemplate(sessionId: string, id: string): { written: string[]; skipped: string[] } {
  const template = getTemplate(id);
  if (!template) throw new Error(`Unknown template "${id}"`);
  const written: string[] = [];
  const skipped: string[] = [];
  for (const [rel, content] of Object.entries(template.files)) {
    if (fileExists(sessionId, rel)) {
      skipped.push(rel);
      continue;
    }
    writeFile(sessionId, rel, content);
    written.push(rel);
  }
  return { written, skipped };
}
