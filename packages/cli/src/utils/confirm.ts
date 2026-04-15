export function shouldSkipConfirm(opts: { fore?: boolean } | undefined): boolean {
  return opts?.fore === true;
}
