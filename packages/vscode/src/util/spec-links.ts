/** spec-id 提取（vscode-free，供 DocumentLink 与单测共用）。 */

export interface SpecIdHit {
  id: string;
  index: number;
}

export function extractSpecIds(text: string): SpecIdHit[] {
  const result: SpecIdHit[] = [];
  const regex = /\bspec-[a-z0-9]{8}\b/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    result.push({ id: match[0].toLowerCase(), index: match.index });
  }
  return result;
}
