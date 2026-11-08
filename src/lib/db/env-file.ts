import * as fs from "fs";

/**
 * Load `.env` from the working directory, as the app does, so a CLI run from
 * the checkout reaches the database the app uses. A variable already set in
 * the environment wins (Node's rule); no `.env` leaves the environment as is.
 */
export function loadEnvFile(file = ".env"): void {
  if (fs.existsSync(file)) process.loadEnvFile(file);
}
