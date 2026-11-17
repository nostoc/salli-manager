import { BANKS, normalizeSender, type ParseResult } from '../domain/types';
import { sanitizeSms } from '../domain/sanitize';
import { observation } from './common';
import { parseHnb } from './hnb';
import { parseCommercial } from './commercial';
import { parseSampath } from './sampath';
import { parseBoc } from './boc';

export function parseSms(input: Readonly<{ sender: unknown; body: unknown; receivedAt: number | null }>): ParseResult {
  let sender: string;
  try { sender = normalizeSender(input.sender); } catch { return { type: 'rejected', reason: 'unsupported_sender' }; }
  const bank = BANKS.find((item) => item.sender === sender);
  if (!bank) return { type: 'rejected', reason: 'unsupported_sender' };
  const sanitized = sanitizeSms(input.body);
  if ('reason' in sanitized) return { type: 'rejected', reason: sanitized.reason };
  const body = sanitized.text.trim();
  if (!/purchase|payment|auth pmt|credited|refund|revers|declin|transaction|^HNB SMS Alert VC\s*:/i.test(body)) return { type: 'rejected', reason: 'unrelated' };
  try {
    const parsers = { hnb: parseHnb, commercial: parseCommercial, sampath: parseSampath, boc: parseBoc };
    const fields = parsers[bank.id](body);
    const result = observation(bank.id, sender, body, fields ?? { kind: 'unknown' }, input.receivedAt);
    const balanceMatch = /(?:Balance Available|Av\.?\s*Bal|Avl Bal)\s*:?\s*([A-Z]{3})?\s*([^\s]+)/i.exec(body);
    const withBalance = balanceMatch ? observation(bank.id, sender, body, { ...(fields ?? { kind: 'unknown' as const }), balance: balanceMatch[2]!, ...(balanceMatch[1] ? { balanceCurrency: balanceMatch[1].toUpperCase() } : {}) }, input.receivedAt) : result;
    const uncertainState = /refund|revers|declin|cancelled|canceled|failed|unsuccessful/i.test(body);
    const final = uncertainState ? Object.freeze({ ...withBalance, warnings: Object.freeze([...withBalance.warnings, 'unsupported_event_state']) }) : withBalance;
    const needsReview = !fields || uncertainState || final.warnings.some((warning) => warning !== 'estimated_authorization' && warning !== 'invalid_optional_balance');
    return Object.freeze({ type: needsReview ? 'needsReview' : 'recognized', observation: final, sanitizedText: body });
  } catch { return { type: 'malformed', reason: 'invalid_financial_fields' }; }
}
