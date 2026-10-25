// npm run schemas: prints the generated JSON Schemas the app writes into the agent folder.
import { snapshotJsonSchema, updateFileJsonSchema } from '../server/agent/agentmd.js';

console.log(JSON.stringify({ update_file: updateFileJsonSchema(), snapshot: snapshotJsonSchema() }, null, 2));
