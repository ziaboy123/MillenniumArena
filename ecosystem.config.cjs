// Millennium Arena under PM2 on the homelab server: `pm2 start ecosystem.config.cjs` (once), then `pm2 restart millennium`.
// PM2 runs Node 22 from nvm directly (the server's default Node is too old); tsx runs the TypeScript, and
// --env-file reads the settings and keys in the .env next to this file on every start, so a restart picks up new keys.
const path = require('node:path'), os = require('node:os');
module.exports = {
  apps: [{
    name: 'millennium',
    cwd: path.join(__dirname, 'server'),
    script: path.join(os.homedir(), '.nvm/versions/node/v22.23.2/bin/node'),
    args: [`--env-file=${path.join(__dirname, '.env')}`, '--disable-warning=ExperimentalWarning', '--import', 'tsx', 'src/index.ts'],
    interpreter: 'none',
  }],
};
