import matter from 'gray-matter';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { SpecTemplate } from './types';
import {
  getProjectSpecDir,
  getUserSpecDir,
  getSpecTemplatesDir,
  getTemplateRegistriesDir,
  listDir,
  readJSON,
  readText,
  writeJSON,
  toKebabCase,
} from './paths';
import { writeSpec } from './spec/io';
import { findProjectDirName } from './project';

// ─── 模板读取 ───

export interface TemplateData {
  [key: string]: unknown;
}

export type PlatformName = 'cursorRules' | 'claudeCode' | 'windsurfRules' | 'kiroSteering';

interface SpecTemplateManifest {
  description?: string;
  defaultScope?: 'project' | 'user' | 'global';
  source?: 'built-in' | 'custom';
}

export interface SyncedTemplateRegistry {
  repoUrl: string;
  registryDir: string;
  templateSourceDir: string;
  importedTemplates: string[];
}

export interface SpecTemplateRegistryInfo extends SyncedTemplateRegistry {
  exists: boolean;
}

export interface BundledSpecTemplateConflict {
  name: string;
  sourceDir: string;
  targetDir: string;
}

export interface SyncBundledSpecTemplatesOptions {
  templateNames?: string[];
  overwriteExistingNames?: string[];
}

export interface SyncBundledSpecTemplatesResult {
  synced: string[];
  conflicts: BundledSpecTemplateConflict[];
  missing: string[];
}

const moduleDir = __dirname;
const templateContentCache = new Map<string, string>();

function resolveTemplatePath(relativePath: string): string {
  const path = join(moduleDir, 'templates', relativePath);
  if (existsSync(path)) return path;
  throw new Error(`Template not found: ${relativePath}`);
}

function readBundledTemplate(relativePath: string): string {
  const cached = templateContentCache.get(relativePath);
  if (cached !== undefined) return cached;

  const content = readFileSync(resolveTemplatePath(relativePath), 'utf8');
  templateContentCache.set(relativePath, content);
  return content;
}

export function getBundledTemplateDir(relativePath: string): string {
  return resolveTemplatePath(relativePath);
}

const platformTemplatePaths: Record<PlatformName, string> = {
  cursorRules: 'platforms/cursor-rules.md',
  claudeCode: 'platforms/claude-code.md',
  windsurfRules: 'platforms/windsurf-rules.md',
  kiroSteering: 'platforms/kiro-steering.md',
};

function render(template: string, _data?: TemplateData): string {
  return template;
}

export function renderPlatformTemplate(name: PlatformName, data?: TemplateData): string {
  return render(readBundledTemplate(platformTemplatePaths[name]), data);
}

export function renderCursorRules(data?: TemplateData): string {
  return renderPlatformTemplate('cursorRules', data);
}

export function renderClaudeCode(data?: TemplateData): string {
  return renderPlatformTemplate('claudeCode', data);
}

export function renderWindsurfRules(data?: TemplateData): string {
  return renderPlatformTemplate('windsurfRules', data);
}

export function renderKiroSteering(data?: TemplateData): string {
  return renderPlatformTemplate('kiroSteering', data);
}

// ─── Spec 模板 ───

function getBundledSpecTemplatesDir(): string {
  return getBundledTemplateDir('spec');
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await listDir(dir);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    try {
      const entryStat = await stat(fullPath);
      if (entryStat.isDirectory()) {
        files.push(...(await listMarkdownFiles(fullPath)));
      } else if (entry.endsWith('.md')) {
        files.push(fullPath);
      }
    } catch {
      // 忽略不可访问路径
    }
  }

  return files;
}

async function listTemplateDirectories(rootDir: string): Promise<string[]> {
  const entries = await listDir(rootDir);
  const directories: string[] = [];

  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const entryPath = join(rootDir, entry);
    const entryExists = await stat(entryPath)
      .then(() => true)
      .catch(() => false);
    if (!entryExists) continue;

    const entryStat = await stat(entryPath).catch(() => null);
    if (entryStat?.isDirectory()) {
      directories.push(entry);
    }
  }

  return directories.sort();
}

