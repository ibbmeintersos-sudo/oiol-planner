import test from 'node:test';
import assert from 'node:assert/strict';
import { getInvoice } from '../src/services/invoices.mjs';
test('invoice lookup returns a known invoice', async () => {
  assert.equal((await getInvoice('inv-1')).amount, 120);
});
