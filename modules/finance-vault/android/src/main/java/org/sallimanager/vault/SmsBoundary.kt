package org.sallimanager.vault

/** Pure, bounded input boundary. Keep synthetic parity cases aligned with TypeScript. */
object SmsBoundary {
  val senders = setOf("HNB", "COMBANK", "SAMPCCTXN", "BOC")
  fun sanitize(input: String): String? {
    if (input.isEmpty() || input.length > 8192 || input.toByteArray(Charsets.UTF_8).size > 8192) return null
    var index = 0
    while (index < input.length) {
      val c = input[index]
      if (Character.isHighSurrogate(c)) {
        if (index + 1 >= input.length || !Character.isLowSurrogate(input[index + 1])) return null
        index += 2; continue
      }
      if (Character.isLowSurrogate(c) || c == '\ue000' || c == '\ue001') return null
      index++
    }
    if (Regex("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u206f\\ufeff]").containsMatchIn(input)) return null
    val normalized = java.text.Normalizer.normalize(input, java.text.Normalizer.Form.NFKC)
    if (Regex("\\b(?:otp|one[ -]?time(?:[ -]?(?:password|code))?|passcode|verification[ -]*code|security[ -]*code|cvv|pin|password|authentication|login[ -]*code)(?=\\W|\\d|$)|\\bcode\\s*[:=-]?\\s*\\d{3,8}", RegexOption.IGNORE_CASE).containsMatchIn(normalized)) return null
    var text = input.replace(Regex("\\r\\n?"), "\n")
    text = Regex("(?:\\d{4}[ -]+)?(?:[Xx*]{2,}[ -]*)+\\d{4}").replace(text) { "[card:${it.value.takeLast(4)}]" }
    text = Regex("(?<!\\[)\\b(credit\\s+card|card(?:\\s+(?:no\\.?|number|ending(?:\\s+with)?))?|cr\\s*crd\\s*no\\.?|VC)\\s*[#:.]*\\s*(\\d(?:[ -]?\\d){3,19})\\b", RegexOption.IGNORE_CASE).replace(text) {
      "${it.groupValues[1]} [card:${it.groupValues[2].filter(Char::isDigit).takeLast(4)}]"
    }
    text = Regex("(?<!\\[)\\b(account|acct|a/c)(?:\\s+(?:no\\.?|number|ending(?:\\s+with)?))?\\s*[:#.]?\\s*(\\d(?:[ -]?\\d){3,19})\\b", RegexOption.IGNORE_CASE).replace(text) {
      "${it.groupValues[1]} [account:${it.groupValues[2].filter(Char::isDigit).takeLast(4)}]"
    }
    val money = mutableListOf<String>()
    text = Regex("\\b(?:LKR|USD|EUR|GBP|INR|AUD|JPY|KWD)\\s+\\d[\\d,]*(?:\\.\\d+)?\\b", RegexOption.IGNORE_CASE).replace(text) {
      if (it.value.count(Char::isDigit) > 16 || Regex("\\d{14,}").containsMatchIn(it.value.substringBefore('.'))) "[redacted]"
      else { money.add(it.value); "\ue000${money.lastIndex}\ue001" }
    }
    text = Regex("\\+?\\d(?:[ -]?\\d){6,}").replace(text, "[redacted]")
    text = Regex("\\d(?:[./:-]?\\d){11,}").replace(text, "[redacted]")
    text = Regex("\ue000(\\d+)\ue001").replace(text) { money[it.groupValues[1].toInt()] }
    return text.takeIf { Regex("purchase|payment|auth pmt|credited|refund|revers|declin|transaction|^HNB SMS Alert VC\\s*:", RegexOption.IGNORE_CASE).containsMatchIn(it) }
  }
}
