import test from 'node:test';
import assert from 'node:assert/strict';
import { listCustomers } from '../src/services/customer-service.mjs';
test('legacy page pagination returns the expected page', async () => {
  assert.equal((await listCustomers({ page: 1, limit: 2 })).length, 2);
});
