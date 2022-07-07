const core = require('@actions/core');
const exec = require('@actions/exec');
const tc = require('@actions/tool-cache');
const io = require('@actions/io');
const fs = require("fs");
const path = require("path");

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function execSSH(cmd, desp = "") {
  core.info(desp);
  core.info("exec ssh: " + cmd);
  await exec.exec("ssh -t -i " + __dirname + "/mac.id_rsa  openbsd", [], { input: cmd });
}



async function getScreenText(vmName) {
  let png = path.join(__dirname, "/screen.png");
  await vboxmanage(vmName, "controlvm", "screenshotpng  " + png);
  await exec.exec("sudo chmod 666 " + png);
  let output = "";
  await exec.exec("pytesseract  " + png, [], {
    listeners: {
      silent: true,
      stdout: (s) => {
        output += s;
      }
    }
  });
  return output;
}

async function waitFor(vmName, tag) {

  let slept = 0;
  while (true) {
    slept += 1;
    if (slept >= 300) {
      throw new Error("Timeout can not boot");
    }
    await sleep(1000);

    let output = await getScreenText(vmName);

    if (tag) {
      if (output.includes(tag)) {
        core.info("OK");
        await sleep(1000);
        return true;
      } else {
        core.info("Checking, please wait....");
      }
    } else {
      if (!output.trim()) {
        core.info("OK");
        return true;
      } else {
        core.info("Checking, please wait....");
      }
    }

  }

  return false;
}


async function vboxmanage(vmName, cmd, args = "") {
  await exec.exec("sudo  vboxmanage " + cmd + "   " + vmName + "   " + args);
}

async function setup(nat, mem) {
  try {

    fs.appendFileSync(path.join(process.env["HOME"], "/.ssh/config"), "Host openbsd " + "\n");
    fs.appendFileSync(path.join(process.env["HOME"], "/.ssh/config"), " User root" + "\n");
    fs.appendFileSync(path.join(process.env["HOME"], "/.ssh/config"), " HostName localhost" + "\n");
    fs.appendFileSync(path.join(process.env["HOME"], "/.ssh/config"), " Port 2224" + "\n");
    fs.appendFileSync(path.join(process.env["HOME"], "/.ssh/config"), "StrictHostKeyChecking=accept-new\n");


    await exec.exec("brew install -qf tesseract", [], { silent: true });
    await exec.exec("pip3 install -q pytesseract", [], { silent: true });

    let workingDir = __dirname;

    let imgName = "openbsd-6.9";
    let ova = imgName + ".ova";
    
    let url = "https://github.com/vmactions/openbsd-builder/releases/download/v0.0.1/openbsd-6.9.ova.zip";

    core.info("Downloading image: " + url);
    let img = await tc.downloadTool(url);
    core.info("Downloaded file: " + img);
    await io.mv(img, path.join(workingDir, "./" + ova + ".zip"));


    await exec.exec("7za e -y " + path.join(workingDir, ova + ".zip") + "  -o" + workingDir);
    await vboxmanage("", "import", path.join(workingDir, ova));
    
    
    

    let sshHome = path.join(process.env["HOME"], ".ssh");
    let authorized_keys = path.join(sshHome, "authorized_keys");

    fs.appendFileSync(authorized_keys, fs.readFileSync(path.join(workingDir, "id_rsa.pub")));

    fs.appendFileSync(path.join(sshHome, "config"), "SendEnv   CI  GITHUB_* \n");
    await exec.exec("chmod 700 " + sshHome);



    let vmName = "openbsd";

    if (nat) {
      let nats = nat.split("\n").filter(x => x !== "");
      for (let element of nats) {
        core.info("Add nat: " + element);
        let segs = element.split(":");
        if (segs.length === 3) {
          //udp:"8081": "80"
          let proto = segs[0].trim().trim('"');
          let hostPort = segs[1].trim().trim('"');
          let vmPort = segs[2].trim().trim('"');
          await vboxmanage(vmName, "modifyvm", "  --natpf1 '" + hostPort + "," + proto + ",," + hostPort + ",," + vmPort + "'");

        } else if (segs.length === 2) {
          let proto = "tcp"
          let hostPort = segs[0].trim().trim('"');
          let vmPort = segs[1].trim().trim('"');
          await vboxmanage(vmName, "modifyvm", "  --natpf1 '" + hostPort + "," + proto + ",," + hostPort + ",," + vmPort + "'");
        }
      };
    }

    if (mem) {
      await vboxmanage(vmName, "modifyvm", "  --memory " + mem);
    }

    await vboxmanage(vmName, "modifyvm", " --cpus 3");

    await vboxmanage(vmName, "startvm", " --type headless");

    core.info("First boot");

    let loginTag = "OpenBSD/amd64 (openbsd.my.domain) (tty";
    await waitFor(vmName, loginTag);




    let cmd1 = "mkdir -p /Users/runner/work && ln -s /Users/runner/work/  work";
    await execSSH(cmd1, "Setting up VM");

    let sync = core.getInput("sync");
    if (sync == "sshfs") {
      let cmd2 = "pkg_add sshfs-fuse && sshfs -o allow_other,default_permissions runner@10.0.2.2:work /Users/runner/work";
      await execSSH(cmd2, "Setup sshfs");
    } else {
      let cmd2 = "pkg_add rsync-3.2.3p0-iconv";
      await execSSH(cmd2, "Setup rsync-3.2.3p0-iconv");
      await exec.exec("rsync -auvzrtopg  --exclude _actions/vmactions/openbsd-vm  /Users/runner/work/ openbsd:work");
    }

    core.info("OK, Ready!");

  }
  catch (error) {
    core.setFailed(error.message);
  }
}



async function main() {
  let nat = core.getInput("nat");
  core.info("nat: " + nat);

  let mem = core.getInput("mem");
  core.info("mem: " + mem);

  await setup(nat, mem);

  var envs = core.getInput("envs");
  console.log("envs:" + envs);
  if (envs) {
    fs.appendFileSync(path.join(process.env["HOME"], "/.ssh/config"), "SendEnv " + envs + "\n");
  }

  var prepare = core.getInput("prepare");
  if (prepare) {
    core.info("Running prepare: " + prepare);
    await exec.exec("ssh -t openbsd", [], { input: prepare });
  }

  var run = core.getInput("run");
  console.log("run: " + run);

  try {
    var usesh = core.getInput("usesh").toLowerCase() == "true";
    if (usesh) {
      await exec.exec("ssh openbsd sh -c 'cd $GITHUB_WORKSPACE && exec sh'", [], { input: run });
    } else {
      await exec.exec("ssh openbsd sh -c 'cd $GITHUB_WORKSPACE && exec \"$SHELL\"'", [], { input: run });
    }
  } catch (error) {
    core.setFailed(error.message);
  } finally {
    let copyback = core.getInput("copyback");
    if(copyback !== "false") {
      let sync = core.getInput("sync");
      if (sync != "sshfs") {
        core.info("get back by rsync");
        await exec.exec("rsync -uvzrtopg  openbsd:work/ /Users/runner/work");
      }
    }
  }
}



main().catch(ex => {
  core.setFailed(ex.message);
});

