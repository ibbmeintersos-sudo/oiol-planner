const invoices = new Map([['inv-1', { id: 'inv-1', tenantId: 'tenant-a', amount: 120 }]]);
export async function getInvoice(id) { return invoices.get(id) || null; }
