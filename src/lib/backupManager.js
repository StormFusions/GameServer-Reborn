import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import zlib from "zlib";
import { pipeline } from "stream/promises";
import { createReadStream, createWriteStream } from "fs";
import archiver from "archiver";
import extractZip from "extract-zip";
import { logger } from "./logger.js";

/**
 * Backup Manager: Handles automated and manual backups of /data directory and user.db
 * Stores backups with timestamps and implements rotation/cleanup of old backups
 */

class BackupManager {
  constructor(config = {}) {
    this.dataDir = config.dataDirectory || "data";
    this.backupDir = config.backupDirectory || "backups";
    this.maxBackups = config.maxBackups || 10; // Keep last 10 backups
    this.backupInterval = config.backupInterval || 3600000; // Default: 1 hour in milliseconds
    this.useCompression = config.useCompression !== false; // Compress by default
    this.backupInProgress = false;
    this.lastBackupTime = null;
    this.scheduledBackupId = null;

    // Ensure backup directory exists
    this.initBackupDir();
  }

  async initBackupDir() {
    try {
      if (!fs.existsSync(this.backupDir)) {
        await fsp.mkdir(this.backupDir, { recursive: true });
        logger.info({ dir: this.backupDir }, "Backup directory created");
      }
    } catch (error) {
      logger.error(error, "Error creating backup directory");
    }
  }

  /**
   * Create a ZIP backup of /data and user.db
   * Returns backup metadata if successful
   */
  async createBackup(reason = "scheduled") {
    if (this.backupInProgress) {
      logger.warn("Backup already in progress, skipping");
      return null;
    }

    this.backupInProgress = true;

    try {
      const timestamp = Date.now();
      const dateStr = new Date(timestamp).toISOString().replace(/[:.]/g, "-");
      const backupName = `backup_${dateStr}_${reason}`;
      const zipPath = path.join(this.backupDir, `${backupName}.zip`);

      logger.info({ backup: backupName, reason }, "Starting backup process");

      // Check if paths exist
      const dataExists = fs.existsSync(this.dataDir);
      const userDbExists = fs.existsSync("user.db");

      if (!dataExists && !userDbExists) {
        logger.warn("Neither data directory nor user.db exists, skipping backup");
        this.backupInProgress = false;
        return null;
      }

      // Create zip archive
      const output = createWriteStream(zipPath);
      const archive = archiver("zip", { zlib: { level: 9 } }); // Maximum compression

      let backupSize = 0;
      const files = [];

      return new Promise((resolve, reject) => {
        output.on("close", async () => {
          backupSize = archive.pointer();
          this.lastBackupTime = timestamp;

          // Create metadata file
          const metadata = {
            name: backupName,
            timestamp,
            created: new Date(timestamp).toISOString(),
            reason,
            size: backupSize,
            compressed: true,
            format: "zip",
            files,
          };

          const metadataPath = path.join(this.backupDir, `${backupName}.json`);
          try {
            await fsp.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
            
            logger.info(
              { backup: backupName, size: this.formatBytes(backupSize) },
              "Backup completed successfully"
            );

            // Cleanup old backups
            await this.rotateBackups();

            resolve(metadata);
          } catch (error) {
            logger.error(error, "Error writing backup metadata");
            reject(error);
          }
        });

        archive.on("error", (err) => {
          logger.error(err, "Error creating backup archive");
          reject(err);
        });

        archive.pipe(output);

        try {
          // Add /data directory if it exists
          if (dataExists) {
            archive.directory(this.dataDir, "data");
            files.push("data/");
            logger.info({ backup: backupName }, "Data directory added to archive");
          }

          // Add user.db if it exists
          if (userDbExists) {
            archive.file("user.db", { name: "user.db" });
            files.push("user.db");
            logger.info({ backup: backupName }, "user.db added to archive");
          }

          archive.finalize();
        } catch (error) {
          logger.error(error, "Error adding files to archive");
          reject(error);
        }
      });
    } catch (error) {
      logger.error(error, "Backup failed");
      return null;
    } finally {
      this.backupInProgress = false;
    }
  }

  /**
   * Copy a single file
   */
  async copyFile(source, destination) {
    try {
      await fsp.mkdir(path.dirname(destination), { recursive: true });
      await fsp.copyFile(source, destination);
      const stats = await fsp.stat(destination);
      return stats.size;
    } catch (error) {
      logger.error(error, `Error copying file ${source}`);
      throw error;
    }
  }

  /**
   * Recursively copy a directory
   */
  async copyDirectory(source, destination) {
    let totalSize = 0;

    try {
      await fsp.mkdir(destination, { recursive: true });
      const entries = await fsp.readdir(source, { withFileTypes: true });

      for (const entry of entries) {
        const sourcePath = path.join(source, entry.name);
        const destPath = path.join(destination, entry.name);

        try {
          if (entry.isDirectory()) {
            totalSize += await this.copyDirectory(sourcePath, destPath);
          } else {
            totalSize += await this.copyFile(sourcePath, destPath);
          }
        } catch (error) {
          logger.warn(error, `Skipping ${sourcePath}`);
          // Continue with other files even if one fails
        }
      }
    } catch (error) {
      logger.error(error, `Error copying directory ${source}`);
      throw error;
    }

    return totalSize;
  }

