#!/usr/bin/env bash

###
## remote exec shell command example
###

read -d '' -r cmd <<-'EOF'
kill -9 $(pidof tail)
file=$(date +%H_%M_%S_%N)

cd /tmp && mkdir test
touch test/$file
nohup tail \
  -f test/$file > test/tail 2>&1 &
EOF

echo $cmd

ssh -n -f ubuntu "bash -c '$cmd'"
