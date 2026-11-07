import { customers } from '../store.mjs';
export async function listCustomers({ page = 1, limit = 20 } = {}) {
  const start = (page - 1) * limit;
  return customers.slice(start, start + limit);
}
