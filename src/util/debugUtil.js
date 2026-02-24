import chalk from 'chalk';

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { logger } from "../lib/logger.js";

const LOG_PATH = path.resolve(process.cwd(), "latest.log");

export async function debugWithTime(level, message) {
  const currentTime = new Date().toLocaleTimeString("nb-NO", { hour12: false });
  const formatted = `[${currentTime}] ${message}`;

  switch (level) {
    case 0:
      logger.info(formatted);
      break;
    case 1:
      logger.warn(formatted);
      break;
    case 2:
      logger.error(formatted);
      break;
  }

  try {
    await fsp.appendFile(LOG_PATH, `${formatted}\n`);
  } catch (e) {
    // best-effort logging; ignore failures
  }
}
