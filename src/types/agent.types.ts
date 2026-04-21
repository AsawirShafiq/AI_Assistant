// ─── Agent Interface ─────────────────────────────────────

export interface IAgent<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  execute(input: TInput): Promise<TOutput>;
}
