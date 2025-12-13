
const core = require('@actions/core');
const exec = require('@actions/exec');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

const workingDir = __dirname;

// Helper to expand shell-style variables
function expandVars(str, env) {
  if (!str) {
    return str;
  }
  return str.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    return env[key] || match;
  }).replace(/\$([a-zA-Z0-9_]+)/g, (match, key) => {
    return env[key] || match;
  });
}

// Parse shell-style config file
function parseConfig(filePath, initialEnv = {}) {
  if (!fs.existsSync(filePath)) {
    return initialEnv;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const env = { ...initialEnv };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Simple shell variable assignment parsing: KEY="VALUE" or KEY=VALUE
    const match = trimmed.match(/^([a-zA-Z0-9_]+)=(.*)$/);
    if (match) {
      const key = match[1];
      let value = match[2];
      // Remove wrapping quotes
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      // Expand variables based on current env
      value = expandVars(value, env);
      env[key] = value;
    }
  }
  return env;
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    core.info(`Downloading ${url} to ${dest}`);
    const file = fs.createWriteStream(dest);

    const handleResponse = (response) => {
      if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
        if (response.headers.location) {
          core.info(`Redirecting to ${response.headers.location}`);
          https.get(response.headers.location, handleResponse).on('error', (err) => {
            fs.unlink(dest, () => { });
            reject(err);
          });
          return;
        }
      }

      if (response.statusCode !== 200) {
        fs.unlink(dest, () => { });
        reject(new Error(`Failed to download ${url}: Status Code ${response.statusCode}`));
        return;
      }

      response.pipe(file);
    };

    const request = https.get(url, handleResponse);

    request.on('error', (err) => {
      fs.unlink(dest, () => { });
      reject(err);
    });

    file.on('finish', () => {
      file.close(() => resolve());
    });

    file.on('error', (err) => {
      fs.unlink(dest, () => { });
      reject(err);
    });
  });
}

async function execSSH(cmd, sshConfig, ignoreReturn = false) {
  core.info(`Exec SSH: ${cmd}`);

  // Standard options for CI/CD
  const args = [
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
  ];

  // We assume the Host is the OS name (e.g. 'openbsd'), configured in ~/.ssh/config or by anyvm.py
  const host = sshConfig.host || "default";

  try {
    await exec.exec("ssh", [...args, host, cmd]);
  } catch (err) {
    if (!ignoreReturn) {
      throw err;
    }
  }
}

async function install() {
  core.info("Installing dependencies...");
  if (process.platform === 'linux') {
    await exec.exec("sudo", ["apt-get", "update"]);
    await exec.exec("sudo", ["apt-get", "install", "-y"
      , "qemu-system-x86"
      , "qemu-system-arm"
      , "qemu-efi-aarch64"
      , "nfs-kernel-server"
      , "rsync"
      , "zstd"
      , "ovmf"
      , "xz-utils"
      , "qemu-utils"]);
    await exec.exec("sudo", ["chmod", "666", "/dev/kvm"]);
  } else if (process.platform === 'darwin') {
    await exec.exec("brew", ["install", "qemu"]);
  } else if (process.platform === 'win32') {
    await exec.exec("choco", ["install", "qemu", "-y"]);
  }
}

