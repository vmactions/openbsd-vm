# Run GitHub CI in OpenBSD ![Test](https://github.com/vmactions/openbsd-vm/workflows/Test/badge.svg)

Use this action to run your CI in OpenBSD.

The github workflow only supports Ubuntu, Windows and MacOS. But what if you need to use OpenBSD?

This action is to support OpenBSD.


Sample workflow `test.yml`:

```yml

name: Test

on: [push]

jobs:
  test:
    runs-on: ubuntu-22.04
    name: A job to run test in OpenBSD
    env:
      MYTOKEN : ${{ secrets.MYTOKEN }}
      MYTOKEN2: "value2"
    steps:
    - uses: actions/checkout@v4
    - name: Test in OpenBSD
      id: test
      uses: vmactions/openbsd-vm@v1
      with:
        envs: 'MYTOKEN MYTOKEN2'
        usesh: true
        prepare: |
          pkg_add curl

        run: |

          pwd
          ls -lah
          whoami
          env






```


The latest major version is: `v1`, which is the most recommended to use. (You can also use the latest full version: `v1.0.2`)



The `runs-on: ubuntu-22.04` must be `ubuntu-22.04`.

The `envs: 'MYTOKEN MYTOKEN2'` is the env names that you want to pass into the vm.

The `run: xxxxx`  is the command you want to run in the vm.

The env variables are all copied into the VM, and the source code and directory are all synchronized into the VM.

The working dir for `run` in the VM is the same as in the Host machine.

All the source code tree in the Host machine are mounted into the VM.

All the `GITHUB_*` as well as `CI=true` env variables are passed into the VM.

So, you will have the same directory and same default env variables when you `run` the CI script.

The default shell in OpenBSD is `ksh`, if you want to use `sh` to execute the `run` script, please set `usesh` to `true`.

The code is shared from the host to the VM via `rsync`, you can choose to use to `sshfs` share code instead.


```

...

    steps:
    - uses: actions/checkout@v4
    - name: Test
      id: test
      uses: vmactions/openbsd-vm@v1
      with:
        envs: 'MYTOKEN MYTOKEN2'
        usesh: true
        sync: sshfs
        prepare: |
          pkg_add curl



...


```


When using `rsync`,  you can define `copyback: false` to not copy files back from the VM in to the host.


```

...

    steps:
    - uses: actions/checkout@v4
    - name: Test
      id: test
      uses: vmactions/openbsd-vm@v1
      with:
        envs: 'MYTOKEN MYTOKEN2'
        usesh: true
        sync: rsync
        copyback: false
        prepare: |
          pkg_add curl



...


```



You can add NAT port between the host and the VM.

```
...
    steps:
    - uses: actions/checkout@v4
    - name: Test
      id: test
      uses: vmactions/openbsd-vm@v1
      with:
        envs: 'MYTOKEN MYTOKEN2'
        usesh: true
        nat: |
          "8080": "80"
          "8443": "443"
          udp:"8081": "80"
...
```


The default memory of the VM is 6144MB, you can use `mem` option to set the memory size:

```
...
    steps:
    - uses: actions/checkout@v4
    - name: Test
      id: test
      uses: vmactions/openbsd-vm@v1
      with:
        envs: 'MYTOKEN MYTOKEN2'
        usesh: true
        mem: 4096
...
```



It uses [the latest OpenBSD 7.4](conf/default.release.conf) by default, you can use `release` option to use another version of OpenBSD:

```
...
    steps:
    - uses: actions/checkout@v4
    - name: Test
      id: test
      uses: vmactions/openbsd-vm@v1
      with:
        release: 7.3
...
```

All the supported releases are here: [OpenBSD  7.2, 7.3, 7.4](conf)

# Migration

To migrate from v0 to v1 you'll need to change `runs-on: macos-12` to
`runs-on: ubuntu-22.04`

# Under the hood

We use Qemu and Libvirt to run the OpenBSD VM.




# Upcoming features:

1. Runs on MacOS to use cpu accelaration.
2. Support ARM and other architecture.




