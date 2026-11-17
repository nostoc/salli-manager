import type { TemplateFields } from './common';
export function parseCommercial(body: string): TemplateFields | null {
  const purchase = /^Dear Cardholder, Purchase at (.*?) for ([A-Z]{3})\s+([\d,.]+) on (\d{1,2}\/\d{1,2}\/\d{2,4})\s+.*?has been authorised on your credit card\s*#?\s*\[card:\d{4}\]/i.exec(body);
  if (purchase) return { kind: 'purchase', merchant: purchase[1]!, currency: purchase[2]!.toUpperCase(), amount: purchase[3]!, date: purchase[4]! };
  const payment = /^Dear Cardholder, We thank you for your payment made via ComBank Digital LK for ([A-Z]{3})\s+([\d,.]+) on (\d{1,2}\/\d{1,2}\/\d{2,4})\s+.*?received towards settlement of your card ending with\s*\[card:\d{4}\]/i.exec(body);
  if (payment) return { kind: 'repayment', currency: payment[1]!.toUpperCase(), amount: payment[2]!, date: payment[3]! };
  if (/bill payment effected through Combank Digital\.\s+Status\s*-\s*Completed\./i.test(body)) return { kind: 'bill-payment' };
  return null;
}
