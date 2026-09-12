import { startWorkbenchPanel } from '../../plugins/narracut/src/workbench-panel';

const panel = await startWorkbenchPanel({ threadId: process.argv[2] });
process.stdout.write(JSON.stringify({ url: panel.url }) + '\n');
process.on('SIGTERM', () => { void panel.close().then(() => process.exit(0)); });
