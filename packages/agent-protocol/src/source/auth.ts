/**
 * 认证类型
 */

export type AuthRequirement =
  | { type: 'api_key'; envVar: string; description: string }
  | { type: 'oauth'; description: string }
  | { type: 'cli_login'; command: string; description: string }
  | { type: 'env'; vars: string[]; description: string }
  | { type: 'none' };

export type AuthStatus =
  | { status: 'configured'; detail?: string }
  | { status: 'missing'; message: string }
  | { status: 'error'; message: string };
