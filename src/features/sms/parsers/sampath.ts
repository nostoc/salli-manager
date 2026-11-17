import type { TemplateFields } from './common';
export function parseSampath(body: string): TemplateFields | null {
  const purchase = /^Cr Crd no\.*\s*\[card:\d{4}\]\s+Auth Pmt ([A-Z]{3})\s+([\d,.]+) at (.*?)\s+Avl Bal/i.exec(body);
  const date = /-\s*Sampath Bank\s+(\d{1,2}-[A-Za-z]{3})(?:\s|$)/i.exec(body)?.[1];
  if (purchase) return { kind: 'purchase', currency: purchase[1]!.toUpperCase(), amount: purchase[2]!, merchant: purchase[3]!, ...(date ? { date } : {}) };
  const payment = /^Cr Crd no\.*\s*\[card:\d{4}\]\s+Credited ([A-Z]{3})\s+([\d,.]+) for PAYMENT RECEIVED/i.exec(body);
  return payment ? { kind: 'repayment', currency: payment[1]!.toUpperCase(), amount: payment[2]!, ...(date ? { date } : {}) } : null;
}
