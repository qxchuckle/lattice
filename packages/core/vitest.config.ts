import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'core',
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
