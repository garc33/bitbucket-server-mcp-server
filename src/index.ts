#!/usr/bin/env node
import { config } from "dotenv";
import { BitbucketServer, logger } from "./server.js";

config();
const server = new BitbucketServer();
const mode = process.argv.includes("--http") ? "http" : "stdio";
server.run(mode).catch((error) => {
  logger.error("Server error", error);
  process.exit(1);
});
