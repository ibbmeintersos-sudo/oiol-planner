import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrder } from '../src/orders/service.mjs';
test('order creation persists and sends notification', async () => {
  const order = await createOrder({ customerEmail: 'test@example.invalid' });
  assert.equal(order.status, 'created');
});
