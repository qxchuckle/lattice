export function shouldSkipConfirm(opts: { force?: boolean } | undefined): boolean {
  return opts?.force === true;
}
