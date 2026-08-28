#!/usr/bin/env node
import { main } from "../cli.js";

// stdin stays open/raw after the picker — exit explicitly once pending stdout is flushed.
main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = typeof code === "number" ? code : (process.exitCode ?? 0);
    process.stdout.write("", () => process.exit());
  })
  .catch((err) => {
    console.error(err?.message ?? err);
    process.exit(1);
  });
