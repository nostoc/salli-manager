import type { TemplateFields } from './common';
export function parseHnb(body: string): TemplateFields | null {
  const purchase = /^HNB SMS Alert VC\s*:\s*\[card:\d{4}\]\s*:(.*?)\s*(\(Apprx\))?\s*([A-Z]{3})\s+([\d,.]+)\s+\((\d{1,2}-[A-Za-z]{3}-\d{4})\s+[^)]*\)/i.exec(body);
  if (purchase) return { kind: 'purchase', merchant: purchase[1]!.trim(), estimated: !!purchase[2], currency: purchase[3]!.toUpperCase(), amount: purchase[4]!, date: purchase[5]! };
  const payment = /^Thank you for your payment of ([A-Z]{3})\s+([\d,.]+) made to Card No\.?\s*\[card:\d{4}\]\s+on\s+(\d{1,2}-\d{1,2}-\d{2,4})\.?\s*$/i.exec(body);
  return payment ? { kind: 'repayment', currency: payment[1]!.toUpperCase(), amount: payment[2]!, date: payment[3]! } : null;
}
