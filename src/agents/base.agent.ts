import { IAgent } from "../types";

/**
 * Abstract base for all agents.
 * Provides the shared contract that the orchestrator depends on.
 */
export abstract class BaseAgent<TInput = unknown, TOutput = unknown>
  implements IAgent<TInput, TOutput>
{
  abstract readonly name: string;
  abstract readonly description: string;
  abstract execute(input: TInput): Promise<TOutput>;
}
