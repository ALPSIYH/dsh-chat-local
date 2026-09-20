/** Capture limits are explicit; absence of a receipt never proves absence of exposure. */
export class ObservationCoverage {
  #counts = { observedReceipts: 0, failedReceipts: 0, unboundEvents: 0,
    ambiguousIdentityEvents: 0, nonTextEvents: 0, excludedRecallEvents: 0 };
  #startedAt = Date.now();
  event(event) {
    if (!['user/message','assistant/message','tool/result'].includes(event?.type)) return;
    const message = event.data?.message ?? (event.type === 'user/message' ? event.data : undefined);
    const unsupported = blocks => Array.isArray(blocks) && blocks.some(block =>
      block?.type === 'tool-result' ? unsupported(block.content)
        : !['text','reasoning','tool-call'].includes(block?.type));
    if (unsupported(message?.content)) this.#counts.nonTextEvents++;
  }
  count(name) { if (Object.hasOwn(this.#counts,name)) this.#counts[name]++; }
  async persist(write) {
    try {
      const result=await write();
      if (!result) throw new Error('observation receipt could not be persisted');
      this.#counts.observedReceipts++;
      return result;
    } catch(error) { this.#counts.failedReceipts++; throw error; }
  }
  health() { return { history:'live-events-only', modalities:['text'], measuredSince:this.#startedAt,
    countersScope:'this-service-process', preMountHistoryImported:false,
    limitations:['non-text content is not extracted','unbound or ambiguous identities are not guessed',
      'external receipt and local persistence are not one transaction'], ...this.#counts }; }
}
