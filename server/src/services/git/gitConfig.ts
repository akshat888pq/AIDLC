import fs from 'fs';
import path from 'path';
import type { GitRepoConfig } from '../../types/index.js';

const CONFIG_DIR = path.resolve('data');

function ensureDir() {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function configPath(projectId: string): string {
  return path.join(CONFIG_DIR, `git-config-${projectId}.json`);
}

export function getGitConfig(projectId: string): GitRepoConfig | null {
  ensureDir();
  const fp = configPath(projectId);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, 'utf-8'));
}

export function saveGitConfig(projectId: string, config: GitRepoConfig): void {
  ensureDir();
  fs.writeFileSync(configPath(projectId), JSON.stringify(config, null, 2));
}

export function deleteGitConfig(projectId: string): void {
  const fp = configPath(projectId);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
}
