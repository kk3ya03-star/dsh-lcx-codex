/** Execute one standalone call through the public 0.2.2 batch API. */
export async function executeTool(tools, { toolCallId, name, arguments: args, ...context }) {
  const batch = await tools.execute({ ...context, calls: [{ type: 'tool-call', id: toolCallId, name, arguments: JSON.stringify(args) }] });
  return batch.results[0].result;
}
