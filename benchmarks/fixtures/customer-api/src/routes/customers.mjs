import { listCustomers } from '../services/customer-service.mjs';
export async function customersRoute(request) {
  const page = Number(request.query?.page || 1);
  const limit = Number(request.query?.limit || 20);
  return { status: 200, body: await listCustomers({ page, limit }) };
}
