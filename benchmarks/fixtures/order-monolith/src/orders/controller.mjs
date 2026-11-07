import { createOrder } from './service.mjs';
export async function postOrder(request) {
  const order = await createOrder(request.body);
  return { status: 201, body: order };
}
