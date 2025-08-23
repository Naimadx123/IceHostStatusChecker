import { registerSlashCommandsGlobally } from './commands/_registry.js';

registerSlashCommandsGlobally()
    .then(() => console.log('✓ Commands registered globally'))
    .catch(err => {
        console.error('Failed to register commands', err);
        process.exit(1);
    });
