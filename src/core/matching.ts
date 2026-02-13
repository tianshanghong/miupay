import type { Invoice, PaymentIndexEntry, State } from "./types.js";

const WINDOW_MS = 2 * 60 * 1000;

function isWithinWindow(invoice: Invoice, paymentTime: number) {
  const lower = invoice.createdAt - WINDOW_MS;
  const upper = invoice.expiresAt + WINDOW_MS;
  return paymentTime >= lower && paymentTime <= upper;
}

export function selectMatchingInvoice(
  state: State,
  payment: PaymentIndexEntry,
  scanCoverageTime?: number,
): Invoice | null {
  if (payment.paymentTime === undefined) {
    return null;
  }

  const matches = Object.values(state.invoices).filter((invoice) => {
    if (invoice.status !== "PENDING") {
      return false;
    }
    if (invoice.chainId !== payment.chainId) {
      return false;
    }
    if (invoice.tokenId !== payment.tokenId) {
      return false;
    }
    if (invoice.expectedAmount !== payment.amount) {
      return false;
    }
    if (invoice.payment) {
      return false;
    }
    if (invoice.receiveTo && payment.to !== invoice.receiveTo) {
      return false;
    }
    if (!isWithinWindow(invoice, payment.paymentTime)) {
      return false;
    }
    if (
      scanCoverageTime !== undefined
      && scanCoverageTime > invoice.expiresAt + WINDOW_MS
    ) {
      return false;
    }
    return true;
  });

  if (matches.length === 0) {
    return null;
  }

  matches.sort((a, b) => a.createdAt - b.createdAt);
  return matches[0] ?? null;
}

export function attachPaymentToInvoice(
  state: State,
  payment: PaymentIndexEntry,
  scanCoverageTime?: number,
): string | null {
  const invoice = selectMatchingInvoice(state, payment, scanCoverageTime);
  if (!invoice) {
    return null;
  }

  invoice.payment = {
    ref: payment.ref,
    txHashOrSig: payment.txHashOrSig,
    amount: payment.amount,
    blockRef: payment.blockRef,
    from: payment.from,
    to: payment.to,
    paymentTime: payment.paymentTime,
  };
  return invoice.idempotencyId;
}
