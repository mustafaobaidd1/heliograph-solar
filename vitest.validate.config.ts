import { defineConfig } from 'vitest/config';

/** `npm run validate`: the slower validation report, kept out of the unit-test run. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['scripts/validate.ts'],
    reporters: ['dot'],
  },
});
