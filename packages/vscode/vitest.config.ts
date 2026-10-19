import { defineProject } from 'vitest/config';
import { sharedAliases } from '../../vitest.shared';

export default defineProject({
  resolve: { alias: sharedAliases },
  test: {
    name: 'vscode',
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});
