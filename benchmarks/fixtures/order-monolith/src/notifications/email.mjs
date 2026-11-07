export async function sendOrderEmail(order) {
  if (!order?.customerEmail) throw new Error('customerEmail is required');
  return { accepted: true, orderId: order.id };
}
