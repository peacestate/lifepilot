/**
 * AgentWorkflow — a lightweight, typed async step pipeline.
 *
 * Each step receives the full context and returns a partial patch that is merged
 * in. Steps run sequentially; any step can short-circuit by setting a sentinel
 * field that later steps check.
 *
 * PRIVACY: pure in-process computation — zero network, zero I/O.
 *
 * Usage:
 *   const result = await new AgentWorkflow<MyCtx>()
 *     .step(retrieveContext)
 *     .step(buildPrompt)
 *     .step(evaluateQuality)
 *     .run(initialCtx);
 */

export type WorkflowStep<TCtx> = (ctx: Readonly<TCtx>) => Promise<Partial<TCtx>>;

export class AgentWorkflow<TCtx extends object> {
  private readonly _steps: WorkflowStep<TCtx>[] = [];

  step(fn: WorkflowStep<TCtx>): this {
    this._steps.push(fn);
    return this;
  }

  async run(initial: TCtx): Promise<TCtx> {
    let ctx = { ...initial };
    for (const step of this._steps) {
      const patch = await step(ctx);
      ctx = { ...ctx, ...patch };
    }
    return ctx;
  }
}
