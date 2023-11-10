

if bash vbox.sh waitForText $VM_OS_NAME "OpenBSD/amd64 BOOT" 10 ; then
  echo "====> OK, enter"
  bash vbox.sh enter
  sleep 3
fi


