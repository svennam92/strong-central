#!/bin/bash

git commit -a --amen -m 'wip'
git push origin spike/heroku -f
ssh dovm -C 'cd ~/strong-central; git fetch; git reset --hard origin/spike/heroku'
