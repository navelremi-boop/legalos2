/** @type {import('eslint').Rule.RuleModule} */
export const noHardcodedColors = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Interdit les couleurs en dur (#hex, rgb(, hsl() hors commentaires (cahier § 7.8).",
    },
    schema: [],
    messages: {
      forbidden:
        "Couleur en dur « {{match}} » interdite : utiliser uniquement les jetons de design/tokens.css.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const patterns = [
      { re: /\brgb\s*\(/gi, label: "rgb(" },
      { re: /\bhsl\s*\(/gi, label: "hsl(" },
      { re: /#[0-9a-fA-F]{3,8}\b/g, label: "#…" },
    ];

    function stripComments(text) {
      const comments = sourceCode.getAllComments();
      let out = text;
      const sorted = [...comments].sort((a, b) => b.range[0] - a.range[0]);
      for (const comment of sorted) {
        const [start, end] = comment.range;
        out = out.slice(0, start) + " ".repeat(end - start) + out.slice(end);
      }
      return out;
    }

    return {
      Program() {
        const stripped = stripComments(sourceCode.getText());
        for (const { re } of patterns) {
          re.lastIndex = 0;
          let match = re.exec(stripped);
          while (match !== null) {
            const index = match.index;
            context.report({
              loc: sourceCode.getLocFromIndex(index),
              messageId: "forbidden",
              data: { match: match[0] },
            });
            match = re.exec(stripped);
          }
        }
      },
    };
  },
};
