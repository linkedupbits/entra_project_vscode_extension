import { beforeEach, vi } from 'vitest';
import { resetVscodeMock } from './vscodeMock';

beforeEach(() => {
  resetVscodeMock();
  vi.clearAllMocks();
});
