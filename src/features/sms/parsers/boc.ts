import type { TemplateFields } from './common';
export function parseBoc(body: string): TemplateFields | null {
  const purchase = /^Purchase\. Transaction approved on your Credit Card\s*\[card:\d{4}\]\s+for ([A-Z]{3})\s+([\d,.]+) at (.*?)\.\s+Balance Available/i.exec(body);
  if (purchase) return { kind: 'purchase', currency: purchase[1]!.toUpperCase(), amount: purchase[2]!, merchant: purchase[3]! };
  const payment = /^Dear Customer, Thank you for payment of ([A-Z]{3})\s+([\d,.]+) on (\d{1,2}\/\d{1,2}\/\d{4}) for Credit Card no\.?\s*\[card:\d{4}\]/i.exec(body);
  return payment ? { kind: 'repayment', currency: payment[1]!.toUpperCase(), amount: payment[2]!, date: payment[3]! } : null;
}
