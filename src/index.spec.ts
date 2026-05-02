import { describe, expect, test } from 'vitest';

import { subscribe } from './index.js';

describe('Module exports', () => {
  test('should export expected elements', () => {
    expect(typeof subscribe).toBe('function');
  });
});
