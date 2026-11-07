let sequence = 1;
export async function saveOrder(input) {
  return { id: 'order-' + sequence++, status: 'created', ...input };
}