  /**
   * Get list of all backups
   */
  async listBackups() {
    try {
      if (!fs.existsSync(this.backupDir)) {
        return [];
      }

      const backups = [];
      const entries = await fsp.readdir(this.backupDir, { withFileTypes: true });

      for (const entry of entries) {
        // Look for .json metadata files (not directories anymore)
        if (entry.isFile() && entry.name.endsWith(".json")) {
          try {
            const metadataContent = await fsp.readFile(
              path.join(this.backupDir, entry.name),
              "utf-8"
            );
            const metadata = JSON.parse(metadataContent);
            backups.push(metadata);
          } catch (error) {
            logger.warn({ file: entry.name }, "Could not read backup metadata");
          }
        }
      }

      // Sort by timestamp descending (newest first)
      backups.sort((a, b) => b.timestamp - a.timestamp);

      return backups;
    } catch (error) {
      logger.error(error, "Error listing backups");
      return [];
    }
  }

  /**
   * Delete a specific backup
   */
  async deleteBackup(backupName) {
    try {
      const zipPath = path.join(this.backupDir, `${backupName}.zip`);
      const metadataPath = path.join(this.backupDir, `${backupName}.json`);

      let deleted = false;

      // Delete ZIP file
      if (fs.existsSync(zipPath)) {
        await fsp.rm(zipPath, { force: true });
        deleted = true;
      }

      // Delete metadata file
      if (fs.existsSync(metadataPath)) {
        await fsp.rm(metadataPath, { force: true });
        deleted = true;
      }

      if (deleted) {
        logger.info({ backup: backupName }, "Backup deleted");
        return true;
      } else {
        logger.warn({ backup: backupName }, "Backup not found");
        return false;
      }
    } catch (error) {
      logger.error(error, `Error deleting backup ${backupName}`);
      return false;
    }
  }

  /**
   * Restore a backup from ZIP file
   */
  async restoreBackup(backupName) {
    try {
      const zipPath = path.resolve(this.backupDir, `${backupName}.zip`);
      const metadataPath = path.resolve(this.backupDir, `${backupName}.json`);

      if (!fs.existsSync(metadataPath)) {
        logger.error({ backup: backupName }, "Backup metadata not found");
        return { success: false, message: "Backup metadata not found" };
      }

      if (!fs.existsSync(zipPath)) {
        logger.error({ backup: backupName }, "Backup ZIP file not found");
        return { success: false, message: "Backup ZIP file not found" };
      }

      const metadataContent = await fsp.readFile(metadataPath, "utf-8");
      const metadata = JSON.parse(metadataContent);

      logger.info({ backup: backupName }, "Starting restore process");
      
      // Wait for database locks to fully release (Windows may need extra time)
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Create a temporary extraction directory with absolute path
      const tempExtractDir = path.resolve(this.backupDir, `temp_extract_${Date.now()}`);
      await fsp.mkdir(tempExtractDir, { recursive: true });

      try {
        // Extract ZIP to temporary directory
        await extractZip(zipPath, { dir: tempExtractDir });

        // Restore /data if it was backed up
        if (metadata.files.includes("data/")) {
          const dataBackupPath = path.join(tempExtractDir, "data");
          if (fs.existsSync(dataBackupPath)) {
            // Backup current data before restoring
            const currentDataBackup = path.resolve(
              this.backupDir,
              `pre_restore_${Date.now()}`
            );
            if (fs.existsSync(this.dataDir)) {
              await fsp.mkdir(currentDataBackup, { recursive: true });
              await this.copyDirectory(this.dataDir, path.join(currentDataBackup, "data"));
            }

            // Remove current data and restore from backup
            if (fs.existsSync(this.dataDir)) {
              try {
                await fsp.rm(this.dataDir, { recursive: true, force: true });
              } catch (error) {
                logger.warn({ error: error.code }, "Could not remove data directory immediately, retrying...");
                // Retry after a short delay
                await new Promise(resolve => setTimeout(resolve, 500));
                await fsp.rm(this.dataDir, { recursive: true, force: true });
              }
            }
            await this.copyDirectory(dataBackupPath, this.dataDir);
            logger.info({ backup: backupName }, "Data directory restored");
          }
        }

        // Restore user.db if it was backed up
        if (metadata.files.includes("user.db")) {
          const userDbBackupPath = path.join(tempExtractDir, "user.db");
          if (fs.existsSync(userDbBackupPath)) {
            // Backup current user.db before restoring
            if (fs.existsSync("user.db")) {
              const timestamp = Date.now();
              try {
                await fsp.copyFile("user.db", `user.db.backup_${timestamp}`);
              } catch (error) {
                logger.warn({ error: error.code }, "Could not backup current user.db");
              }
            }

            // Try to replace user.db, handling locked file case
            try {
              await fsp.copyFile(userDbBackupPath, "user.db");
            } catch (error) {
              if (error.code === "EBUSY" || error.code === "EACCES") {
                logger.error(
                  { error: error.code, message: error.message },
                  "Database file is locked. Server must be stopped to restore."
                );
                return {
                  success: false,
                  message: "Database file is in use. Please stop the server before restoring.",
                  requiresServerStop: true,
                };
              }
              throw error;
            }
            logger.info({ backup: backupName }, "user.db restored");
          }
        }

        logger.info({ backup: backupName }, "Restore completed successfully");
        
        // Clean up old pre_restore directories to prevent disk bloat
        try {
          await this.cleanupOldPreRestoreDirs();
        } catch (error) {
          logger.warn({ error: error.message }, "Could not clean up old pre_restore directories");
        }
        
        return { success: true, message: "Restore completed successfully" };
      } finally {
        // Clean up temporary extraction directory
        try {
          await fsp.rm(tempExtractDir, { recursive: true, force: true });
        } catch (error) {
          logger.warn({ error: error.message }, "Could not clean up temporary extraction directory");
        }
      }
    } catch (error) {
      logger.error(error, `Error restoring backup ${backupName}`);
      return {
        success: false,
        message: `Error restoring backup: ${error.message}`,
        error: error.message,
      };
    }
  }

