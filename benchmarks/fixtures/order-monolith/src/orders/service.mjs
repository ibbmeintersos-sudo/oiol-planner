import { saveOrder } from '../store/orders.mjs';
import { sendOrderEmail } from '../notifications/email.mjs';
export async function createOrder(input) {
  const order = await saveOrder(input);
  await sendOrderEmail(order);
  return order;
}
