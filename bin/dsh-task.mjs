#!/usr/bin/env node
/** dsh-task shim — forwards to the CLI implementation. */
import { main } from '../src/cli.mjs';

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`错误：${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