  /**
   * Rotate backups - keep only maxBackups, delete oldest
   */
  async rotateBackups() {
    try {
      const backups = await this.listBackups();

      if (backups.length > this.maxBackups) {
        const toDelete = backups.slice(this.maxBackups);

        for (const backup of toDelete) {
          await this.deleteBackup(backup.name);
          logger.info({ backup: backup.name }, "Old backup deleted during rotation");
        }
      }
    } catch (error) {
      logger.error(error, "Error rotating backups");
    }
  }

  /**
   * Get backup statistics
   */
  async getBackupStats() {
    try {
      const backups = await this.listBackups();
      let totalSize = 0;
      let backupCount = backups.length;

      for (const backup of backups) {
        totalSize += backup.size || 0;
      }

      return {
        backupCount,
        totalSize,
        formattedTotalSize: this.formatBytes(totalSize),
        lastBackupTime: this.lastBackupTime,
        nextBackupTime: this.lastBackupTime
          ? this.lastBackupTime + this.backupInterval
          : null,
        backups: backups.map((b) => ({
          name: b.name,
          created: b.created,
          size: b.size,
          formattedSize: this.formatBytes(b.size),
          reason: b.reason,
          files: b.files,
        })),
      };
    } catch (error) {
      logger.error(error, "Error getting backup stats");
      return {
        backupCount: 0,
        totalSize: 0,
        formattedTotalSize: "0 B",
        backups: [],
      };
    }
  }

  /**
   * Start automatic backup scheduler
   */
  startAutoBackup() {
    if (this.scheduledBackupId) {
      logger.warn("Backup scheduler already running");
      return;
    }

    logger.info(
      { interval: this.backupInterval },
      "Starting automatic backup scheduler"
    );

    this.scheduledBackupId = setInterval(() => {
      this.createBackup("auto-scheduled").catch((error) => {
        logger.error(error, "Error in scheduled backup");
      });
    }, this.backupInterval);

    // Also perform an initial backup
    setTimeout(() => {
      this.createBackup("auto-initial").catch((error) => {
        logger.error(error, "Error in initial backup");
      });
    }, 5000);
  }

  /**
   * Stop automatic backup scheduler
   */
  stopAutoBackup() {
    if (this.scheduledBackupId) {
      clearInterval(this.scheduledBackupId);
      this.scheduledBackupId = null;
      logger.info("Backup scheduler stopped");
    }
  }

  /**
   * Clean up all pre_restore directories to prevent disk bloat
   * (ZIP backups are the actual backups, pre_restore dirs are temporary)
   */
  async cleanupOldPreRestoreDirs() {
    try {
      if (!fs.existsSync(this.backupDir)) {
        return;
      }

      const entries = await fsp.readdir(this.backupDir, { withFileTypes: true });
      const preRestoreDirs = entries
        .filter(entry => entry.isDirectory() && entry.name.startsWith("pre_restore_"));

      // Delete all pre_restore directories
      for (const dir of preRestoreDirs) {
        try {
          const dirPath = path.join(this.backupDir, dir.name);
          await fsp.rm(dirPath, { recursive: true, force: true });
          logger.info({ dir: dir.name }, "Cleaned up pre_restore directory");
        } catch (error) {
          logger.warn(
            { dir: dir.name, error: error.message },
            "Could not delete pre_restore directory"
          );
        }
      }

      if (preRestoreDirs.length > 0) {
        logger.info({ count: preRestoreDirs.length }, "Pre-restore cleanup completed");
      }
    } catch (error) {
      logger.error(error, "Error cleaning up pre_restore directories");
    }
  }

  /**
   * Format bytes to human-readable format
   */
  formatBytes(bytes) {
    if (bytes === 0) return "0 B";

    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  }
}

// Create and export singleton instance
const backupManager = new BackupManager();
export default backupManager;