async function readSpecTemplatesFromDir(rootDir: string): Promise<SpecTemplate[]> {
  const templateNames = await listTemplateDirectories(rootDir);
  const templates: SpecTemplate[] = [];

  for (const templateName of templateNames) {
    const templateDir = join(rootDir, templateName);

    const manifest =
      (await readJSON<SpecTemplateManifest>(join(templateDir, 'template.json'))) ?? {};
    const markdownFiles = await listMarkdownFiles(templateDir);
    const files = [];

    for (const filePath of markdownFiles) {
      const content = await readText(filePath);
      if (content === null) continue;
      files.push({
        relativePath: relative(rootDir, filePath),
        content,
      });
    }

    if (files.length === 0) continue;

    templates.push({
      name: templateName,
      description: manifest.description ?? `模板 ${templateName}`,
      defaultScope: manifest.defaultScope ?? 'project',
      source: manifest.source ?? 'custom',
      files,
    });
  }

  return templates;
}

export async function listBundledSpecTemplates(): Promise<SpecTemplate[]> {
  return readSpecTemplatesFromDir(getBundledSpecTemplatesDir());
}

export async function listSpecTemplates(): Promise<SpecTemplate[]> {
  return readSpecTemplatesFromDir(getSpecTemplatesDir());
}

export async function getSpecTemplate(name: string): Promise<SpecTemplate | null> {
  const templates = await listSpecTemplates();
  return templates.find((template) => template.name === name) ?? null;
}

/** 将 spec 模板应用到项目 */
export async function applySpecTemplate(
  username: string,
  projectId: string,
  templateName: string,
): Promise<string | null> {
  const template = await getSpecTemplate(templateName);
  if (!template) return null;

  let targetDir: string;
  if (template.defaultScope === 'project') {
    const dirName = await findProjectDirName(username, projectId);
    if (!dirName) return null;
    targetDir = getProjectSpecDir(username, dirName);
  } else {
    targetDir = getUserSpecDir(username);
  }

  let firstFilePath: string | null = null;

  for (const file of template.files) {
    const filePath = join(targetDir, file.relativePath);
    const parsed = matter(file.content);
    await writeSpec(filePath, parsed.data, parsed.content.trim());
    firstFilePath ??= filePath;
  }

  return firstFilePath;
}

function normalizeTemplateNames(templateNames: string[]): string[] {
  return [...new Set(templateNames.map((name) => name.trim()).filter(Boolean))];
}

export async function syncBundledSpecTemplates(
  options: SyncBundledSpecTemplatesOptions = {},
): Promise<SyncBundledSpecTemplatesResult> {
  const bundledTemplates = await listBundledSpecTemplates();
  const bundledTemplateMap = new Map(bundledTemplates.map((template) => [template.name, template]));
  const requestedTemplateNames = options.templateNames?.length
    ? normalizeTemplateNames(options.templateNames)
    : bundledTemplates.map((template) => template.name);
  const overwriteExisting = new Set(normalizeTemplateNames(options.overwriteExistingNames ?? []));

  const synced: string[] = [];
  const conflicts: BundledSpecTemplateConflict[] = [];
  const missing: string[] = [];
  const bundledSpecRoot = getBundledSpecTemplatesDir();
  const targetRoot = getSpecTemplatesDir();

  await mkdir(targetRoot, { recursive: true });

  for (const templateName of requestedTemplateNames) {
    if (!bundledTemplateMap.has(templateName)) {
      missing.push(templateName);
      continue;
    }

    const sourceDir = join(bundledSpecRoot, templateName);
    const targetDir = join(targetRoot, templateName);
    const targetExists = await stat(targetDir)
      .then(() => true)
      .catch(() => false);

    if (targetExists && !overwriteExisting.has(templateName)) {
      conflicts.push({
        name: templateName,
        sourceDir,
        targetDir,
      });
      continue;
    }

    await rm(targetDir, { recursive: true, force: true });
    await cp(sourceDir, targetDir, { recursive: true });
    synced.push(templateName);
  }

  return {
    synced,
    conflicts,
    missing,
  };
}

