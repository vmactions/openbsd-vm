#!/usr/bin/env bash

set -e

OVA_LINK="https://github.com/vmactions/openbsd-builder/releases/download/v0.0.4/openbsd-7.1.ova.zip"

CONF_LINK="https://raw.githubusercontent.com/vmactions/openbsd-builder/v0.0.4/conf/openbsd-7.1.conf"


_script="$0"
_script_home="$(dirname "$_script")"


_oldPWD="$PWD"
#everytime we cd to the script home
cd "$_script_home"


_conf_filename="$(echo "$CONF_LINK" | rev  | cut -d / -f 1 | rev)"
echo "Config file: $_conf_filename"

if [ ! -e "$_conf_filename" ]; then
  wget -q "$CONF_LINK"
fi

. $_conf_filename


##########################################################


export VM_OS_NAME

vmsh="$VM_VBOX"

if [ ! -e "$vmsh" ]; then
  echo "Downloading vbox to: $PWD"
  wget "$VM_VBOX_LINK"
fi



osname="$VM_OS_NAME"
ostype="$VM_OS_TYPE"
sshport=$VM_SSH_PORT

ova="$VM_OVA_NAME.ova"
ovazip="$ova.zip"

ovafile="$ova"



importVM() {
  _idfile='~/.ssh/mac.id_rsa'

  bash $vmsh addSSHHost $osname $sshport "$_idfile"

  bash $vmsh setup

  if [ ! -e "$ovazip" ]; then
    echo "Downloading $OVA_LINK"
    wget -q "$OVA_LINK"
  fi

  if [ ! -e "$ovafile" ]; then
    7za e -y $ovazip  -o.
  fi

  bash $vmsh addSSHAuthorizedKeys id_rsa.pub
  cat mac.id_rsa >$HOME/.ssh/mac.id_rsa
  chmod 600 $HOME/.ssh/mac.id_rsa

  bash $vmsh importVM "$ovafile"


}



waitForLoginTag() {
  bash $vmsh waitForText "$osname" "$VM_LOGIN_TAG"
}


execSSH() {
  ssh "$osname"
}


addNAT() {
  bash $vmsh addNAT "$osname" "$@"
}

setMemory() {
  bash $vmsh setMemory "$osname" "$@"
}

setCPU() {
  bash $vmsh setCPU "$osname" "$@"
}

startVM() {
  bash $vmsh startVM "$osname"
}



rsyncToVM() {
  $_pwd="$PWD"
  cd "$_oldPWD"
  rsync -auvzrtopg  --exclude _actions/vmactions/$osname-vm  /Users/runner/work/  $osname:work
  cd "$_pwd"
}


rsyncBackFromVM() {
  rsync -uvzrtopg  $osname:work/ /Users/runner/work
}





"$@"






















