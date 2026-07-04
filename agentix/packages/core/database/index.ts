/**
 * @agentix/database — re-exports the runtime SQLite database.
 *
 * The canonical database lives at src/core/database.ts.
 * This package is kept as a convenience re-export for backward compatibility.
 */
export {
  getDatabase,
  closeDatabase,
  runQuery,
  runSingle,
  runExecute,
  runTransaction,
} from '../../../src/core/database';
