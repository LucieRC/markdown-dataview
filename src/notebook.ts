/**
 * Notebook Renderer — extends VS Code's built-in Markdown renderer
 * for notebook cells to support Dataview queries.
 */

export const activate = async (ctx: any): Promise<void> => {
  const markdownRenderer = await ctx.getRenderer('vscode.markdown-it-renderer');
  if (!markdownRenderer) {
    throw new Error('Could not load vscode.markdown-it-renderer');
  }

  markdownRenderer.extendMarkdownIt((md: any) => {
    try {
      const defaultFence = md.renderer.rules.fence ||
        ((t: any, i: number, o: any, e: any, s: any) => s.renderToken(t, i, o));

      md.renderer.rules.fence = (tokens: any[], idx: number, options: any, env: any, self: any) => {
        const token = tokens[idx];
        const language = token.info?.trim().split(/\s+/)[0]?.toLowerCase() || '';
        if (language === 'dataview' || language === 'dataviewjs') {
          return '<div class="dataview-result dataview-notebook-placeholder"><em>'
            + 'Dataview queries require the Markdown preview panel for full support.'
            + '</em></div>';
        }
        return defaultFence(tokens, idx, options, env, self);
      };

      const defaultInline = md.renderer.rules.code_inline ||
        ((t: any, i: number, o: any, e: any, s: any) => s.renderToken(t, i, o));

      md.renderer.rules.code_inline = (tokens: any[], idx: number, options: any, env: any, self: any) => {
        const token = tokens[idx];
        const content = token.content;
        if (content.startsWith('=') && !content.startsWith('==')) {
          return '<code>' + content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</code>';
        }
        return defaultInline(tokens, idx, options, env, self);
      };
    } catch (err) {
      console.error('[Dataview Notebook] Error:', err);
    }
    return md;
  });
};
