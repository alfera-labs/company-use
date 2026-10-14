// Starts the app for a script, with nothing on the screen, and ends as the app ends.
//   ALFERA_INVISIBLE=1 ALFERA_SMOKE=1 node test/run_invisible.cjs [switches for the app]
// `npm run smoke` is that line.
const { start_invisible_app, stop_unless_the_run_is_invisible } = require('./invisible_electron.cjs');

stop_unless_the_run_is_invisible('test/run_invisible.cjs');
const app = start_invisible_app({ switches: process.argv.slice(2), stdio: 'inherit' });
app.on('exit', (exit_code) => process.exit(exit_code ?? 1));
