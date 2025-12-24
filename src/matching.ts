import type { Invoice, PaymentIndexEntry, State } from "./types.js";

export function selectMatchingInvoice(
  state: State,
  payment: PaymentIndexEntry,
  now: number,
): Invoice | null {
  const matches = Object.values(state.invoices).filter((invoice) => {
    if (invoice.status !== "PENDING") {
      return false;
    }
    if (invoice.expiresAt <= now) {
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
  now: number,
): string | null {
  const invoice = selectMatchingInvoice(state, payment, now);
  if (!invoice) {
    return null;
  }

  invoice.payment = {
    ref: payment.ref,
    txHashOrSig: payment.txHashOrSig,
    amount: payment.amount,
    blockRef: payment.blockRef,
  };
  return invoice.id;
}
