/**
 * Minimal inline markdown → HTML used by dv.span()/dv.paragraph() in the
 * preview. Kept side-effect free so it can be unit-tested in Node.
 */
export function renderInlineMarkdown(text: string): string {
  return String(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\n/g, '<br>');
}
