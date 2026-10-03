// Parses the pasted/pushed Q&A format. Same format the Knowledge page accepts:
//   V: question                       (Q: works too)
//   O: other phrasing | another one   (optional)
//   C: category                       (optional)
//   K: keyword, keyword               (optional)
//   A: answer                         (last; may span several lines)
// Entries are separated by a blank line.

export interface KnowledgeDraftInput {
  question: string;
  answer: string;
  aliases: string[];
  keywords: string[];
  category?: string;
}

const STOP = new Set(('de het een en of van in op voor met is zijn was wat hoe waar wanneer wie waarom kan ik je jij we wij ons dit dat die dan om te er '
  + 'naar bij als maar ook niet geen wel nog dus mijn jullie moet kunnen heb hebben wil wilt the a an and or to of in on for is it you we can be with this that '
  + 'how do does my me your are was what when where why there their they have has just so but not no yes please would could should will get make like want need '
  + 'any some from at as by if about its').split(' '));

export function suggestKeywords(question: string): string[] {
  const seen = new Set<string>();
  return question.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w) && !seen.has(w) && seen.add(w)).slice(0, 6);
}

export function parseKnowledgeText(text: string): KnowledgeDraftInput[] {
  const items: KnowledgeDraftInput[] = [];
  for (const block of text.replace(/\r/g, '').split(/\n\s*\n(?=\s*(?:V|Q)\s*:)/i)) {
    const it: KnowledgeDraftInput = { question: '', answer: '', aliases: [], keywords: [] };
    let category = '';
    let field: string | null = null;
    for (const line of block.split('\n')) {
      const m: RegExpMatchArray | null = field === 'A' ? null : line.match(/^\s*(V|Q|O|C|K|A)\s*:\s?(.*)$/i);
      if (m) {
        const key: string = m[1].toUpperCase();
        field = key === 'Q' ? 'V' : key;
        const v = m[2].trim();
        if (field === 'V') it.question = v;
        else if (field === 'O') it.aliases.push(...v.split('|').map((x: string) => x.trim()).filter(Boolean));
        else if (field === 'C') category = v;
        else if (field === 'K') it.keywords.push(...v.split(',').map((x: string) => x.trim()).filter(Boolean));
        else it.answer = v;
      } else if (field === 'A') it.answer += `\n${line}`;
      else if (field === 'V' && line.trim()) it.question += ` ${line.trim()}`;
    }
    it.answer = it.answer.trim().slice(0, 1900);
    it.question = it.question.trim().slice(0, 500);
    if (it.question.length < 3 || !it.answer) continue;
    if (!it.keywords.length) it.keywords = suggestKeywords(it.question);
    if (category) it.category = category.slice(0, 60);
    items.push(it);
  }
  return items;
}
