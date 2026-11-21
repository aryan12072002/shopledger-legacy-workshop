'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const invoice = require('../lib/invoice');
const pricing = require('../lib/pricing');
const reports = require('../lib/reports');

// These are the item fields routes/orders.js copies onto persisted order lines.
// In particular, that route stores HSN but does not store gstRate.
function savedOrderItems() {
  return [
    { id: 1, sku: 'RICE-1', name: 'Rice', hsn: '1006', price: 640, qty: 1 },
    { id: 2, sku: 'TEA-1', name: 'Tea', hsn: '0902', price: 100, qty: 1 }
  ];
}

test('CURRENT BEHAVIOUR: invoice figures match the billed totals and the order pricing GST breakdown', function () {
  const items = savedOrderItems();
  const billed = pricing.computeTotals(items, 'SAVE10');
  const figures = invoice.computeInvoiceFigures({
    items: items,
    coupon: 'SAVE10',
    subtotal: billed.subtotal,
    discount: billed.discount,
    tax: billed.tax,
    total: billed.total
  });

  assert.equal(figures.subtotal, billed.subtotal);
  assert.equal(figures.discount, billed.discount);
  assert.equal(figures.tax, billed.tax);
  assert.equal(figures.cgst, billed.cgst);
  assert.equal(figures.sgst, billed.sgst);
  assert.equal(figures.total, billed.total);
  assert.deepEqual(figures.rows.map(function (row) {
    return { gstPercent: row.gstPercent, lineTax: row.lineTax };
  }), billed.lines.map(function (line) {
    return { gstPercent: line.gstPercent, lineTax: line.tax };
  }));
});

test('CURRENT BEHAVIOUR: invoice keeps saved billed totals when they differ from a fresh calculation', function () {
  const figures = invoice.computeInvoiceFigures({
    items: savedOrderItems(),
    coupon: 'SAVE10',
    subtotal: 740,
    discount: 80,
    tax: 40,
    total: 700
  });

  assert.equal(figures.subtotal, 740);
  assert.equal(figures.discount, 80);
  assert.equal(figures.tax, 40);
  assert.equal(figures.cgst, 20);
  assert.equal(figures.sgst, 20);
  assert.equal(figures.total, 700);
});

test('CURRENT BEHAVIOUR: order pricing applies HSN rates and the coupon to pre-tax subtotal', function () {
  const items = savedOrderItems();
  const totals = pricing.computeTotals(items, 'SAVE10');

  assert.equal(totals.subtotal, 740);
  assert.equal(totals.discount, 74);
  assert.equal(totals.tax, 45);
  assert.equal(totals.cgst, 22.5);
  assert.equal(totals.sgst, 22.5);
  assert.equal(totals.total, 711);
  assert.deepEqual(totals.lines.map(function (line) {
    return { gstPercent: line.gstPercent, discount: line.discount, tax: line.tax };
  }), [
    { gstPercent: 5, discount: 64, tax: 28.8 },
    { gstPercent: 18, discount: 10, tax: 16.2 }
  ]);
});

test('CURRENT BEHAVIOUR: invoice uses HSN GST rates and the same discount allocation as order pricing', function () {
  const figures = invoice.computeInvoiceFigures({
    items: savedOrderItems(),
    coupon: 'SAVE10'
  });

  assert.deepEqual(figures.rows.map(function (row) {
    return { hsn: row.hsn, gstPercent: row.gstPercent, line: row.line, lineTax: row.lineTax };
  }), [
    { hsn: '1006', gstPercent: 5, line: 640, lineTax: 28.8 },
    { hsn: '0902', gstPercent: 18, line: 100, lineTax: 16.2 }
  ]);
  assert.equal(figures.tax, 45);
  assert.equal(figures.cgst, 22.5);
  assert.equal(figures.sgst, 22.5);
  assert.equal(figures.discount, 74);
  assert.equal(figures.total, 711);
});

test('CURRENT BEHAVIOUR: GST reconciliation reports matching invoice and order figures', function () {
  const items = savedOrderItems();
  const billed = pricing.computeTotals(items, 'SAVE10');
  const order = {
    id: 42,
    date: '21/11/2026',
    customer: 'In-memory customer',
    coupon: 'SAVE10',
    items: items,
    subtotal: billed.subtotal,
    discount: billed.discount,
    tax: billed.tax,
    total: billed.total
  };

  // Pass a literal in-memory database object; no store module or JSON file is used.
  const result = reports.getGstReconciliation({ orders: [order] });

  assert.equal(result.totalChecked, 1);
  assert.equal(result.mismatchCount, 0);
  assert.equal(result.totalDelta, 0);
  assert.equal(result.rows[0].ledgerTax, 45);
  assert.equal(result.rows[0].invoiceTax, 45);
  assert.equal(result.rows[0].ledgerTotal, 711);
  assert.equal(result.rows[0].invoiceTotal, 711);
  assert.equal(result.rows[0].matched, true);
});

test('CURRENT BEHAVIOUR: invoice applies the configured coupon cap and HSN GST used for billing', function () {
  const items = [{ id: 3, sku: 'RICE-2', name: 'Bulk rice', hsn: '1006', price: 600, qty: 5 }];
  const billed = pricing.computeTotals(items, 'SAVE10');
  const figures = invoice.computeInvoiceFigures({ items: items, coupon: 'SAVE10' });

  assert.equal(billed.discount, 150);
  assert.equal(billed.tax, 142.5);
  assert.equal(billed.total, 2992.5);
  assert.equal(figures.discount, billed.discount);
  assert.equal(figures.tax, billed.tax);
  assert.equal(figures.total, billed.total);
  assert.equal(figures.discount, 150);
  assert.equal(figures.tax, 142.5);
  assert.equal(figures.total, 2992.5);
});

test('CURRENT BEHAVIOUR: rendered invoice shows billed total without a mismatch notice', function () {
  const items = savedOrderItems();
  const billed = pricing.computeTotals(items, 'SAVE10');
  const html = invoice.render({
    id: 42,
    date: '21/11/2026',
    customer: 'In-memory customer',
    paymentMode: 'cash',
    status: 'completed',
    coupon: 'SAVE10',
    items: items,
    subtotal: billed.subtotal,
    discount: billed.discount,
    tax: billed.tax,
    total: billed.total
  });

  assert.match(html, /Invoice Total/);
  assert.match(html, /711\.00/);
  assert.doesNotMatch(html, /Accountant Reconciliation Notice/);
});
