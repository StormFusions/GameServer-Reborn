import chalk from 'chalk';

import fs from "fs";

export async function debugWithTime(level, message) {
  const currentTime = new Date().toLocaleTimeString("nb-NO", { hour12: false });

  switch (level) {
    case 0:
      console.log(`[${currentTime}] ${message}`);
      break;
    case 1:
      console.log(chalk.yellow(`[${currentTime}] ${message}`));
      break;
    case 2:
      console.log(chalk.red(`[${currentTime}] ${messafe}`));
      break;
  }

  fs.appendFileSync("latest.log", `[${currentTime}] ${message}\n`);
}
