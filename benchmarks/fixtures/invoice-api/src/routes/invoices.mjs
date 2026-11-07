import { getInvoice } from '../services/invoices.mjs';
export async function invoiceRoute(request) {
  const invoice = await getInvoice(request.params.id);
  if (!invoice) return { status: 404, body: { error: 'not_found' } };
  return { status: 200, body: invoice };
}
