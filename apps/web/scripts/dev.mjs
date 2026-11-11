import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = 5173;
const probe = createServer();

probe.once('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `Port ${port} is already in use. In PowerShell, find its PID with "netstat -ano | findstr :${port}", then stop the verified process with "Stop-Process -Id <pid>".`,
    );
    process.exitCode = 1;
    return;
  }
  console.error(`Could not check port ${port}: ${error.message}`);
  process.exitCode = 1;
});

probe.listen(port, '0.0.0.0', () => {
  probe.close((error) => {
    if (error) {
      console.error(`Could not release the port ${port} check: ${error.message}`);
      process.exitCode = 1;
      return;
    }

    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
    const viteCli = resolve(root, 'node_modules/vite/bin/vite.js');
    const vite = spawn(process.execPath, [viteCli, '--host', '0.0.0.0', '--strictPort'], {
      stdio: 'inherit',
    });

    vite.once('error', (spawnError) => {
      console.error(`Could not start Vite: ${spawnError.message}`);
      process.exitCode = 1;
    });
    vite.once('exit', (code, signal) => {
      process.exitCode = code ?? (signal ? 1 : 0);
    });

    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => vite.kill(signal));
    }
  });
});
