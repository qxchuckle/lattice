/** 报告类虚拟文档的内容载体（doctor / rag status 等运行结果）。 */
export class ReportStore {
  private reports = new Map<string, string>();

  set(key: string, markdown: string): void {
    this.reports.set(key, markdown);
  }

  get(key: string): string | undefined {
    return this.reports.get(key);
  }
}