async function main() {
  try {
    // 1. Inputs
    const debug = core.getInput("debug");
    const releaseInput = core.getInput("release");
    const archInput = core.getInput("arch");
    const inputOsName = core.getInput("osname");
    const mem = core.getInput("mem");
    const cpu = core.getInput("cpu");
    const nat = core.getInput("nat");
    const envs = core.getInput("envs");
    const prepare = core.getInput("prepare");
    const run = core.getInput("run");
    const sync = core.getInput("sync");
    const copyback = core.getInput("copyback");

    // 2. Load Config
    let env = {};
    // Defaults
    env = parseConfig(path.join(__dirname, 'conf/default.release.conf'), env);

    let release = releaseInput || env['DEFAULT_RELEASE'];
    let arch = archInput;

    // Handle Arch logic
    if (!arch) {
      // x86_64 implict
    } else if (arch === 'arm64') {
      arch = 'aarch64';
    } else if (arch === 'x86_64' || arch === 'amd64') {
      arch = '';
    }


    // Load specific conf files
    let confName = release;
    if (arch) confName += `-${arch}`;
    const confPath = path.join(__dirname, `conf/${confName}.conf`);

    if (!fs.existsSync(confPath)) {
      // Attempt to look for base config if arch specific not found? fails if not found.
      throw new Error(`Config not found: ${confPath}`);
    }

    env = parseConfig(confPath, env);

    const anyvmVersion = env['ANYVM_VERSION'];
    const builderVersion = env['BUILDER_VERSION'];
    const osName = inputOsName;

    core.info(`Using ANYVM_VERSION: ${anyvmVersion}`);
    core.info(`Using BUILDER_VERSION: ${builderVersion}`);
    core.info(`Target OS: ${osName}, Release: ${release}`);



    // 3. Download anyvm.py
    if (!anyvmVersion) {
      throw new Error("ANYVM_VERSION not defined in config");
    }
    const anyvmUrl = `https://raw.githubusercontent.com/anyvm-org/anyvm/v${anyvmVersion}/anyvm.py`;
    const anyvmPath = path.join(__dirname, 'anyvm.py');
    await downloadFile(anyvmUrl, anyvmPath);

    core.startGroup("Installing dependencies");
    await install();
    core.endGroup();

    // 4. Start VM
    // Params mapping:
    // anyvm.py --os <os> --release <release> --builder <builder> ... -d
    let args = [anyvmPath, "--os", osName, "--release", release];

    const datadir = path.join(__dirname, 'output');
    if (!fs.existsSync(datadir)) {
      fs.mkdirSync(datadir, { recursive: true });
    }
    args.push("--data-dir", datadir);

    if (builderVersion) {
      args.push("--builder", builderVersion);
    }

    if (cpu) {
      args.push("--cpu", cpu);
    }
    if (mem) {
      args.push("--mem", mem);
    }
    if (nat) {
      args.push("--nat", nat);
    }
    if (sync) {
      args.push("--sync", sync);
    }

    args.push("-d"); // Background/daemon

    let sshHost = osName;
    args.push("--ssh-name", sshHost);

    core.startGroup("Starting VM with anyvm.py");
    let output = "";
    const options = {
      listeners: {
        stdout: (data) => {
          output += data.toString();
        }
      }
    };
    await exec.exec("python3", args, options);
    core.endGroup();

    // SSH Env Config
    if (envs) {
      const sshDir = path.join(process.env["HOME"], ".ssh");
      if (!fs.existsSync(sshDir)) {
        fs.mkdirSync(sshDir, { recursive: true });
      }
      const sshConfigPath = path.join(sshDir, "config");
      // Append cleanly
      fs.appendFileSync(sshConfigPath, `Host ${sshHost}\n  SendEnv ${envs}\n`);
    }

    core.startGroup("Run 'prepare' in VM");
    if (prepare) {
      await execSSH(prepare, { host: sshHost });
    }
    core.endGroup();

    core.startGroup("Run 'run' in VM");
    if (run) {
      if (sync !== 'no') {
        // Ensure target dir exists
        await execSSH(`mkdir -p $HOME/work`, { host: sshHost });

        const workspace = process.env['GITHUB_WORKSPACE'];
        if (workspace) {
          if (sync === 'sshfs') {
            core.info("Setting up SSHFS");
            // Install sshfs if missing (best effort)
            await execSSH("if ! command -v sshfs; then pkg_add sshfs || apt-get install -y sshfs || true; fi", { host: sshHost }, true);
            // Mount
            await execSSH(`sshfs -o reconnect,ServerAliveCountMax=2,allow_other,default_permissions host:${workspace} $HOME/work`, { host: sshHost });
          } else if (sync === 'nfs') {
            core.info("Setting up NFS");
            // Host side setup
            await exec.exec("sudo", ["apt-get", "update"], { silent: true });
            await exec.exec("sudo", ["apt-get", "install", "-y", "nfs-kernel-server"], { silent: true });
            // Add export
            const exports = `${workspace} *(rw,insecure,async,no_subtree_check,anonuid=${os.userInfo().uid},anongid=${os.userInfo().gid})`;
            await exec.exec("bash", ["-c", `echo "${exports}" | sudo tee -a /etc/exports`]);
            await exec.exec("sudo", ["exportfs", "-a"]);
            // Mount in VM
            await execSSH(`mount -t nfs 192.168.122.1:${workspace} $HOME/work || echo "NFS mount failed"`, { host: sshHost });
          } else if (sync === 'scp') {
            core.info("Syncing via SCP");
            await exec.exec("scp", ["-O", "-r", "-o", "StrictHostKeyChecking=no", workspace, `${sshHost}:work/`]);
          } else {
            // Rsync (default)
            core.info("Syncing via Rsync");
            await exec.exec("rsync", ["-avz", "-e", "ssh -o StrictHostKeyChecking=no", workspace + "/", `${sshHost}:work/`]);
          }
        }
      }

      await execSSH(run, { host: sshHost });
    }
    core.endGroup();

    // 7. Copyback
    if (copyback !== 'false' && sync !== 'no' && sync !== 'sshfs' && sync !== 'nfs') {
      const workspace = process.env['GITHUB_WORKSPACE'];
      if (workspace) {
        core.info("Copying back artifacts");
        if (sync === 'scp') {
          await exec.exec("scp", ["-r", "-o", "StrictHostKeyChecking=no", `${sshHost}:work/*`, workspace + "/"]);
        } else {
          await exec.exec("rsync", ["-avz", "-e", "ssh -o StrictHostKeyChecking=no", `${sshHost}:work/`, workspace + "/"]);
        }
      }
    }

  } catch (error) {
    core.setFailed(error.message);
    process.exit(1);
  }
}

main();
