import { defineProject } from 'vitest/config';
import { sharedAliases } from '../../vitest.shared';

export default defineProject({
  resolve: { alias: sharedAliases },
  test: {
    name: 'services',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