function getRegistrySlug(repoUrl: string): string {
  return toKebabCase(
    repoUrl
      .replace(/^https?:\/\//, '')
      .replace(/^git@/, '')
      .replace(/[:/]+/g, '-')
      .replace(/\.git$/, ''),
  );
}

function getRegistryMetaPath(registryDir: string): string {
  return join(registryDir, '.lattice-registry.json');
}

async function resolveTemplateSourceDir(registryDir: string): Promise<string> {
  const specDir = join(registryDir, 'spec');
  try {
    const specStat = await stat(specDir);
    if (specStat.isDirectory()) return specDir;
  } catch {
    // ignore
  }

  throw new Error('模板仓库缺少 spec/ 目录。请将模板放在仓库的 spec/<template-name>/ 下。');
}

async function copyTemplateFolders(sourceDir: string): Promise<string[]> {
  const templateNames = await listDir(sourceDir);
  const imported: string[] = [];
  const targetRoot = getSpecTemplatesDir();
  await mkdir(targetRoot, { recursive: true });

  for (const templateName of templateNames) {
    if (templateName.startsWith('.')) continue;
    const sourceTemplateDir = join(sourceDir, templateName);

    try {
      const sourceStat = await stat(sourceTemplateDir);
      if (!sourceStat.isDirectory()) continue;
    } catch {
      continue;
    }

    const targetTemplateDir = join(targetRoot, templateName);
    await rm(targetTemplateDir, { recursive: true, force: true });
    await cp(sourceTemplateDir, targetTemplateDir, { recursive: true });
    imported.push(templateName);
  }

  return imported;
}

export async function syncSpecTemplateRegistry(repoUrl: string): Promise<SyncedTemplateRegistry> {
  const registriesDir = getTemplateRegistriesDir();
  await mkdir(registriesDir, { recursive: true });

  const registryDir = join(registriesDir, getRegistrySlug(repoUrl));

  try {
    await stat(join(registryDir, '.git'));
    execSync('git pull --rebase', { cwd: registryDir, stdio: 'pipe' });
  } catch {
    await rm(registryDir, { recursive: true, force: true });
    execSync(`git clone ${JSON.stringify(repoUrl)} ${JSON.stringify(registryDir)}`, {
      cwd: registriesDir,
      stdio: 'pipe',
    });
  }

  const templateSourceDir = await resolveTemplateSourceDir(registryDir);
  const importedTemplates = await copyTemplateFolders(templateSourceDir);

  await writeJSON(getRegistryMetaPath(registryDir), {
    repoUrl,
    registryDir,
    templateSourceDir,
    importedTemplates,
  });

  return {
    repoUrl,
    registryDir,
    templateSourceDir,
    importedTemplates,
  };
}

export async function listSpecTemplateRegistries(
  repoUrls: string[],
): Promise<SpecTemplateRegistryInfo[]> {
  const infos: SpecTemplateRegistryInfo[] = [];

  for (const repoUrl of repoUrls) {
    const registryDir = join(getTemplateRegistriesDir(), getRegistrySlug(repoUrl));
    const meta =
      (await readJSON<SyncedTemplateRegistry>(getRegistryMetaPath(registryDir))) ?? undefined;

    const exists = await stat(registryDir)
      .then((registryStat) => registryStat.isDirectory())
      .catch(() => false);

    infos.push({
      repoUrl,
      registryDir,
      templateSourceDir: meta?.templateSourceDir ?? join(registryDir, 'spec'),
      importedTemplates: meta?.importedTemplates ?? [],
      exists,
    });
  }

  return infos;
}

export async function removeSpecTemplateRegistry(
  repoUrl: string,
  remainingRepoUrls: string[],
): Promise<SpecTemplateRegistryInfo> {
  const registryDir = join(getTemplateRegistriesDir(), getRegistrySlug(repoUrl));
  const meta =
    (await readJSON<SyncedTemplateRegistry>(getRegistryMetaPath(registryDir))) ?? undefined;

  const removedInfo: SpecTemplateRegistryInfo = {
    repoUrl,
    registryDir,
    templateSourceDir: meta?.templateSourceDir ?? join(registryDir, 'spec'),
    importedTemplates: meta?.importedTemplates ?? [],
    exists: meta !== undefined,
  };

  for (const templateName of removedInfo.importedTemplates) {
    await rm(join(getSpecTemplatesDir(), templateName), { recursive: true, force: true });
  }

  await rm(registryDir, { recursive: true, force: true });

  // 重新同步剩余仓库，避免不同仓库同名模板被误删后无法恢复
  for (const remainingRepo of remainingRepoUrls) {
    await syncSpecTemplateRegistry(remainingRepo);
  }

  return removedInfo;
}
