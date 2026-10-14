import os from 'node:os';
import path from 'node:path';

const eval_browser_home = path.join(os.homedir(), '.coworker', 'eval-browser');

export const default_browser_command = path.join(eval_browser_home, 'browse');
export const default_browser_profile_path = path.join(eval_browser_home, 'chromium-profile');
