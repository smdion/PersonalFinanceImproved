import * as fs from "fs";

/** Backups hold the household's data and stored credentials: owner-only. */
const BACKUP_FILE_MODE = 0o600;

/** Write a backup file readable by its owner only, an existing file included. */
export function writeBackupFile(filePath: string, data: string): void {
  fs.writeFileSync(filePath, data, { mode: BACKUP_FILE_MODE });
  restrictBackupFile(filePath);
}

/** Make a backup another tool wrote (SQLite's `VACUUM INTO`) owner-only. */
export function restrictBackupFile(filePath: string): void {
  fs.chmodSync(filePath, BACKUP_FILE_MODE);
}
