import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRuntimeVersion, SUPPORTED_PI_AI_VERSIONS } from '../index.js';

test('runtime allowlist accepts only explicitly audited pi-ai releases', () => {
  assert.deepEqual(SUPPORTED_PI_AI_VERSIONS, ['0.87.1', '1.1.0']);
  for (const version of SUPPORTED_PI_AI_VERSIONS) assert.doesNotThrow(() => assertRuntimeVersion(version));
  for (const version of ['0.87.2', '1.0.1', '1.0.3', '2.0.0', undefined]) {
    assert.throws(() => assertRuntimeVersion(version), /re-audit the transport shim/);
  }
});
