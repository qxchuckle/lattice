function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatRagTimestamp(timestamp: string | null): string {
  if (!timestamp) return '暂无构建记录';

  const parsed = new Date(timestamp.replace(' ', 'T') + 'Z');
  if (Number.isNaN(parsed.getTime())) {
    return timestamp;
  }

  return [
    parsed.getFullYear(),
    '-',
    pad(parsed.getMonth() + 1),
    '-',
    pad(parsed.getDate()),
    ' ',
    pad(parsed.getHours()),
    ':',
    pad(parsed.getMinutes()),
    ':',
    pad(parsed.getSeconds()),
  ].join('');
}
