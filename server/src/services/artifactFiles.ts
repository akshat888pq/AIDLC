import fs from 'fs';

/**
 * Every artifact document is stored as `<ownerId>-<docId>.json`, where the owner is
 * a project id (architecture, design, tests, release) or a project's session id
 * (requirements). Ownership must be matched on the full id plus its separator: a bare
 * `startsWith(ownerId)` also matches any id that merely begins with this one, which
 * is how one project ends up listing another project's documents.
 */
export function ownedBy(fileName: string, ownerId: string): boolean {
  return fileName.startsWith(`${ownerId}-`) && fileName.endsWith('.json');
}

/** File names in `dir` belonging to `ownerId`, sorted by name. */
export function ownedFiles(dir: string, ownerId: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => ownedBy(f, ownerId)).sort();
}

/**
 * Folder name for a project's finalized markdown. The id suffix keeps two projects
 * that share a name (or normalize to the same name) from writing over each other.
 */
export function projectOutputDirName(projectName: string, ownerId: string): string {
  const safeName = (projectName || 'project').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
  return `${safeName}-${ownerId.slice(0, 8)}`;
}
