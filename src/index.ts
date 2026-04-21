import * as readline from "readline";
import { connectDB, closeDB } from "./database";
import { ThinkerAgent } from "./orchestration";
import { OpenAIProvider } from "./services/llm.provider";
import { MemoryService } from "./services/memory.service";
import { config } from "./config/env";
import { printResult } from "./utils";

async function main(): Promise<void> {
  await connectDB();

  const llm = new OpenAIProvider(config.openaiApiKey, config.openaiModel);
  const memory = new MemoryService(llm);
  const thinker = new ThinkerAgent({ llmProvider: llm, memoryService: memory });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("\n🤖 CRM AI Assistant");
  console.log("Type your request (or 'quit' to exit)\n");

  const prompt = (): void => {
    rl.question("You> ", async (input) => {
      const trimmed = input.trim();

      if (!trimmed) return prompt();
      if (["quit", "exit", "q"].includes(trimmed.toLowerCase())) {
        await closeDB();
        console.log("\nGoodbye!");
        rl.close();
        return;
      }

      try {
        const result = await thinker.process(trimmed);
        printResult(result);
      } catch (err) {
        console.error(`\n❌ Error: ${(err as Error).message}\n`);
      }

      prompt();
    });
  };

  prompt();
}

main().catch(console.error);
