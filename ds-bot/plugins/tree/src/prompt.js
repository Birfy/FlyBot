// System prompt template. Every bot in the tree gets it, so a new child inherits the
// full recursive behavior: with children it coordinates, without children it does the work.
export function systemPrompt({ name, role, trace, children, root = false }) {
  const head = root
    ? [`Bot tree: you (${name}) are also the ROOT of a recursive bot tree of child bots. For tasks you delegate into the tree, follow these tree rules.`, `Your position: ${trace}`]
    : [`You are ${name}, a bot in a recursive bot tree. Your role: ${role || '(general)'}`, `Your position: ${trace}`]
  const tools = 'Tree tools: list_children() shows your current direct children (it may be newer than this prompt). create_child_bot(name, role_description) creates a child directly under you.'
  if (!children.length) {
    return [...head, '',
      'You have no children: do the work yourself and answer concisely with concrete results.',
      'Only if the task clearly splits into a separate domain you cannot cover, you may create a child with create_child_bot and delegate to it.',
      'You may message only your parent and your direct children.', tools,
      `Start your answer with a one-line trace of the path the request took, e.g. "${trace}".`].join('\n')
  }
  return [...head, '',
    'You are a COORDINATOR. Your direct children (the only bots you may delegate to; you cannot see deeper levels):',
    ...children.map(c => `- ${c.name}: ${c.role || ''}`), '',
    '1. Split the request into parts. Delegate a part only to a child whose stated scope fits it; generic abilities do not make a child fit another domain. Do not plan for grandchildren: each child decomposes its own part.',
    '2. Create a child with create_child_bot ONLY when no existing child fits (check list_children first). Never create duplicates or overlapping scopes. If creation is rejected by limits, use the closest child.',
    '3. Send each child only its own self-contained part, all in parallel, then wait.',
    '4. Aggregate the answers into one concise answer for your parent (or the user). If only one child answered, pass its answer through unchanged.',
    `5. Begin with a one-line trace of the delegation path, e.g. "${trace} → <child>".`,
    'You may message only your parent and your direct children.', tools].join('\n')
}

// The tree's text is kept in a marked block inside the bot's systemPrompt, so text written by the
// user or other plugins (e.g. on Chief) is never overwritten; only the block is replaced/removed.
export const BLOCK_START = '<!-- flybot-tree:start -->'
export const BLOCK_END = '<!-- flybot-tree:end -->'
const BLOCK_RE = /\n*<!-- flybot-tree:start -->[\s\S]*?<!-- flybot-tree:end -->\n*/g
export function withTreeBlock(current, block) {
  const rest = String(current ?? '').replace(BLOCK_RE, '\n\n').trim()
  if (!block) return rest
  return [rest, `${BLOCK_START}\n${block}\n${BLOCK_END}`].filter(Boolean).join('\n\n')
}
export const hasTreeBlock = text => String(text ?? '').includes(BLOCK_START)
