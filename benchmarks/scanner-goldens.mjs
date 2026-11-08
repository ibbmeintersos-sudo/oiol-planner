// Manually reviewed declaration/import inventory for the checked-in benchmark fixtures.
// Keep these expectations small, explicit, and version-controlled. They are not inferred
// from the scanner output being evaluated.
export const scannerGoldens = [
  {
    id: 'customer-api',
    fixturePath: 'benchmarks/fixtures/customer-api',
    symbols: [
      ['src/routes/customers.mjs', 'function', 'customersRoute'],
      ['src/services/customer-service.mjs', 'function', 'listCustomers']
    ],
    imports: [
      ['src/routes/customers.mjs', '../services/customer-service.mjs'],
      ['src/services/customer-service.mjs', '../store.mjs'],
      ['test/customers.test.mjs', 'node:test'],
      ['test/customers.test.mjs', 'node:assert/strict'],
      ['test/customers.test.mjs', '../src/services/customer-service.mjs']
    ]
  },
  {
    id: 'invoice-api',
    fixturePath: 'benchmarks/fixtures/invoice-api',
    symbols: [
      ['src/auth/session.mjs', 'function', 'currentUser'],
      ['src/routes/invoices.mjs', 'function', 'invoiceRoute'],
      ['src/services/invoices.mjs', 'function', 'getInvoice']
    ],
    imports: [
      ['src/routes/invoices.mjs', '../services/invoices.mjs'],
      ['test/invoices.test.mjs', 'node:test'],
      ['test/invoices.test.mjs', 'node:assert/strict'],
      ['test/invoices.test.mjs', '../src/services/invoices.mjs']
    ]
  },
  {
    id: 'order-monolith',
    fixturePath: 'benchmarks/fixtures/order-monolith',
    symbols: [
      ['src/notifications/email.mjs', 'function', 'sendOrderEmail'],
      ['src/orders/controller.mjs', 'function', 'postOrder'],
      ['src/orders/service.mjs', 'function', 'createOrder'],
      ['src/store/orders.mjs', 'function', 'saveOrder']
    ],
    imports: [
      ['src/orders/controller.mjs', './service.mjs'],
      ['src/orders/service.mjs', '../store/orders.mjs'],
      ['src/orders/service.mjs', '../notifications/email.mjs'],
      ['test/orders.test.mjs', 'node:test'],
      ['test/orders.test.mjs', 'node:assert/strict'],
      ['test/orders.test.mjs', '../src/orders/service.mjs']
    ]
  },
  {
    id: 'scanner-adversarial',
    fixturePath: 'benchmarks/fixtures/scanner-adversarial',
    symbols: [
      ['src/main.mjs', 'function', 'actualRoute'],
      ['src/helper.mjs', 'function', 'safeValue']
    ],
    imports: [
      ['src/main.mjs', './helper.mjs']
    ]
  },
  {
    id: 'workspace-platform',
    fixturePath: 'benchmarks/fixtures/workspace-platform',
    symbols: [
      ['apps/api/src/handler.ts', 'function', 'createHandler'],
      ['packages/shared/src/logger.ts', 'function', 'log']
    ],
    imports: [
      ['apps/api/src/handler.ts', '@oiol/shared/logger']
    ],
    workspaceDependencies: [
      ['apps/api', '@oiol/shared', 'packages/shared']
    ]
  }
];
