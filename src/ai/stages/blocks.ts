/**
 * Wraps untrusted text in a delimited block for a prompt (CLAUDE.md §7.8). A closing tag inside
 * the text is escaped so the text can't end the block early.
 */
export const block = (name: string, body: string) =>
  `<${name}>\n${body.replace(new RegExp(`</${name}`, "gi"), `<\\/${name}`)}\n</${name}>`;
