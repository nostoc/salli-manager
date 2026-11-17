// Mirrored by the bounded Kotlin capture boundary. Cross-runtime fixtures must
// establish parity; JS revalidates every decrypted bridge/provider payload.
export function sanitizeSms(input: unknown): Readonly<{ text: string }> | Readonly<{ reason: string }> {
  if (typeof input !== 'string' || input.length === 0 || input.length > 8192) return { reason: 'invalid_size' };
  let bytes = 0;
  for (const character of input) {
    const point = character.codePointAt(0)!;
    if ((point >= 0xd800 && point <= 0xdfff) || point === 0xe000 || point === 0xe001) return { reason: 'invalid_encoding' };
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  if (bytes > 8192) return { reason: 'invalid_size' };
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/.test(input)) return { reason: 'invalid_encoding' };
  const normalized = input.normalize('NFKC');
  if (/\b(?:otp|one[ -]?time(?:[ -]?(?:password|code))?|passcode|verification[ -]*code|security[ -]*code|cvv|pin|password|authentication|login[ -]*code)(?=\W|\d|$)|\bcode\s*[:=-]?\s*\d{3,8}/i.test(normalized)) return { reason: 'authentication_content' };
  let text = input.replace(/\r\n?/g, '\n');
  text = text.replace(/(?:\d{4}[ -]+)?(?:[Xx*]{2,}[ -]*)+\d{4}/g, (match) => `[card:${match.slice(-4)}]`);
  text = text.replace(/(?<!\[)\b(credit\s+card|card(?:\s+(?:no\.?|number|ending(?:\s+with)?))?|cr\s*crd\s*no\.?|VC)\s*[#:.]*\s*(\d(?:[ -]?\d){3,19})\b/gi,
    (_, label: string, digits: string) => `${label} [card:${digits.replace(/\D/g, '').slice(-4)}]`);
  text = text.replace(/(?<!\[)\b(account|acct|a\/c)(?:\s+(?:no\.?|number|ending(?:\s+with)?))?\s*[:#.]?\s*(\d(?:[ -]?\d){3,19})\b/gi,
    (_, label: string, digits: string) => `${label} [account:${digits.replace(/\D/g, '').slice(-4)}]`);
  // Protect explicit monetary tokens before removing long identifiers/phones.
  const money: string[] = [];
  text = text.replace(/\b(?:LKR|USD|EUR|GBP|INR|AUD|JPY|KWD)\s+\d[\d,]*(?:\.\d+)?\b/gi, (match) => {
    if (match.replace(/\D/g, '').length > 16 || /\d{14,}/.test(match.split('.')[0]!)) return '[redacted]';
    money.push(match); return `\ue000${money.length - 1}\ue001`;
  });
  text = text.replace(/\+?\d(?:[ -]?\d){6,}/g, '[redacted]');
  text = text.replace(/\d(?:[./:-]?\d){11,}/g, '[redacted]');
  text = text.replace(/\ue000(\d+)\ue001/g, (_, index: string) => money[Number(index)]!);
  return Object.freeze({ text });
}

export function safeMerchant(value: string | null): string | null {
  if (value === null) return null;
  const merchant = value.replace(/\[redacted\]/g, '').replace(/\s+/g, ' ').trim();
  return merchant && merchant.length <= 160 && !/\d(?:[ -]?\d){6,}/.test(merchant) ? merchant : null;
}
