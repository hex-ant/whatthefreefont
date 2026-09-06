import type { FontVariant } from './types'

/** Exact cmap coverage prevents the browser's fallback face from winning a match. */
export function coversText(ranges: number[], text: string): boolean {
  function has(code: number) {
    let low = 0,
      high = ranges.length / 2 - 1
    while (low <= high) {
      const mid = (low + high) >>> 1
      if (code < ranges[mid * 2]!) high = mid - 1
      else if (code > ranges[mid * 2 + 1]!) low = mid + 1
      else return true
    }
    return false
  }
  return [...text.normalize('NFC')].every((char) => {
    if (/[\s\p{Cf}\uFE00-\uFE0F]/u.test(char)) return true
    if (has(char.codePointAt(0)!)) return true
    const decomposed = char.normalize('NFD')
    return decomposed !== char && [...decomposed].every((c) => has(c.codePointAt(0)!))
  })
}

/** Small static subsets avoid downloading multi-megabyte CJK TTFs for Latin text. */
export function fontSources(font: FontVariant, text: string): string[] {
  const chars = [...text.normalize('NFC')].map((c) => c.codePointAt(0)!)
  const latin = chars.every(
    (c) => c <= 0x24f || (c >= 0x2000 && c <= 0x206f) || c === 0x20ac || c === 0x2122,
  )
  if (!latin || !font.latin) return [font.url]
  if (chars.some((c) => c > 0xff && c < 0x250))
    return font.latinExt ? [font.latin, font.latinExt] : [font.url]
  return [font.latin]
}

export function supportsScript(font: FontVariant, text: string): boolean {
  const checks: Array<[RegExp, string[]]> = [
    [/\p{Script=Latin}/u, ['latin']],
    [/\p{Script=Cyrillic}/u, ['cyrillic']],
    [/\p{Script=Greek}/u, ['greek']],
    [/\p{Script=Arabic}/u, ['arabic']],
    [/\p{Script=Hebrew}/u, ['hebrew']],
    [/\p{Script=Devanagari}/u, ['devanagari']],
    [/\p{Script=Bengali}/u, ['bengali']],
    [/\p{Script=Gujarati}/u, ['gujarati']],
    [/\p{Script=Tamil}/u, ['tamil']],
    [/\p{Script=Telugu}/u, ['telugu']],
    [/\p{Script=Kannada}/u, ['kannada']],
    [/\p{Script=Malayalam}/u, ['malayalam']],
    [/\p{Script=Thai}/u, ['thai']],
    [/\p{Script=Khmer}/u, ['khmer']],
    [/\p{Script=Myanmar}/u, ['myanmar']],
    [/\p{Script=Armenian}/u, ['armenian']],
    [/\p{Script=Georgian}/u, ['georgian']],
    [/\p{Script=Ethiopic}/u, ['ethiopic']],
    [/\p{Script=Hangul}/u, ['korean']],
    [/\p{Script=Hiragana}|\p{Script=Katakana}/u, ['japanese']],
    [/\p{Script=Han}/u, ['chinese', 'japanese', 'korean']],
  ]
  return checks.every(
    ([regex, names]) =>
      !regex.test(text) || font.subsets.some((s) => names.some((n) => s.includes(n))),
  )
}
